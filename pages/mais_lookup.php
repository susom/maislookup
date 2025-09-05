<?php
namespace Stanford\MaISlookup;

use GuzzleHttp\Exception\GuzzleException;

/** @var \Stanford\MaISlookup\MaISlookup $this */


$this->injectJSMO();
?>
<link rel="stylesheet" href="https://code.jquery.com/ui/1.14.1/themes/base/jquery-ui.css">
<link rel="stylesheet" href="/resources/demos/style.css">
<script src="https://code.jquery.com/ui/1.14.1/jquery-ui.js"></script>
<style>
    .custom-loader {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 255, 255, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }

    .custom-loader::after {
        content: "";
        width: 50px;
        height: 50px;
        border: 5px solid #f3f3f3;
        border-top: 5px solid #3498db;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        0% {
            transform: rotate(0deg);
        }
        100% {
            transform: rotate(360deg);
        }
    }
</style>
<div id="ajax-loader"  style="display: none;" class="custom-loader"></div>
<div id="dialog" title="Basic dialog">
    <div class="container">
        <div id="dialog-body"></div>
    </div>
</div>
<script>
    document.addEventListener("DOMContentLoaded", function () {
        jsmoObject = ExternalModules.Stanford.MaISlookup;
        jsmoObject.sunetId = "<?php echo $this->getProjectSetting('sunetid-field') ?>"
        jsmoObject.mappedAttributes = <?php echo json_encode($this->getMappedAttributes()) ?>;
        jsmoObject.record_id = "<?php echo $this->record ?>";
        jsmoObject.init()
    });
</script>
