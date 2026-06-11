<?php
namespace Stanford\MaISlookup;

use GuzzleHttp\Exception\GuzzleException;

/** @var \Stanford\MaISlookup\MaISlookup $this */


$this->injectJSMO();
?>
<style>
    /* Loader overlay */
    .mais-loader {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 255, 255, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 200000;
        -webkit-tap-highlight-color: transparent;
    }
    .mais-loader::after {
        content: "";
        width: 50px;
        height: 50px;
        border: 5px solid #f3f3f3;
        border-top: 5px solid #3498db;
        border-radius: 50%;
        animation: mais-spin 1s linear infinite;
    }
    @keyframes mais-spin {
        0%   { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    /* Custom modal — vanilla, iOS Safari friendly. No transforms, no animations. */
    #mais-modal {
        position: fixed;
        inset: 0;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 200001;
        display: none;
    }
    #mais-modal.is-open { display: block; }

    #mais-modal .mais-backdrop {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1;
    }
    #mais-modal .mais-dialog {
        position: relative;
        z-index: 2;
        margin: 5vh auto;
        max-width: 600px;
        width: calc(100% - 24px);
        max-height: 90vh;
        background: #fff;
        border-radius: 6px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    #mais-modal .mais-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid #ddd;
        background: #f8f9fa;
    }
    #mais-modal .mais-title {
        font-size: 1rem;
        font-weight: 600;
        margin: 0;
    }
    #mais-modal .mais-close {
        background: transparent;
        border: 0;
        font-size: 22px;
        line-height: 1;
        padding: 4px 10px;
        cursor: pointer;
        color: #333;
        -webkit-appearance: none;
    }
    #mais-modal .mais-body {
        padding: 14px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        flex: 1 1 auto;
    }
    body.mais-modal-open {
        overflow: hidden;
    }
</style>

<div id="ajax-loader" class="mais-loader" style="display: none;"></div>

<div id="mais-modal" role="dialog" aria-modal="true" aria-labelledby="mais-modal-title" aria-hidden="true">
    <div class="mais-backdrop" data-mais-close="1"></div>
    <div class="mais-dialog">
        <div class="mais-header">
            <h5 class="mais-title" id="mais-modal-title">MaIS Lookup</h5>
            <button type="button" class="mais-close" aria-label="Close" data-mais-close="1">&#10005;</button>
        </div>
        <div class="mais-body">
            <div id="dialog-body"></div>
        </div>
    </div>
</div>

<script>
    document.addEventListener("DOMContentLoaded", function () {
        var jsmoObject = ExternalModules.Stanford.MaISlookup;
        jsmoObject.sunetId = "<?php echo $this->getProjectSetting('sunetid-field') ?>";
        jsmoObject.mappedAttributes = <?php echo json_encode($this->getMappedAttributes()) ?>;
        jsmoObject.record_id = "<?php echo $this->record ?>";
        jsmoObject.init();
    });
</script>
