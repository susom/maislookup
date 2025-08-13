<?php
namespace Stanford\MaISlookup;

use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Promise\Utils;

/** @var \Stanford\MaISlookup\MaISlookup $module */



try{
    $sunetId = USERID;
    echo '<h2>MAIS Lookup Results for ' . $sunetId . '</h2>';
    echo '<p>Copy the path to the value you want. Replace the first number with #</p>';
    echo '<pre>';
    $types = ['affiliation', 'biodemo', 'telephone', 'email', 'name'];

    // Kick off all async requests
    $promises = [];
    foreach ($types as $t) {
        $promises[$t] = $module->getUserDataAsync($sunetId, $t);
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
    $module->printPaths($merged);
    echo '</pre>';
}
catch (\Exception $e) {
    echo "<div class='alert alert-danger'>".$e->getMessage()."</div> ";
}
