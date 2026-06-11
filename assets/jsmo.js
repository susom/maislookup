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
            // iOS Safari auto-capitalizes the first letter of text inputs. The MAIS API
            // is case-sensitive (capitalized SUNet IDs return 404). Lowercase + trim here
            // so we send, store, and read responses using a single canonical key.
            sunetId = sunetId.trim().toLowerCase();
            this.su_value = sunetId;
            console.log('[MaIS] lookupUser ->', this.su_value);
            maisShowLoader(true);

            module.ajax('lookupUser', { 'sunetId': this.su_value })
                .then(function (response) {
                    maisShowLoader(false);
                    console.log('[MaIS] lookupUser response:', response);

                    let content = '';
                    if (response && response.success) {
                        // Be tolerant: prefer the canonical lowercase key, but fall back to
                        // any non-`success` key so we still find the list if PHP keyed it differently.
                        let list = response[sunetId];
                        if (!list) {
                            for (const k in response) {
                                if (k !== 'success' && Array.isArray(response[k])) {
                                    list = response[k];
                                    break;
                                }
                            }
                        }
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

                    // Detect the very common "HTML returned instead of JSON" case
                    // (server redirected to a login/WebAuth page -> response starts with '<').
                    const isHtmlInsteadOfJson =
                        err && (
                            (err.name === 'SyntaxError' &&
                                /Unrecognized token '<'|Unexpected token '?<'?|<!DOCTYPE|<html/i.test(String(err.message || ''))) ||
                            /<!DOCTYPE|<html/i.test(String(err.message || ''))
                        );

                    // Build a verbose, iPhone-visible error report (no console available on device)
                    let errDetails = '';
                    try {
                        if (err == null) {
                            errDetails = '(no error object)';
                        } else if (typeof err === 'string') {
                            errDetails = err;
                        } else if (err instanceof Error) {
                            errDetails =
                                'name: ' + (err.name || '') + '\n' +
                                'message: ' + (err.message || '') + '\n' +
                                'stack: ' + (err.stack || '');
                        } else {
                            // Capture non-enumerable props too
                            const seen = new WeakSet();
                            errDetails = JSON.stringify(err, function (k, v) {
                                if (typeof v === 'object' && v !== null) {
                                    if (seen.has(v)) return '[Circular]';
                                    seen.add(v);
                                }
                                return v;
                            }, 2);
                            if (!errDetails || errDetails === '{}') {
                                // Fallback: pull common props
                                errDetails =
                                    'status: ' + (err.status || '') + '\n' +
                                    'statusText: ' + (err.statusText || '') + '\n' +
                                    'responseText: ' + (err.responseText || '') + '\n' +
                                    'message: ' + (err.message || '') + '\n' +
                                    'toString: ' + String(err);
                            }
                        }
                    } catch (ex) {
                        errDetails = 'Could not serialize error: ' + String(ex) + ' / raw: ' + String(err);
                    }

                    const escapeHtml = function (s) {
                        return String(s)
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;');
                    };

                    const headerMsg = isHtmlInsteadOfJson
                        ? 'Your session has expired or the server returned a login page instead of data. ' +
                          'Please refresh this survey page and try again. ' +
                          'If this keeps happening on iPhone, try disabling "Prevent Cross-Site Tracking" in Settings → Safari, or use a different browser.'
                        : 'Lookup failed. Please try again.';

                    // Render an initial body immediately so the user sees something.
                    const renderBody = function (extraDiagnostic) {
                        const body =
                            '<div class="alert alert-danger">' +
                                '<div class="fw-bold mb-2">' + escapeHtml(headerMsg) + '</div>' +
                                '<div class="mb-2" style="font-size:11px;color:#555;">UA: ' + escapeHtml(navigator.userAgent) + '</div>' +
                                '<details' + (isHtmlInsteadOfJson ? '' : ' open') + '>' +
                                    '<summary>Technical details</summary>' +
                                    '<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;margin-top:8px;">' +
                                        escapeHtml(errDetails) +
                                        (extraDiagnostic ? '\n\n--- Diagnostic probe ---\n' + escapeHtml(extraDiagnostic) : '') +
                                    '</pre>' +
                                '</details>' +
                            '</div>';
                        maisSetBody(body);
                        maisOpenModal('MaIS Lookup');
                    };

                    renderBody('');

                    // Diagnostic probe: re-hit the JSMO endpoint with raw fetch so we can capture
                    // status code + first chunk of the HTML response and show it in the modal.
                    try {
                        const probeUrl = (module && module.url) ? module.url : null;
                        if (probeUrl && typeof fetch === 'function') {
                            const formData = new FormData();
                            formData.append('action', 'lookupUser');
                            formData.append('payload', JSON.stringify({ sunetId: sunetId }));
                            fetch(probeUrl, {
                                method: 'POST',
                                credentials: 'include',
                                body: formData
                            })
                            .then(function (resp) {
                                const status = resp.status + ' ' + resp.statusText;
                                const ct = resp.headers.get('content-type') || '';
                                const finalUrl = resp.url || probeUrl;
                                return resp.text().then(function (txt) {
                                    const snippet = (txt || '').slice(0, 600);
                                    const diag =
                                        'probeUrl: ' + probeUrl + '\n' +
                                        'finalUrl: ' + finalUrl + '\n' +
                                        'status: ' + status + '\n' +
                                        'content-type: ' + ct + '\n' +
                                        'body[0..600]:\n' + snippet;
                                    renderBody(diag);
                                });
                            })
                            .catch(function (probeErr) {
                                renderBody('probe fetch failed: ' + String(probeErr));
                            });
                        }
                    } catch (probeEx) {
                        // ignore — we already rendered the basic message
                    }

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
