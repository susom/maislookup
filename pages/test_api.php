<?php
namespace Stanford\MaISlookup;

use GuzzleHttp\Exception\GuzzleException;

/** @var \Stanford\MaISlookup\MaISlookup $module */



try{
    $xmlString = $module->get('doc/person/ihabz/affiliation');
    $xml = simplexml_load_string($xmlString);
    $converted = Utilities::simplexmlToArray($xml);
    $json = json_encode($converted, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    $array = json_decode($json, true);
    echo '<pre>';
    print_r($array);
    echo '</pre>';
}
catch (GuzzleException $e) {

}catch (\Exception $e) {

}
