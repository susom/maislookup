<?php


namespace Stanford\MaISlookup;

require_once 'vendor/autoload.php';
require_once 'classes/GoogleSecretManager.php';
require_once 'classes/CertificateManager.php';
require_once 'classes/MAISClient.php';
require_once 'classes/Utilities.php';
namespace Stanford\MaISlookup;

use phpseclib3\Crypt\EC\Formats\Keys\XML;

class MaISlookup extends \ExternalModules\AbstractExternalModule {
    private $secretManager;
    private $certManager;
    private $maisClient;

    public function __construct() {
        parent::__construct();

    }
    private function getEnv(): string {
        return $this->getProjectSetting('ehs-environment') ?: 'UAT';
    }

    private function getKeyJson(): ?string {
        return $this->getProjectSetting('google-service-account-json-key') ?: null;
    }

    private function getSecretManager(): GoogleSecretManager {
        if (!$this->secretManager) {
            $this->secretManager = new GoogleSecretManager(
                $this->getProjectSetting('google-project-id'),
                $this->getKeyJson()
            );
        }
        return $this->secretManager;
    }

    private function getCertManager(): CertificateManager {
        if (!$this->certManager) {
            $this->certManager = new CertificateManager($this->getSecretManager(), $this->getEnv());
        }
        return $this->certManager;
    }

    private function getMAISClient(): MAISClient {
        if (!$this->maisClient) {
            $url = $this->getEnv() === 'PROD' ? 'https://registry.stanford.edu' : 'https://registry-uat.stanford.edu';
            $this->maisClient = new MAISClient($url, $this->getCertManager());
        }
        return $this->maisClient;
    }

    public function get($uri): string {
        try {
            $content = $this->getMAISClient()->get($uri);
        } catch (\Exception $e) {
            echo "API call failed: " . $e->getMessage();
        } finally {
            $this->getCertManager()->cleanup();
        }
        return $content;
    }


}
