<?php

namespace Stanford\MaISlookup;

require_once 'vendor/autoload.php';
require_once 'classes/GoogleSecretManager.php';
require_once 'classes/CertificateManager.php';
require_once 'classes/MAISClient.php';
require_once 'classes/Utilities.php';
require_once 'classes/WebauthSessionException.php';

use MaisLookupVendor\GuzzleHttp\Promise\PromiseInterface;
use MaisLookupVendor\GuzzleHttp\Promise\Utils;

class MaISlookup extends \ExternalModules\AbstractExternalModule
{
    // Stanford prod serves WebAuth surveys from /webauth/surveys/ (webroot symlink behind OIDC).
    const WEBAUTH_PATH_PREFIX = '/webauth';
    const WEBAUTH_TOKEN_TTL = 43200; // 12 hours

    private $secretManager;
    private $certManager;
    private $maisClient;

    private $record;

    // Set on WebAuth survey pages: ['endpoint' => string, 'token' => string]
    private $webauthContext = null;

    public function __construct()
    {
        parent::__construct();
    }

    private function getEnv(): string
    {
        return $this->getProjectSetting('ehs-environment') ?: 'UAT';
    }

    private function getKeyJson(): ?string
    {
        return $this->getSystemSetting('google-service-account-json-key') ?: null;
    }

    private function getSecretManager(): GoogleSecretManager
    {
        if (!$this->secretManager) {
            $this->secretManager = new GoogleSecretManager(
                $this->getProjectSetting('google-project-id'),
                $this->getKeyJson()
            );
        }
        return $this->secretManager;
    }

    private function getCertManager(): CertificateManager
    {
        if (!$this->certManager) {
            $this->certManager = new CertificateManager($this->getSecretManager(), $this->getEnv());
        }
        return $this->certManager;
    }

    private function getMAISClient(): MAISClient
    {
        if (!$this->maisClient) {
            $url = $this->getEnv() === 'PROD'
                ? 'https://registry.stanford.edu'
                : 'https://registry-uat.stanford.edu';
            $this->maisClient = new MAISClient($url, $this->getCertManager());
        }
        return $this->maisClient;
    }

    public function get($uri): string
    {
        try {
            $content = $this->getMAISClient()->get($uri);
        } catch (\Exception $e) {
            throw new \Exception("API call failed: " . $e->getMessage());
        } finally {
            // Always clean up temp certs / reset clients after each call
            $this->getCertManager()->cleanup();
            $this->maisClient = null;
            $this->secretManager = null;
            $this->certManager = null;
        }
        return $content;
    }

    public function includeFile($path)
    {
        include_once $path;
    }

    public function redcap_survey_page($project_id, $record, $instrument, $event_id, $group_id, $survey_hash, $response_id = null, $repeat_instance = 1)
    {
        if ($this->getProjectSetting('sunetid-field') !== '') {
            $this->record = $record;
            if ($this->isWebauthSurveyPage()) {
                // JSMO ajax is unusable here: the framework only treats URLs starting with
                // APP_PATH_SURVEY ("/surveys/") as surveys, so on /webauth/surveys/ it builds an
                // authenticated, non-survey endpoint that a respondent can never satisfy.
                try {
                    $this->webauthContext = [
                        'endpoint' => $this->getWebauthEndpoint(),
                        'token'    => $this->issueWebauthToken([
                            'pid'  => (int)$project_id,
                            's'    => (string)$survey_hash,
                            'rec'  => (string)$record,
                            'ins'  => (string)$instrument,
                            'evt'  => (int)$event_id,
                            'inst' => (int)$repeat_instance,
                            'u'    => (string)$_SERVER['REMOTE_USER'],
                        ]),
                    ];
                } catch (\Throwable $t) {
                    // Never break the survey page; the lookup falls back to JSMO ajax.
                    \REDCap::logEvent('MaIS WebAuth lookup setup failed', $t->getMessage());
                }
            }
            $this->includeFile('pages/mais_lookup.php');
        }
    }

    public function getWebauthContext(): ?array
    {
        return $this->webauthContext;
    }

