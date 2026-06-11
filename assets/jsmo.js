// This file extends the default JSMO object with methods for this EM
;
{
    // Define the jsmo in IIFE so we can reference object in our new function methods
    const module = ExternalModules.Stanford.MaISlookup;

    Object.assign(module, {
        user: {},
        sunetId: '',
        mappedAttributes: {},
        su_value: '',
        record_id: '',
        init: function (callback, errorCallback) {
            let e = document.querySelector('[name="' + module.sunetId + '"]');

            if (e) {
                e.addEventListener("blur", function () {
                    try {
                        module.lookupUser(this.value);
                    } catch (err) {
                        if (errorCallback) errorCallback(err);
                    }
                });
            } else {
                if (errorCallback) errorCallback(`Element with name="${module.sunetId}" not found`);
            }
            // Initialize the dialog once with all stable options.
            // NOTE: The previous `show: { effect: "blind", duration: 500 }` option
            // caused the dialog to "flash and disappear" on iOS Safari (the blind
            // effect manipulates `clip`/wrapper styles that iOS often leaves in a
            // hidden state). Removing it fixes the modal-not-showing bug on iPhone.
            $("#dialog").dialog({
                autoOpen: false,
                modal: true,
                width: 600,
                appendTo: "body",
                open: function () {
                    // Replace the default close icon with a big "×"
                    $(this).parent().find(".ui-dialog-titlebar-close")
                        .html("&#10005;") // Unicode × symbol
                        .css({
                            "font-size": "12px",
                            "font-weight": "bold",
                            "color": "#333",
                            "text-align": "center"
                        });
                }
            });

            // Listen for affiliation radio selection.
            // NOTE: iOS Safari does not reliably fire the `input` event on radio
            // inputs; use `change` (which is fired consistently across browsers)
            // and also listen for `click` as a belt-and-suspenders fallback for
            // older iOS versions where delegated `change` on radios can be flaky.
            const onAffiliationPicked = function (e) {
                if (e.target && e.target.name === 'affiliation' && e.target.checked) {
                    console.log('Affiliation selected:', e.target.value);
                    module.saveUser(e.target.value);
                }
            };
            document.body.addEventListener('change', onAffiliationPicked);
            document.body.addEventListener('click', onAffiliationPicked);
        },
        saveUser: function (index, callback, errorCallback) {
            console.log('Index:', index);
            console.log('Saving user with Sunet ID:', this.su_value);
            module.ajax('saveUser', {'sunetId': this.su_value, 'index': index, 'record_id': this.record_id})
                .then(function (response) {
                        if (response?.success) {
                            for (const key in response?.data) {
                                var e = document.querySelector('[name="' + key + '"]');
                                if (e !== undefined) {
                                    e.value = response?.data[key] || '';
                                }
                                // close the dialog
                                $("#dialog").dialog("close");
                            }
                        }else{
                            alert('Error: ' + (response?.message || 'Failed to save user data.'));
                        }
                })
                .catch(function (err) {
                    // Hide loader
                    if (loader) loader.style.display = 'none';

                    if (typeof errorCallback === 'function') {
                        errorCallback(err);
                    } else {
                        console.error("Error", err);
                    }
                });
        },
        lookupUser: function (sunetId, callback, errorCallback) {

            if (sunetId || sunetId.trim() !== '') {
                this.su_value = sunetId;
                // Show loader
                const loader = document.getElementById('ajax-loader');
                if (loader) loader.style.display = 'block';

                module.ajax('lookupUser', {'sunetId': sunetId})
                    .then(function (response) {
                        let content = '';
                        if (loader) loader.style.display = 'none';
                        if (response?.success) {
                            module.user = response[sunetId] || {};


                            var pointer = 0;
                            // Add header text once if there are any affiliations
                            if (response[sunetId].length > 0) {
                                content += `
                                    <div class="mb-3 fw-bold text-center">
                                        Please select one of the following affiliations:
                                    </div>
                                `;
                            }

                            for (const aff of response[sunetId]) {

                                const text = aff['affiliation'] || '';
                                const value = pointer;
                                const type = aff['type'] || 'N/A';
                                const department = aff['department'] || 'N/A';
                                const name = aff['name'] || 'N/A';

                                content += `
                                        <div class="row mb-2 align-items-center">
                                            <div class="col-1 d-flex justify-content-center">
                                                <input type="radio" name="affiliation" value="${value}" />
                                            </div>
                                            <div class="col-10">
                                                <div><strong>Name:</strong> ${name}</div>
                                                <div><strong>Affiliation:</strong> ${text}</div>
                                                <div><strong>Type:</strong> ${type}</div>
                                                <div><strong>Department:</strong> ${department}</div>
                                            </div>
                                        </div>
                                        <hr>
                                    `;
                                pointer += 1;
                            }


                            // Hide loader


                        } else {

                            content = `<div class="alert alert-danger">Error: ${response['message'] || 'No data found for this Sunet ID.'}</div>`;
                        }
                        $("#dialog-body").html(content);
                        // Update only dynamic options and open. Do NOT re-call
                        // `.dialog({...})` with a fresh option hash here — on iOS
                        // re-initializing right before `open` was contributing to
                        // the "flash then disappear" behavior.
                        $("#dialog")
                            .dialog("option", "title", 'MaIS Lookup for ' + sunetId)
                            .dialog("open")
                            .dialog("moveToTop");
                    })
                    .catch(function (err) {
                        // Hide loader
                        if (loader) loader.style.display = 'none';

                        if (typeof errorCallback === 'function') {
                            errorCallback(err);
                        } else {
                            console.error("Error", err);
                        }
                    });
            }
        },
        getValueFromPath: function (obj, path) {
            if (!path) return undefined;
            const keys = path.match(/\[([^\]]+)\]/g);
            if (!keys) return undefined;

            return keys
                .map(k => k.replace(/[\[\]']+/g, ''))
                .reduce((acc, key) => acc && acc[key], obj);
        }
    });
}
