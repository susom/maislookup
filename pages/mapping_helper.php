<?php
namespace Stanford\MaISlookup;

use GuzzleHttp\Exception\GuzzleException;

/** @var \Stanford\MaISlookup\MaISlookup $module */



try{
    $sunetId = USERID;
    $array = $module->lookupUser(array('sunetId' => $sunetId));
    echo '<h2>MAIS Lookup Results for ' . $sunetId . '</h2>';
    echo '<p>Copy the path to the value you want. Replace the first number with #</p>';
    echo '<pre>';
    $module->printPaths(array(
        'affiliation' => $array[$sunetId]['affiliation'],
        'biodemo' => $array[$sunetId]['biodemo']
    ));
    echo '</pre>';
}
catch (GuzzleException $e) {

}catch (\Exception $e) {

}