    /**
     * True when the current request is a survey served under the WebAuth path prefix
     * with an authenticated user (REMOTE_USER is set by Apache OIDC on prod).
     */
    private function isWebauthSurveyPage(): bool
    {
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        return strpos($uri, self::WEBAUTH_PATH_PREFIX . APP_PATH_SURVEY) === 0
            && !empty($_SERVER['REMOTE_USER']);
    }

    /**
     * Module API URL for pages/webauth_ajax, moved under the WebAuth prefix so Apache
     * requires OIDC for every lookup/save request. Host-relative on purpose: prod answers on
     * several hostnames (ServerAlias), and the request must stay same-origin with the page
     * so the OIDC session cookie is sent.
     */
    private function getWebauthEndpoint(): string
    {
        $parts = parse_url($this->getUrl('pages/webauth_ajax.php', true, true));
        return self::WEBAUTH_PATH_PREFIX . $parts['path'] . '?' . $parts['query'];
    }

    private function getWebauthTokenKey(): string
    {
        $salt = $GLOBALS['salt'] ?? '';
        if ($salt === '') {
            throw new \Exception('Cannot sign WebAuth lookup token: REDCap salt is not available.');
        }
        return hash('sha256', 'MaISlookup-webauth-token|' . $salt, true);
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $data): string
    {
        return (string)base64_decode(strtr($data, '-_', '+/'));
    }

    private function issueWebauthToken(array $claims): string
    {
        $claims['exp'] = time() + self::WEBAUTH_TOKEN_TTL;
        $body = self::base64UrlEncode(json_encode($claims));
        $sig = self::base64UrlEncode(hash_hmac('sha256', $body, $this->getWebauthTokenKey(), true));
        return $body . '.' . $sig;
    }

