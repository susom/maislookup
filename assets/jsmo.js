// This file extends the default JSMO object with methods for this EM
;
{
    // Define the jsmo in IIFE so we can reference object in our new function methods
    const module = ExternalModules.Stanford.MaISlookup;

    // ---- Custom vanilla modal helpers (iOS-Safari friendly) ----
    function maisGetModal() {
        return document.getElementById('mais-modal');
    }
    function maisOpenModal(title) {
        const modal = maisGetModal();
        if (!modal) {
            console.warn('[MaIS] Modal element #mais-modal not found in DOM.');
            return;
        }
        // Move to <body> in case the page wrapper has overflow/transform that traps fixed positioning
        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }
        const titleEl = document.getElementById('mais-modal-title');
        if (titleEl && typeof title === 'string') titleEl.textContent = title;
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('mais-modal-open');
        console.log('[MaIS] Modal opened.');
    }
    function maisCloseModal() {
        const modal = maisGetModal();
        if (!modal) return;
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('mais-modal-open');
        console.log('[MaIS] Modal closed.');
    }
    function maisSetBody(html) {
        const body = document.getElementById('dialog-body');
        if (body) body.innerHTML = html || '';
    }
    function maisShowLoader(show) {
        const loader = document.getElementById('ajax-loader');
        if (loader) loader.style.display = show ? 'block' : 'none';
    }

    // Wire close handlers exactly once on first init.
    let maisInitialized = false;
    function maisWireOnce() {
        if (maisInitialized) return;
        maisInitialized = true;

        // Close on backdrop / × button click — delegated on document for iOS reliability
        document.addEventListener('click', function (e) {
            const t = e.target;
            if (t && t.getAttribute && t.getAttribute('data-mais-close') === '1') {
                maisCloseModal();
            }
        });

        // Close on Escape (desktop convenience)
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') maisCloseModal();
        });

        // Affiliation radio selection — use `change` only (Safari-reliable on radios).
        const modal = maisGetModal();
        if (modal) {
            modal.addEventListener('change', function (e) {
                const target = e.target;
                if (target && target.name === 'affiliation' && target.checked) {
                    console.log('[MaIS] Affiliation selected:', target.value);
                    module.saveUser(target.value);
                }
            });
        }
    }

    Object.assign(module, {
        user: {},
        sunetId: '',
        mappedAttributes: {},
        su_value: '',
        record_id: '',
        init: function (callback, errorCallback) {
            console.log('[MaIS] init() called. sunetId field:', module.sunetId);
            maisWireOnce();

            const e = document.querySelector('[name="' + module.sunetId + '"]');
            if (!e) {
                console.warn('[MaIS] Sunet input field not found:', module.sunetId);
                if (errorCallback) errorCallback(`Element with name="${module.sunetId}" not found`);
                return;
            }

            // Use BOTH `change` and `blur` to maximize reliability on iOS.
            // Guard against duplicate triggering with a short debounce on the value.
            let lastValue = '';
            let lastFireAt = 0;
            const triggerLookup = function (val, source) {
                const v = (val || '').trim();
                if (!v) return;
                const now = Date.now();
                if (v === lastValue && (now - lastFireAt) < 800) {
                    console.log('[MaIS] Skipping duplicate lookup for:', v, 'source:', source);
                    return;
                }
                lastValue = v;
                lastFireAt = now;
                console.log('[MaIS] Triggering lookup for:', v, 'source:', source);
                try {
                    module.lookupUser(v);
                } catch (err) {
                    console.error('[MaIS] lookupUser threw:', err);
                    if (errorCallback) errorCallback(err);
                }
            };

            e.addEventListener('blur',   function () { triggerLookup(this.value, 'blur'); });
            e.addEventListener('change', function () { triggerLookup(this.value, 'change'); });
        },
        saveUser: function (index, callback, errorCallback) {
            console.log('[MaIS] saveUser index:', index, 'sunet:', this.su_value);
            maisShowLoader(true);
            module.ajax('saveUser', {
                'sunetId': this.su_value,
                'index': index,
                'record_id': this.record_id
            })
                .then(function (response) {
                    maisShowLoader(false);
                    if (response && response.success) {
                        const data = response.data || {};
                        for (const key in data) {
                            const el = document.querySelector('[name="' + key + '"]');
                            if (el) {
                                el.value = data[key] || '';
                                try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (ex) {}
                            }
                        }
                        maisCloseModal();
                    } else {
                        alert('Error: ' + ((response && response.message) || 'Failed to save user data.'));
                    }
                })
                .catch(function (err) {
                    maisShowLoader(false);
                    console.error('[MaIS] saveUser error:', err);
                    if (typeof errorCallback === 'function') errorCallback(err);
                });
        },
        lookupUser: function (sunetId, callback, errorCallback) {
            if (!sunetId || !sunetId.trim()) {
                console.log('[MaIS] lookupUser called with empty sunetId; skipping.');
                return;
            }
            this.su_value = sunetId.trim();
            console.log('[MaIS] lookupUser ->', this.su_value);
            maisShowLoader(true);

            module.ajax('lookupUser', { 'sunetId': this.su_value })
                .then(function (response) {
                    maisShowLoader(false);
                    console.log('[MaIS] lookupUser response:', response);

                    let content = '';
                    if (response && response.success) {
                        const list = response[sunetId];
                        module.user = list || {};

                        if (Array.isArray(list) && list.length > 0) {
                            content += '<div class="mb-3 fw-bold text-center">Please select one of the following affiliations:</div>';

                            let pointer = 0;
                            for (const aff of list) {
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
                        } else {
                            content = '<div class="alert alert-warning">No affiliations found for this Sunet ID.</div>';
                        }
                    } else {
                        content = `<div class="alert alert-danger">Error: ${(response && response.message) || 'No data found for this Sunet ID.'}</div>`;
                    }

                    maisSetBody(content);
                    maisOpenModal('MaIS Lookup for ' + sunetId);
                })
                .catch(function (err) {
                    maisShowLoader(false);
                    console.error('[MaIS] lookupUser error:', err);
                    maisSetBody('<div class="alert alert-danger">Lookup failed. Please try again.</div>');
                    maisOpenModal('MaIS Lookup');
                    if (typeof errorCallback === 'function') errorCallback(err);
                });
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
