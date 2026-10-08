# Fix: MaIS lookup on WebAuth surveys (iPhone and any not-yet-logged-in browser)

Root cause and investigation: `2026-10-07-ios-webauth-survey-lookup-investigation.md`.

## Problem in one paragraph

On a survey served from `/webauth/surveys/?s=…`, the EM framework doesn't recognize the
page as a survey (`isSurveyPage()` requires the URL to start with `/surveys/`). JSMO ajax
is therefore set up as an authenticated, non-survey request
(`/?__passthru=ExternalModules…&pid=…`), which a survey respondent can never satisfy.
REDCap answers with an HTML page → `JSON Parse error: Unrecognized token '<'`.
Desktop staff rarely see it, because they already have a Stanford login cookie, so the
WebAuth EM never redirects them off `/surveys/`. A phone user doesn't, so they are redirected.
The same defect breaks **every** JSMO module on WebAuth surveys: REDCap_Notifications'
`get_full_payload` fails the same way.

## What changed (MaIS only)

| File | Change |
|------|--------|
| `MaISlookup.php` | `redcap_survey_page`: if the request is under `/webauth/surveys/` **and** `REMOTE_USER` is set, build a WebAuth context: the endpoint (host-relative, because prod has `ServerAlias` hostnames) plus a signed token (HMAC-SHA256 keyed from REDCap `$salt`; claims pid, survey hash, record, instrument, event, instance, user, exp = 12 h). If this fails it is logged and falls back to JSMO. New `handleWebauthAjax()` checks POST, `REMOTE_USER`, signature, expiry, project and user, then dispatches `lookupUser` / `saveUser`. |
| `MaISlookup.php` | `saveUser($payload, string $record)` writes to a **verified** record: the framework's `$record` on the JSMO path, or the token's record on the WebAuth path. It no longer uses `payload['record_id']`; this closes the "write private fields into any record" hole. Uses `$this->getRecordIdField()` so it works in both contexts. |
| `pages/webauth_ajax.php` (new) | No-auth, no-CSRF module page that calls `handleWebauthAjax()`. It is reached at `/webauth/api/?type=module&prefix=mais_lookup&page=pages%2Fwebauth_ajax&pid=<pid>&NOAUTH`, so **Apache enforces OIDC on every call**. |
| `classes/WebauthSessionException.php` (new) | Signals expired/mismatched login → HTTP 401 `{sessionExpired:true}`. |
| `config.json` | `no-auth-pages` and `no-csrf-pages`: `pages/webauth_ajax`. |
| `pages/mais_lookup.php` | Injects `jsmoObject.webauth` (`null` everywhere except WebAuth surveys); drops `record_id`. |
| `assets/jsmo.js` | `maisRequest()` transport: if `module.webauth` is set, POST JSON to that endpoint (`redirect: 'manual'`, `X-Requested-With`); otherwise `module.ajax()` as before. A redirect or 401 shows "Your Stanford login has expired" with a **Reload page** button. |

**Other projects:** data-entry forms and non-WebAuth surveys still use `module.ajax()`
unchanged. The only behaviour change there is that `saveUser` saves into the
framework-verified record instead of the id the browser sent. These are the same value for
honest clients.

The June workarounds (endpoint rewrite, CSRF bootstrap, network spies) are left in place.
They are inert on the WebAuth path now. Remove them in a separate change once prod is confirmed.

## Local test setup (repro of prod WebAuth)

- `www/webauth -> .` symlink (same as prod `webroot/webauth`).
- `rdc/redcap-overrides/web/apache2/conf-enabled/webauth-sim.conf`: Basic auth on
  `<Location "/webauth/">`, so `REMOTE_USER` is set only there (stand-in for OIDC).
  Users are in `/etc/apache2/webauth-sim.htpasswd` in the web container, and in
  `rdc/redcap-overrides/web/apache2/webauth-sim/htpasswd`. **The container copy is lost on
  rebuild: `docker cp` it again.**
- Local PID 202 ("DEMO: Incident Reporting"), a copy of prod 32218: `stanford_webauth`
  enabled, `webauth-surveys = ["su17_employee_form"]`, test record `9001`.
  Survey link: `http://redcap.local/surveys/?s=UmpKn2Gsp6fUs3BT`.
- Local `redcap_base_url = http://redcap.local/`, which matches prod's setup
  (`APP_PATH_SURVEY = /surveys/`).

## Test results (2026-10-07, Playwright WebKit, iPhone 15 emulation)

| # | Scenario | Result |
|---|----------|--------|
| 1 | **Before fix**: `/surveys/?s=` → WebAuth redirect → `/webauth/surveys/` → type SUNet → tap out | ❌ Reproduced: endpoint `…/?__passthru…&pid=202`, POST `/webauth/?__passthru…` → HTML login page |
| 2 | After fix, same flow + pick affiliation | ✅ Lookup and save via `/webauth/api/…webauth_ajax` → JSON; picker shown; name/email/department filled; private `osha_dob`/`osha_gender` saved into record 9001 |
| 3 | Valid token, no login | ✅ Apache 401 |
| 4 | Valid token, open `/api/` path (bypassing `/webauth/`) | ✅ 401 `Not logged in.` |
| 5 | Tampered token | ✅ `Invalid lookup token.` |
| 6 | Other logged-in user replays a token | ✅ 401 `does not match the logged-in user` |
| 7 | Token used against another project (pid=196) | ✅ `does not match this project` |
| 8 | GET / unknown action | ✅ 405 / `Action … is not defined` |
| 9 | `saveUser` with forged `record_id=9999` | ✅ Ignored; record 9999 not created |
| 10 | Expired login: 401 and real redirect | ✅ "Your Stanford login has expired" + Reload button (mobile layout checked) |
| 11 | Regression: same form **without** WebAuth (`/surveys/`, JSMO path) | ✅ Unchanged: lookup and save via `/surveys/?__passthru…&s=…` |
| 12 | Regression: data-entry form lookup (authenticated, Chromium), existing record 9001 and new auto-numbered record 971 | ✅ JSMO `/?__passthru…&pid=202` unchanged; public fields filled; private fields saved to the record id in the URL |
| 13 | Same WebAuth flow on a second hostname (`localhost` vs `redcap.local`) | ✅ Endpoint is host-relative; the request stays same-origin |

Phone and job title are empty in both #2 and #11: no value in MaIS for the test person,
not a regression.

Not covered locally: real OIDC (`mod_auth_openidc` 401 vs redirect for background
requests), ITP, iOS in-app browsers. These need checking on prod (see rollout steps).

## Rollout to prod PID 32218

See the user-facing steps in the main report. In short:

1. Commit/merge to `susom/maislookup` `main`.
2. Update the `mais_lookup_v9.9.9` commit pin in
   `redcap-build-all-branches/som-prod/config.csv`, build, and deploy the som-prod image.
3. No Apache, project or WebAuth EM change is needed. `/webauth/api/` already inherits
   OIDC from `<Location "/">`.
4. Verify:
   - Private window: `https://redcap.stanford.edu/webauth/api/?type=module&prefix=mais_lookup&page=pages%2Fwebauth_ajax&NOAUTH&pid=32218`
     → Stanford login; after login → `{"success":false,"message":"Method not allowed."}`.
   - iPhone: the full flow on 32218, then confirm the hidden OSHA fields are populated.
5. Rollback: restore the previous commit pin and redeploy.