    /**
     * @return array verified claims
     * @throws \Exception when the token is malformed, forged, expired or for another project/user
     */
    private function verifyWebauthToken(string $token, string $remoteUser): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 2) {
            throw new \Exception('Invalid lookup token.');
        }
        [$body, $sig] = $parts;
        $expected = self::base64UrlEncode(hash_hmac('sha256', $body, $this->getWebauthTokenKey(), true));
        if (!hash_equals($expected, $sig)) {
            throw new \Exception('Invalid lookup token.');
        }
        $claims = json_decode(self::base64UrlDecode($body), true);
        if (!is_array($claims)) {
            throw new \Exception('Invalid lookup token.');
        }
        if (($claims['exp'] ?? 0) < time()) {
            throw new WebauthSessionException('Lookup token expired.');
        }
        if ((int)($claims['pid'] ?? 0) !== (int)$this->getProjectId()) {
            throw new \Exception('Lookup token does not match this project.');
        }
        if (($claims['u'] ?? '') !== $remoteUser) {
            throw new WebauthSessionException('Lookup token does not match the logged-in user.');
        }
        return $claims;
    }

    /**
     * Handles POSTs to pages/webauth_ajax (WebAuth surveys only). Same actions and response
     * shape as redcap_module_ajax, so the JS treats both transports identically.
     */
    public function handleWebauthAjax(): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        try {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
                http_response_code(405);
                throw new \Exception('Method not allowed.');
            }
            $remoteUser = $_SERVER['REMOTE_USER'] ?? '';
            if ($remoteUser === '') {
                throw new WebauthSessionException('Not logged in.');
            }
            $request = json_decode((string)file_get_contents('php://input'), true);
            if (!is_array($request)) {
                http_response_code(400);
                throw new \Exception('Invalid request.');
            }
            $claims = $this->verifyWebauthToken((string)($request['token'] ?? ''), $remoteUser);
            $payload = is_array($request['payload'] ?? null) ? $request['payload'] : [];
            $action = (string)($request['action'] ?? '');
            $result = match ($action) {
                'lookupUser' => $this->lookupUser($payload),
                'saveUser'   => $this->saveUser($payload, $claims['rec']),
                default      => throw new \Exception("Action $action is not defined"),
            };
            echo json_encode($result);
        } catch (WebauthSessionException $e) {
            http_response_code(401);
            echo json_encode(['success' => false, 'sessionExpired' => true, 'message' => $e->getMessage()]);
        } catch (\Exception $e) {
            \REDCap::logEvent($e);
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
    }

    public function redcap_data_entry_form_top($project_id, $record, $instrument, $event_id, $group_id = null, $repeat_instance = 1)
    {
        if ($this->getProjectSetting('sunetid-field') !== '') {
            $this->record = $record;
            $this->includeFile('pages/mais_lookup.php');
        }
    }

    public function redcap_module_ajax(
        $action,
        $payload,
        $project_id,
        $record,
        $instrument,
        $event_id,
        $repeat_instance,
        $survey_hash,
        $response_id,
        $survey_queue_hash,
        $page,
        $page_full,
        $user_id,
        $group_id
    ) {
        try {
            return match ($action) {
                'lookupUser' => $this->lookupUser($payload),
                // Save into the framework-verified record, never a client-supplied id.
                'saveUser'   => $this->saveUser($payload, (string)$record),
                default      => throw new \Exception("Action $action is not defined"),
            };
        } catch (\Exception $e) {
            \REDCap::logEvent($e);
            return [
                "success" => false,
                'message' => $e->getMessage()
            ];
        }
    }

    private function getValueByPath(array $array, string $path)
    {
        // Remove leading/trailing brackets and split by ][
        $keys = explode('][', trim($path, '[]'));

        foreach ($keys as $key) {
            if (!is_array($array) || !array_key_exists($key, $array)) {
                return null;
            }
            $array = $array[$key];
        }

        return $array;
    }

    /**
     * Map MAIS API data to mapped fields, save private ones, return public ones.
     * Performs concurrent fetches for data sections, then merges.
     * @param string $record verified record id (JSMO verification or signed WebAuth token)
     * @throws \Exception
     */
    public function saveUser($payload, string $record)
    {
        try {
            $dataToSave[$this->getRecordIdField()] = $record;
            $dataToReturn = [];
            $mappedAttributes = $this->getSubSettings('attribute_instance');
            $sunetId = $payload['sunetId'];

            $types = ['affiliation', 'biodemo', 'telephone', 'email', 'name'];

            // Kick off all async requests
            $promises = [];
            foreach ($types as $t) {
                $promises[$t] = $this->getUserDataAsync($sunetId, $t);
            }

            // Wait until all settle (no early throw)
            $results = Utils::settle($promises)->wait();

            // Merge fulfilled results
            $merged = [];
            foreach ($results as $t => $result) {
                if ($result['state'] === 'fulfilled') {
                    $merged = array_replace_recursive($merged, $result['value']);
                } else {
                    \REDCap::logEvent("Error fetching $t for $sunetId: " . (string)$result['reason']);
                }
            }

            $data = $merged;
            $selectedIndex = $payload['index'] ?? 0;

            foreach ($mappedAttributes as $mappedAttribute) {
                $redcapField = $mappedAttribute['redcap-field'];
                $maisApiAttribute = $mappedAttribute['mais-api-attribute'];

                // Replace placeholder index [#] with selected index
                $maisApiAttribute = str_replace('[#]', "[$selectedIndex]", $maisApiAttribute);

                $value = $this->getValueByPath($data, $maisApiAttribute);
                if ($value === null) {
                    continue;
                }

                if ($mappedAttribute['attribute-visibility'] == 'private') {
                    $dataToSave[$redcapField] = $value;
                } else {
                    $dataToReturn['data'][$redcapField] = $value;
                }
            }

            $response = \REDCap::saveData($this->getProjectId(), 'json', json_encode([$dataToSave]));
            if ($response['errors']) {
                if (is_array($response['errors'])) {
                    throw new \Exception(implode(",", $response['errors']));
                } else {
                    throw new \Exception($response['errors']);
                }
            }

            $dataToReturn['success'] = true;
            return $dataToReturn;

        } catch (\Exception $e) {
            throw new \Exception("API call failed: " . $e->getMessage());
        } finally {
            // Ensure temporary cert files and clients are cleaned up after async batch
            try { $this->getCertManager()->cleanup(); } catch (\Throwable $t) {}
            $this->maisClient = null;
            $this->secretManager = null;
            $this->certManager = null;
        }
    }

    public function lookupUser($payload)
    {
        try {
            $sunetId = strtolower($payload['sunetId']);
            $data = [];
            $data[$sunetId] = $this->buildAffiliationModalArray($sunetId);
            $data['success'] = true;
            return $data;
        } catch (\Exception $e) {
            throw new \Exception("API call failed: " . $e->getMessage());
        }
    }

    private function buildAffiliationModalArray($sunetId)
    {
        $data = [];
        // If user has one affiliation, wrap to array to normalize structure
        $affiliation = $this->getUserData($sunetId, "affiliation");
        $name = $affiliation['@attributes']['name'];
        foreach ($affiliation['affiliation'] as $index => $affiliation) {
            $data[$index] = [
                'sunetId'    => $sunetId,
                'name'       => $name,
                'affiliation'=> $affiliation['#text'],
                'type'       => $affiliation['@attributes']['type'] ?? '',
                'department' => $affiliation['department']['#text'] ?? '',
            ];
        }
        return $data;
    }

    /**
     * Async fetch of user data section; returns a Promise that resolves to normalized array.
     */
    public function getUserDataAsync(string $sunetId, string $type = ''): PromiseInterface
    {
        $url = $type !== '' ? "doc/person/$sunetId/$type" : "doc/person/$sunetId";

        // IMPORTANT: use the MAIS client (not a non-existent $this->client)
        return $this->getMAISClient()->getAsync($url)->then(function ($res) use ($type, $sunetId) {
            $xmlString = (string)$res->getBody();

            $xml = @simplexml_load_string($xmlString);
            if ($xml === false) {
                throw new \RuntimeException("Invalid XML for $sunetId/$type");
            }

            $converted = Utilities::simplexmlToArray($xml);
            $array = json_decode(json_encode($converted, JSON_UNESCAPED_SLASHES), true);

            // Normalize: if `$type` exists but isn't an array, wrap it
            if ($type !== '' && isset($array[$type]) && !isset($array[$type][0])) {
                $tmp = $array[$type];
                $array[$type] = [$tmp];
            }

            return $array; // resolved value
        });
    }

    /**
     * Synchronous fetch used in places where we don't need concurrency.
     */
    public function getUserData($sunetId, $type = '')
    {
        try {
            if ($type !== '') {
                $xmlString = $this->get("doc/person/$sunetId/$type");
            } else {
                $xmlString = $this->get("doc/person/$sunetId");
            }
            $xml = simplexml_load_string($xmlString);
            $converted = Utilities::simplexmlToArray($xml);
            $json = json_encode($converted, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            $array = json_decode($json, true);

            // Normalize single item to array when a section contains only one element
            if ($type !== '') {
                if (!isset($array[$type][0])) {
                    $temp = $array[$type];
                    unset($array[$type]);
                    $array[$type][] = $temp;
                }
            }
            return $array;
        } catch (\Exception $e) {
            \REDCap::logEvent("Error fetching user data for $sunetId: " . $e->getMessage());
            throw new \Exception("Error fetching user data for $sunetId: " . $e->getMessage());
        }
    }

    public function injectJSMO($data = null, $init_method = null)
    {
        // -------- FIX: Ensure a REDCap CSRF token exists in $_SESSION before the
        // framework tries to build JSMO ajax settings. On some prod configurations
        // (notably public survey pages on iOS), $_SESSION['redcap_csrf_token'] is
        // not auto-populated for the request. The framework's getAjaxSettings()
        // then calls initAjaxCrypto(false) which throws
        // "A token must be specified for ajax encryption." The framework swallows
        // the exception and returns []  ->  client-side ajaxSettings.endpoint is
        // undefined  ->  fetch(undefined) resolves to the current page URL  ->
        // returns the survey HTML  ->  JSON.parse fails with "Unrecognized token '<'".
        try {
            if (session_status() !== PHP_SESSION_ACTIVE) {
                @session_start();
            }
            if (class_exists('\System')) {
                $hasToken = method_exists('\System', 'getCsrfToken') ? \System::getCsrfToken() : false;
                if ($hasToken === false && method_exists('\System', 'generateCsrfToken')) {
                    \System::generateCsrfToken();
                }
            }
        } catch (\Throwable $t) {
            error_log('[MaIS injectJSMO] CSRF token bootstrap failed: ' . $t->getMessage());
        }

        // -------- Diagnostic: probe the framework's getAjaxSettings() ourselves so we
        // can see WHY ajaxSettings.endpoint may be undefined client-side. The framework
        // wraps that call in try/catch and silently sets $ajax_settings=[] on throw,
        // which leads to fetch(undefined) -> fetches the current page (HTML) ->
        // JSON.parse fails with "Unrecognized token '<'".
        $jsmoDiag = ['ok' => false, 'reason' => 'not-attempted', 'keys' => [], 'endpointPresent' => false];
        try {
            $framework = method_exists($this, 'framework') ? $this->framework : null;
            // The framework instance lives at $this->framework on v6+ JSMO-aware modules.
            // getAjaxSettings is on the Framework class. If not reachable, fall back to reflection.
            $settings = $this->getAjaxSettings();

            if (is_array($settings)) {
                $jsmoDiag['ok'] = true;
                $jsmoDiag['reason'] = '';
                $jsmoDiag['keys'] = array_keys($settings);
                $jsmoDiag['endpointPresent'] = !empty($settings['endpoint']);
                $jsmoDiag['endpoint'] = $settings['endpoint'] ?? null;
            }
        } catch (\Throwable $t) {
            $jsmoDiag['ok'] = false;
            $jsmoDiag['reason'] = get_class($t) . ': ' . $t->getMessage();
            // Also write to error_log and REDCap log so admins can find it server-side.
            $msg = '[MaIS injectJSMO] getAjaxSettings() threw: ' . $jsmoDiag['reason']
                 . "\n" . $t->getTraceAsString();
            error_log($msg);
            try { \REDCap::logEvent('MaIS JSMO setup failure', $msg); } catch (\Throwable $_) {}
        }

        echo $this->initializeJavascriptModuleObject();
        $cmds = [
            "const module = " . $this->getJavascriptModuleObjectName()
        ];
        if (!empty($data)) $cmds[] = "module.data = " . json_encode($data);
        if (!empty($init_method)) $cmds[] = "module.afterRender(module." . $init_method . ")";

        // Cache-bust the JSMO script with the file mtime. iOS Safari aggressively
        // caches /modules/<prefix>/assets/jsmo.js, and the framework's built-in
        // versioning has not been strong enough for some users — append `&_v=<mtime>`
        // (or `?_v=<mtime>` if the URL has no query string yet).
        $jsmoPath = __DIR__ . '/assets/jsmo.js';
        $jsmoVer  = @filemtime($jsmoPath) ?: time();
        $jsmoUrl  = $this->getUrl('assets/jsmo.js', true);
        $jsmoUrl .= (strpos($jsmoUrl, '?') === false ? '?' : '&') . '_v=' . $jsmoVer;
        ?>
        <script src="<?=$jsmoUrl?>"></script>
        <script>
            // Boot marker so the in-modal diagnostic can confirm the latest jsmo.js loaded.
            try { window.__maisJsmoVer = "<?=$jsmoVer?>"; } catch (e) {}
            // Server-side probe of getAjaxSettings() so the in-modal diagnostic can show
            // whether the framework built a valid endpoint. If `ok:false`, the message
            // will identify the underlying PHP exception (e.g. crypto / verification).
            try { window.__maisJsmoServerDiag = <?=json_encode($jsmoDiag)?>; } catch (e) {}
        </script>
        <?php
    }

    public function getMappedAttributes()
    {
        $attributes = $this->getSubSettings('attribute_instance');
        $mappedAttributes = [];
        foreach ($attributes as $attribute) {
            $mappedAttributes[$attribute['redcap-field']] = [
                $attribute['mais-api-attribute'],
                $attribute['attribute-visibility'],
            ];
        }
        return $mappedAttributes;
    }

    /**
     * Recursively print a “path → value” list for a multidimensional array.
     */
    public function printPaths(array $data, string $path = ''): void
    {
        if ($path === '') {
            echo '<ul>' . PHP_EOL;
        }
        foreach ($data as $key => $value) {
            $currentPath = $path . '[' . $key . ']';
            if (is_array($value)) {
                $this->printPaths($value, $currentPath);
            } else {
                echo '<li><strong>' . $currentPath . '</strong> -> ' . htmlspecialchars((string)$value) . '</li>' . PHP_EOL;
            }
        }
        if ($path === '') {
            echo '</ul>' . PHP_EOL;
        }
    }
}
