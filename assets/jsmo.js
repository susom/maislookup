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
            $("#dialog").dialog({
                autoOpen: false,
                show: {
                    effect: "blind",
                    duration: 500
                },
            });

            // listen for a radio button click
            document.body.addEventListener('input', function (e) {
                if (e.target.name === 'affiliation') {
                    console.log('Input changed:', e.target.value);
                    module.saveUser(e.target.value);
                }
            });
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
                        $("#dialog").dialog({
                            title: 'MaIS Lookup for ' + sunetId,
                            width: 600,
                            modal: true
                        }).dialog("open");
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
