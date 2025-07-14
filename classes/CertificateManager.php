<?php
namespace Stanford\MaISlookup;

class CertificateManager {
    private $secretManager;
    private $envPrefix;

    private $certFile;
    private $keyFile;
    private $passphrase;

    public function __construct(GoogleSecretManager $sm, string $envPrefix) {
        $this->secretManager = $sm;
        $this->envPrefix = $envPrefix;
    }

    public function getCertFile(): string {
        if (!$this->certFile) {
            $this->certFile = $this->createTempFile('EHS_CERT');
        }
        return $this->certFile;
    }

    public function getKeyFile(): string {
        if (!$this->keyFile) {
            $this->keyFile = $this->createTempFile('EHS_PRIVATE_KEY');
        }
        return $this->keyFile;
    }

    public function getPassphrase(): ?string {
        if ($this->passphrase === null) {
            $this->passphrase = $this->secretManager->getSecret("{$this->envPrefix}_EHS_PASSPHRASE");
        }
        # if value is N/A then no passphrase for the Cert and passphrase has to be null
        return $this->passphrase == 'null' ? null : $this->passphrase;
    }

    private function createTempFile(string $suffix): string {
        $value = $this->secretManager->getSecret("{$this->envPrefix}_$suffix");
        $file = tempnam(sys_get_temp_dir(), strtolower($suffix)) . '.pem';
        file_put_contents($file, $value);
        return $file;
    }

    public function cleanup(): void {
        @unlink($this->certFile);
        @unlink($this->keyFile);
    }
}
