<?php


namespace Stanford\MaISlookup;

require_once 'vendor/autoload.php';
require_once 'classes/GoogleSecretManager.php';
require_once 'classes/CertificateManager.php';
require_once 'classes/MAISClient.php';
require_once 'classes/Utilities.php';

namespace Stanford\MaISlookup;


class MaISlookup extends \ExternalModules\AbstractExternalModule
{
    private $secretManager;
    private $certManager;
    private $maisClient;

    private $record;
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
            $url = $this->getEnv() === 'PROD' ? 'https://registry.stanford.edu' : 'https://registry-uat.stanford.edu';
            $this->maisClient = new MAISClient($url, $this->getCertManager());
        }
        return $this->maisClient;
    }

    public function get($uri): string
    {
        try {
            $content = $this->getMAISClient()->get($uri);
        } catch (\Exception $e) {
            throw new \Exception( "API call failed: " . $e->getMessage());
        } finally {
            $this->getCertManager()->cleanup();
            // temp file are deleted so we need to re-init them for next API call.
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
    public function redcap_survey_page(  $project_id,  $record,  $instrument,  $event_id,  $group_id,  $survey_hash,  $response_id = NULL,  $repeat_instance = 1 )
    {
        if($this->getProjectSetting('sunetid-field') !== '') {
            $this->record = $record;
            $this->includeFile('pages/mais_lookup.php');
        }
    }

    public function redcap_data_entry_form_top(  $project_id,  $record,  $instrument,  $event_id,  $group_id = NULL,  $repeat_instance = 1 )
    {
        if($this->getProjectSetting('sunetid-field') !== '') {
            $this->record = $record;
            $this->includeFile('pages/mais_lookup.php');
        }
    }

    public function redcap_module_ajax($action, $payload, $project_id, $record, $instrument, $event_id, $repeat_instance,
                                       $survey_hash, $response_id, $survey_queue_hash, $page, $page_full, $user_id, $group_id)
    {
        try {
//            $sanitized = $this->sanitizeInput($payload);
            return match ($action) {
                'lookupUser' => $this->lookupUser($payload),
                'saveUser' => $this->saveUser($payload),
                default => throw new Exception ("Action $action is not defined"),
            };
        } catch (\Exception $e) {
            // log error
            \REDCap::logEvent($e);
            return [
                "success" => false,
                'message' => $e->getMessage()
            ];
        }
    }

    private function getValueByPath(array $array, string $path) {
        // Remove leading/trailing brackets and split by ][
        $keys = explode('][', trim($path, '[]'));

        foreach ($keys as $key) {
            if (!is_array($array) || !array_key_exists($key, $array)) {
                return null; // Or throw exception
            }
            $array = $array[$key];
        }

        return $array;
    }
    /***
     * this function will map MAIS api data to the mapped fields and save the private ones and return the public ones.
     * @param $payload
     * @return array
     * @throws \Exception
     */

    public function saveUser($payload)
    {
        try{
            $dataToSave[\REDCap::getRecordIdField()] = $payload['record_id'];
            $dataToReturn = [];
            $mappedAttributes = $this->getSubSettings('attribute_instance');
            $sunetId = $payload['sunetId'];
            $data = $this->getUserData($sunetId);
            $selectedIndex = $payload['index'] ?? 0;
            foreach($mappedAttributes as $mappedAttribute) {
                $redcapField = $mappedAttribute['redcap-field'];
                $maisApiAttribute = $mappedAttribute['mais-api-attribute'];
                $maisApiAttribute = str_replace('[#]', "[$selectedIndex]", $maisApiAttribute); // remove the [] from the attribute name if it exists.
                $value = $this->getValueByPath($data, $maisApiAttribute);
                if($value === null) {
                    // if the value is null, we skip it.
                    continue;
                }
                if($mappedAttribute['attribute-visibility'] == 'private') {
                    // if the attribute is private, we save it in the private field.
                    $dataToSave[$redcapField] = $value;
                }else{
                    // if the attribute is public, we save it in the public field.
                    $dataToReturn['data'][$redcapField] = $value;
                }
            }
            $response = \REDCap::saveData($this->getProjectId(), 'json', json_encode(array($dataToSave)));
            if($response['errors']) {
                if (is_array($response['errors'])) {
                    throw new \Exception(implode(",", $response['errors']));
                } else {
                    throw new \Exception($response['errors']);
                }
            }
            $dataToReturn['success'] = true;
            return $dataToReturn;
        }catch (\Exception $e){
            throw new \Exception( "API call failed: " . $e->getMessage());
        }
    }
    public function lookupUser($payload)
    {
        try{
            $sunetId = $payload['sunetId'];
            $data = [];
            $data[$sunetId] = $this->buildAffiliationModalArray($sunetId);
            $data['success'] = true;
            return $data;
        }catch (\Exception $e) {
            throw new \Exception( "API call failed: " . $e->getMessage());
        }
    }

    private function buildAffiliationModalArray($sunetId)
    {
        $data = [];
        # if user has one affiliation put it in the array to match the structure of the other user.
        $affiliation = $this->getUserData($sunetId, "affiliation");
        $name = $affiliation['@attributes']['name'];
        foreach ($affiliation['affiliation'] as $index => $affiliation) {
            $data[$index]  = [
                'sunetId' => $sunetId,
                'name' => $name,
                'affiliation' => $affiliation['#text'],
                'type' => $affiliation['@attributes']['type'] ?? '',
                'department' => $affiliation['department']['#text'] ?? '',
            ];
        }
        return $data;
    }

    public function getUserData($sunetId, $type = '')
    {
        try{
            if($type !== '') {
                $xmlString = $this->get("doc/person/$sunetId/$type");
            }else{
                $xmlString = $this->get("doc/person/$sunetId");
            }
            $xml = simplexml_load_string($xmlString);
            $converted = Utilities::simplexmlToArray($xml);
            $json = json_encode($converted, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            $array = json_decode($json, true);
            // workaround for the fact that the XML response is not consistent in structure. if the user has only one of the type, it is not an array.
            if($type !== '') {
                if(!isset($array[$type][0])) {
                    $temp = $array[$type];
                    unset($array[$type]);
                    $array[$type][] = $temp;
                }
            }
            return $array;
        }catch (\Exception $e) {
            \REDCap::logEvent("Error fetching user data for $sunetId: " . $e->getMessage());
            throw new \Exception("Error fetching user data for $sunetId: " . $e->getMessage());
        }
    }

    public function injectJSMO($data = null, $init_method = null) {
        echo $this->initializeJavascriptModuleObject();
        $cmds = [
            "const module = " . $this->getJavascriptModuleObjectName()
        ];
        if (!empty($data)) $cmds[] = "module.data = " . json_encode($data);
        if (!empty($init_method)) $cmds[] = "module.afterRender(module." . $init_method . ")";
        ?>
        <script src="<?=$this->getUrl("assets/jsmo.js",true)?>"></script>
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
     *
     * @param array  $data   The array to walk through.
     * @param string $prefix Current path (used internally on recursion).
     * @param string $sep    Path separator (default is a dot).
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
                echo '<li><strong>' . $currentPath . '</strong> -> ' . $value . '</li>' . PHP_EOL;
            }
        }
        if ($path === '') {
            echo '</ul>' . PHP_EOL;
        }
    }
}
