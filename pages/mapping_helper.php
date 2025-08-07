<?php
namespace Stanford\MaISlookup;

use GuzzleHttp\Exception\GuzzleException;

/** @var \Stanford\MaISlookup\MaISlookup $module */



try{
    $sunetId = USERID;
    echo '<h2>MAIS Lookup Results for ' . $sunetId . '</h2>';
    echo '<p>Copy the path to the value you want. Replace the first number with #</p>';
    echo '<pre>';
    $module->printPaths(array_merge( $module->getUserData($sunetId, 'affiliation'),
         $module->getUserData($sunetId, 'biodemo'),
         $module->getUserData($sunetId, 'telephone'),
         $module->getUserData($sunetId, 'email'),
         $module->getUserData($sunetId, 'name'),
    ));
    echo '</pre>';
}
catch (\Exception $e) {
    echo "<div class='alert alert-danger'>".$e->getMessage()."</div> ";
}
