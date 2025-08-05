// This file extends the default JSMO object with methods for this EM
;
{
    // Define the jsmo in IIFE so we can reference object in our new function methods
    const module = ExternalModules.Stanford.MaISlookup;

    Object.assign(module, {
        user: {},
        sunetId: '',
        mappedAttributes: {},
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
                    module.mapUserAttributes(e.target.value);
                }
            });
        },
        lookupUser: function (sunetId, callback, errorCallback) {

            if (sunetId || sunetId.trim() !== '') {


                // Show loader
                const loader = document.getElementById('ajax-loader');
                if (loader) loader.style.display = 'block';
                // reset form if populated
                module.mapUserAttributes(0, true);

                module.ajax('lookupUser', {'sunetId': sunetId})
                    .then(function (response) {
                        let content = '';
                        if (loader) loader.style.display = 'none';
                        if (response?.success) {
                            module.user = response[sunetId] || {};


                            const affiliations = response[sunetId]?.affiliation?.affiliation || [];

                            var pointer = 0;
                            for (const aff of affiliations) {

                                const text = aff['#text'] || '';
                                const value = pointer;
                                const type = aff['@attributes']?.type || 'N/A';
                                const effective = aff['@attributes']?.effective || 'N/A';
                                const department = aff['department']?.['#text'] || 'N/A';
                                const telephone = response[sunetId]?.telephone['telephone'][pointer] || 'N/A';
                                const name = response[sunetId]?.name['name'][pointer] || 'N/A';
                                const email = response[sunetId]?.email['email']['#text'] || 'N/A';
                                const birthday = response[sunetId]?.biodemo['biodemo']['birthdate'] || 'N/A';

                                content += `
                                        <div class="row mb-2 align-items-center">
                                            <div class="col-1 d-flex justify-content-center">
                                                <input type="radio" name="affiliation" value="${value}" />
                                            </div>
                                            <div class="col-10">
                                                <div><strong>Name:</strong> ${name['#text']}</div>
                                                <div><strong>Telephone:</strong> ${telephone['#text']}</div>
                                                <div><strong>Email:</strong> ${email}</div>
                                                <div><strong>Birthday:</strong> ${birthday}</div>
                                                <div><strong>Affiliation:</strong> ${text}</div>
                                                <div><strong>Type:</strong> ${type}</div>
                                                <div><strong>Effective Date:</strong> ${effective}</div>
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
        mapUserAttributes: function (index, reset = false) {

            for (const key in module.mappedAttributes) {
                let maisAttribute = module.mappedAttributes[key];

                // Replace '#' with index
                if (maisAttribute.includes('[#]')) {
                    maisAttribute = maisAttribute.replace('[#]', '[' + index + ']');
                }
                var value = '';
                // If reset is true, we want to clear the value
                if(!reset){
                    value = module.getValueFromPath(module.user, maisAttribute);
                }

                // console.log(maisAttribute + "=>", value);
                // if input exists in the DOM, set its value
                var e = document.querySelector('[name="' + key + '"]');
                if (e !== undefined) {
                    e.value = value || '';
                }
            }
            // close the dialog
            $("#dialog").dialog("close");
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
