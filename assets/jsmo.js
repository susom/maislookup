// This file extends the default JSMO object with methods for this EM
;
{
    // Define the jsmo in IIFE so we can reference object in our new function methods
    const module = ExternalModules.Stanford.MaISlookup;

    // ---- Network interceptors: capture the most recent AJAX request/response so we can
    // surface real diagnostics on iPhone (no console available). We hook BOTH XHR and
    // fetch, and we no longer filter by URL — the most recent network call right before
    // the JSON parse failure IS the failed JSMO request.
    const maisLastXhr = { source: '', url: '', method: '', status: 0, statusText: '', contentType: '', body: '', finalURL: '' };
    // Holds the latest ajaxSettings captured by our wrapper around moduleQueuedAjax.
    // Has { endpoint, verification, csrfToken, prefix, version, ... } — needed to re-issue
    // the same request ourselves for a guaranteed-clean diagnostic capture.
    const maisAjaxSnapshot = { settings: null, action: null, payload: null };
    // Sentinel so we can prove (in the on-screen diagnostic) that the LATEST jsmo.js
    // actually ran on the device — if this stays falsy, the iPhone is using a cached copy.
    window.__maisSpyBuild = '2026-06-11-net-spy-v5-path-prefix-fix';

    // --- Pristine XMLHttpRequest from a same-origin iframe, so third-party wrappers
    // (e.g. Stanford WebAuth/analytics scripts that may rewrap XHR/fetch after us)
    // cannot intercept our diagnostic request.
    function maisGetPristineXHR() {
        try {
            const f = document.createElement('iframe');
            f.setAttribute('aria-hidden', 'true');
            f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
            (document.body || document.documentElement).appendChild(f);
            const Ctor = f.contentWindow && f.contentWindow.XMLHttpRequest;
            // Detach iframe after we grab the constructor; the constructor itself stays valid.
            setTimeout(function () { try { f.remove(); } catch (_) {} }, 0);
            return Ctor || XMLHttpRequest;
        } catch (_) {
            return XMLHttpRequest;
        }
    }

    // --- Stanford WebAuth path-prefix fix ---
    // Stanford prod serves REDCap behind a WebAuth proxy under e.g. "/webauth/...".
    // The session cookie is path-scoped to "/webauth/", but the EM framework builds
    // its JSMO ajax endpoint from APP_PATH_WEBROOT_FULL which is just the host root.
    // Result: the POST to "/" goes WITHOUT the auth cookie, REDCap returns the home
    // page HTML, and JSON.parse trips on "<". This rewrites the endpoint to inherit
    // the same first-segment prefix as the current page when there is a mismatch.
    function maisRewriteEndpointForPathPrefix(endpoint) {
        try {
            if (!endpoint) return endpoint;
            const ep = new URL(endpoint, location.href);
            // Only rewrite same-origin endpoints
            if (ep.origin !== location.origin) return endpoint;
            const pagePrefixMatch = location.pathname.match(/^(\/[^\/]+\/)/);
            if (!pagePrefixMatch) return endpoint;
            const prefix = pagePrefixMatch[1]; // e.g. "/webauth/"
            if (prefix === '/') return endpoint;
            // If the endpoint already starts with the prefix, nothing to do.
            if (ep.pathname.indexOf(prefix) === 0) return endpoint;
            // Prepend the prefix (strip its trailing slash so we don't double up).
            ep.pathname = prefix.replace(/\/$/, '') + ep.pathname;
            console.log('[MaIS] Rewrote JSMO endpoint for path prefix "' + prefix + '":', ep.toString());
            return ep.toString();
        } catch (e) {
            console.warn('[MaIS] endpoint rewrite failed:', e);
            return endpoint;
        }
    }

    // --- Wrap ExternalModules.moduleQueuedAjax so we always know the latest endpoint,
    // verification token and csrf token, regardless of who else has wrapped fetch/XHR.
    (function wrapModuleQueuedAjax() {
        try {
            if (!window.ExternalModules) return;
            // The framework defines moduleQueuedAjax inside an IIFE on the survey page,
            // BEFORE our jsmo.js runs, so it should already be present. If not, retry.
            const tryWrap = function (attempts) {
                if (!ExternalModules.moduleQueuedAjax) {
                    if (attempts > 0) return setTimeout(function () { tryWrap(attempts - 1); }, 50);
                    return;
                }
                if (ExternalModules.__maisQueuedAjaxWrapped) return;
                ExternalModules.__maisQueuedAjaxWrapped = true;
                const orig = ExternalModules.moduleQueuedAjax;
                ExternalModules.moduleQueuedAjax = function (ajaxSettings, action, payload) {
                    try {
                        // Apply the WebAuth path-prefix fix BEFORE the framework uses
                        // the endpoint. Mutating the object is safe: it's already a
                        // request-scoped copy created by the framework's IIFE.
                        if (ajaxSettings && ajaxSettings.endpoint) {
                            ajaxSettings.endpoint = maisRewriteEndpointForPathPrefix(ajaxSettings.endpoint);
                        }
                        // Snapshot a shallow copy so later mutations don't affect our diagnostic.
                        maisAjaxSnapshot.settings = Object.assign({}, ajaxSettings);
                        maisAjaxSnapshot.action = action;
                        maisAjaxSnapshot.payload = payload;
                    } catch (_) {}
                    return orig.apply(this, arguments);
                };
                console.log('[MaIS] moduleQueuedAjax wrapped.');
            };
            tryWrap(20); // up to ~1s of retries
        } catch (e) {
            console.warn('[MaIS] moduleQueuedAjax wrap failed:', e);
        }
    })();

    // --- Re-issue the failed request via a pristine XHR (bypassing any third-party
    // fetch/XHR wrappers) and resolve with the diagnostic snapshot.
    function maisDiagnosticReplay() {
        return new Promise(function (resolve) {
            const snap = maisAjaxSnapshot;
            if (!snap.settings || !snap.settings.endpoint) {
                return resolve({ ok: false, reason: 'no ajaxSettings captured — moduleQueuedAjax wrapper never ran' });
            }
            try {
                const XHRCtor = maisGetPristineXHR();
                const xhr = new XHRCtor();
                xhr.open('POST', snap.settings.endpoint, true);
                xhr.withCredentials = true;
                xhr.onloadend = function () {
                    let ct = '';
                    try { ct = xhr.getResponseHeader('content-type') || ''; } catch (_) {}
                    resolve({
                        ok: true,
                        endpoint: snap.settings.endpoint,
                        finalURL: xhr.responseURL || '',
                        status: xhr.status,
                        statusText: xhr.statusText || '',
                        contentType: ct,
                        body: (xhr.responseText || '').slice(0, 1500)
                    });
                };
                xhr.onerror = function () {
                    resolve({ ok: false, reason: 'XHR network error', endpoint: snap.settings.endpoint });
                };
                const fd = new FormData();
                if (snap.settings.verification) fd.append('verification', snap.settings.verification);
                fd.append('action', String(snap.action || ''));
                fd.append('payload', JSON.stringify(snap.payload == null ? null : snap.payload));
                if (snap.settings.csrfToken) {
                    fd.append('redcap_external_module_csrf_token', snap.settings.csrfToken);
                    fd.append('redcap_csrf_token', snap.settings.csrfToken);
                }
                xhr.send(fd);
            } catch (e) {
                resolve({ ok: false, reason: 'replay threw: ' + String(e) });
            }
        });
    }

    // (Legacy XHR/fetch spies kept as a secondary signal — may catch the framework's
    // request directly if no third-party wrapper got in the way.)
    (function installNetSpy() {
        if (window.__maisNetSpyInstalled) return;
        window.__maisNetSpyInstalled = true;

        // --- XMLHttpRequest hook ---
        try {
            const OrigOpen = XMLHttpRequest.prototype.open;
            const OrigSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (method, url) {
                this.__maisMethod = method;
                this.__maisUrl = url;
                return OrigOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function () {
                const xhr = this;
                xhr.addEventListener('loadend', function () {
                    try {
                        maisLastXhr.source = 'XHR';
                        maisLastXhr.url = String(xhr.__maisUrl || '');
                        maisLastXhr.method = xhr.__maisMethod || '';
                        maisLastXhr.status = xhr.status;
                        maisLastXhr.statusText = xhr.statusText || '';
                        try { maisLastXhr.contentType = xhr.getResponseHeader('content-type') || ''; } catch (_) {}
                        try { maisLastXhr.finalURL = xhr.responseURL || ''; } catch (_) {}
                        const txt = (typeof xhr.responseText === 'string') ? xhr.responseText : '';
                        maisLastXhr.body = txt.slice(0, 1500);
                    } catch (_) { /* ignore */ }
                });
                return OrigSend.apply(this, arguments);
            };
        } catch (e) {
            console.warn('[MaIS] XHR spy install failed:', e);
        }

        // --- fetch() hook ---
        try {
            if (typeof window.fetch === 'function') {
                const OrigFetch = window.fetch.bind(window);
                window.fetch = function (input, init) {
                    const reqUrl = (typeof input === 'string') ? input : (input && input.url) || '';
                    const reqMethod = (init && init.method) || (input && input.method) || 'GET';
                    return OrigFetch(input, init).then(function (resp) {
                        try {
                            const clone = resp.clone();
                            clone.text().then(function (txt) {
                                try {
                                    maisLastXhr.source = 'fetch';
                                    maisLastXhr.url = reqUrl;
                                    maisLastXhr.method = reqMethod;
                                    maisLastXhr.status = resp.status;
                                    maisLastXhr.statusText = resp.statusText || '';
                                    maisLastXhr.contentType = resp.headers.get('content-type') || '';
                                    maisLastXhr.finalURL = resp.url || '';
                                    maisLastXhr.body = (txt || '').slice(0, 1500);
                                } catch (_) {}
                            }).catch(function () {});
                        } catch (_) {}
                        return resp;
                    });
                };
            }
        } catch (e) {
            console.warn('[MaIS] fetch spy install failed:', e);
        }
    })();

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
                                '<details open>' +
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

                    // Show the captured XHR snapshot from our global spy. This is the
                    // ACTUAL request the framework's module.ajax() just made, not a probe.
                    let diag =
                        'spyBuild: ' + (window.__maisSpyBuild || '(missing — STALE jsmo.js cached)') + '\n' +
                        'jsmoVer:  ' + (window.__maisJsmoVer  || '(missing)') + '\n' +
                        'serverDiag (getAjaxSettings probe): ' + (function(){
                            try { return JSON.stringify(window.__maisJsmoServerDiag); }
                            catch (_) { return '(missing/unstringifiable)'; }
                        })() + '\n' +
                        'ajaxSnapshot.settings: ' + (function(){
                            try { return JSON.stringify(maisAjaxSnapshot.settings); }
                            catch (_) { return '(unstringifiable)'; }
                        })() + '\n' +
                        'ajaxSnapshot.action: ' + maisAjaxSnapshot.action + '\n';
                    if (maisLastXhr.url) {
                        diag +=
                            '--- spy capture ---\n' +
                            'source: ' + maisLastXhr.source + '\n' +
                            'method: ' + maisLastXhr.method + '\n' +
                            'url: ' + maisLastXhr.url + '\n' +
                            'finalURL: ' + maisLastXhr.finalURL + '\n' +
                            'status: ' + maisLastXhr.status + ' ' + maisLastXhr.statusText + '\n' +
                            'content-type: ' + maisLastXhr.contentType + '\n' +
                            'body[0..1500]:\n' + maisLastXhr.body;
                    } else {
                        diag += '(spy did not see network call — likely a 3rd-party wrapper bypassed window.fetch)';
                    }
                    renderBody(diag);

                    // Asynchronously replay the request via a pristine XHR (from an iframe
                    // so 3rd-party wrappers cannot interfere) and append the result.
                    maisDiagnosticReplay().then(function (r) {
                        let replayBlock = '\n\n--- replay (pristine XHR) ---\n';
                        if (!r.ok) {
                            replayBlock += 'failed: ' + r.reason;
                            if (r.endpoint) replayBlock += '\nendpoint: ' + r.endpoint;
                        } else {
                            replayBlock +=
                                'endpoint: ' + r.endpoint + '\n' +
                                'finalURL: ' + r.finalURL + '\n' +
                                'status: ' + r.status + ' ' + r.statusText + '\n' +
                                'content-type: ' + r.contentType + '\n' +
                                'body[0..1500]:\n' + r.body;
                        }
                        renderBody(diag + replayBlock);
                    });

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
