<?php
namespace Stanford\MaISlookup;

use GuzzleHttp\Client;

class MAISClient {
    private $client;
    private $url;
    private $certManager;

    public function __construct(string $url, CertificateManager $certManager) {
        $this->url = $url;
        $this->certManager = $certManager;
    }

    private function initClient(): void {
        if (!$this->client) {
            $this->client = new Client([
                'base_uri' => $this->url,
                'cert'     => [$this->certManager->getCertFile(), null],
                'ssl_key'  => [$this->certManager->getKeyFile(), $this->certManager->getPassphrase()]
            ]);
        }
    }

    public function get(string $uri): string {
        $this->initClient();
        return $this->client->get($uri)->getBody()->getContents();
    }
}
