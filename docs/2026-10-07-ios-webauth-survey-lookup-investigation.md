# iOS + WebAuth survey lookup — investigation (2026-10-07)

Status: root cause identified from a device capture (iPhone simulator, iOS 18.7 / Safari
26.5) and the framework source, and reproduced locally. **Option C is implemented**; see
`2026-10-07-webauth-survey-lookup-fix.md`.

## Context

- In June 2026 WebAuth (SUNet login) was turned off for the survey on prod PID 32218
  because the MaIS lookup failed on iPhone. It has been turned back on — the survey
  must not be public. Goal: make the lookup work on iPhone with WebAuth on.
- On PID 32218 the SUNet field is filled from the logged-in user by a custom action
  tag, i.e. respondents look up **themselves**.
- Prod build manifest (`redcap-build-all-branches/som-prod/config.csv`) pins
  `mais_lookup_v9.9.9` at `f30f925` (2026-06-11), but the device capture reports
  `spyBuild: 2026-07-09-net-spy-v6-versiondir-prefix-fix`, i.e. prod is actually running
  ≥ `ba37b3c`. The local manifest copy is stale.

## How "WebAuth on a survey" works on prod

Sources: `redcap-build-all-branches/som-prod/redcap.conf`,
`modules-local/stanford_webauth_v9.9.9/Webauth.php`.

1. Apache (`mod_auth_openidc`, Keycloak idp-proxy):
   - `<Location "/">` → OIDC **required**.
   - `<Location "/surveys/">` → OIDC **pass** (open; `REMOTE_USER` set only if an OIDC
     session cookie already exists).
   - `<Location "/webauth/">` → its auth lines are commented out (since 2023-10), so it
     inherits `/` = OIDC required.
   - `webroot/webauth` is a symlink to `.` → `/webauth/surveys/?s=…` is the same survey
     script, reached via a different URL.
2. Stanford WebAuth EM (`redcap_survey_page_top`): if the instrument is WebAuth-enabled and
   **`REMOTE_USER` is empty**, it 302s `/surveys/?s=…` → `/webauth/surveys/?s=…`.
   If `REMOTE_USER` is already set (because the browser already has an OIDC session),
   **no redirect happens and the survey stays on `/surveys/`.**

## Root cause

The EM framework decides "is this a survey page?" by URL prefix:

```php
// ExternalModules.php::isSurveyPage()  (same in 17.2.3 and 17.5.2)
return strpos($_SERVER['REQUEST_URI'], APP_PATH_SURVEY) === 0 && ...;
```

Prod sets `redcap_base_url` (the probe's endpoint is the host root), so
`APP_PATH_SURVEY = "/surveys/"`. A page at `/webauth/surveys/?s=…` **fails this check**.
As a result, `getAjaxSettings()` and `getCSRFToken()` treat the survey as a logged-in,
non-survey REDCap page:

| | Normal survey (`/surveys/`) | WebAuth survey (`/webauth/surveys/`) |
|---|---|---|
| JSMO endpoint | `https://…/surveys/?__passthru=ExternalModules&…&s=<hash>` (Apache pass) | `https://…/?__passthru=ExternalModules&…&pid=32218` — no `s`, no `NOAUTH` |
| CSRF token | double-submit cookie `redcap_external_module_csrf_token` | `$_SESSION` token (`System::getCsrfToken()`) |
| Handler context | NOAUTH survey, verified by survey hash | authenticated REDCap request |

Device capture (`serverDiag`) confirms the second column:
`"endpoint":"https://redcap.stanford.edu/?__passthru=ExternalModules&prefix=mais_lookup&ajax=1&pid=32218"`.

The `jsmo.js` prefix rewrite then sends it to `/webauth/?__passthru=…&pid=32218`. That is
handled as an authenticated REDCap request, so it needs a REDCap user session with access
to PID 32218, a matching session CSRF token, and an empty survey hash. A survey respondent
has none of these, so REDCap returns an HTML page → `JSON Parse error: Unrecognized token '<'`.
Even for a REDCap user, `checkAjaxRequestVerificationData()` would fail, because the blob
carries `survey_hash=<s>` but the handler sees `''`.

### Why it looked iPhone-only

It is **not** iOS-specific. It fails for anyone who gets *redirected* to `/webauth/`, i.e.
any browser without an existing OIDC session. Desktop testers are usually REDCap staff who
are already logged in, so `REMOTE_USER` is set on `/surveys/`, the WebAuth EM does not
redirect, the page stays on `/surveys/`, and everything works. A participant on a phone has
no session, gets redirected, and breaks.
**Prediction:** a desktop private/incognito window will fail the same way.

### What the June changes did

- The endpoint rewrite (`maisRewriteEndpointForPathPrefix`) and the `injectJSMO()` CSRF
  bootstrap work around symptoms of this misclassification. They cannot fix it: the
  verification blob and CSRF mode are created server-side in "non-survey" mode, and
  rewriting the URL in JS cannot change that.
- The code comment's explanation ("session cookie path-scoped to `/webauth/`") is
  incorrect: REDCap's session cookie and the EM CSRF cookie both use path `/`.

## Solution options (not implemented)

| # | Option | Scope | Notes |
|---|--------|-------|-------|
| A | **Server-side self-lookup in MaIS.** Under WebAuth the server already knows the respondent (`REMOTE_USER`). Call MaIS server-side at survey render, render the affiliation choices into the page, and save the selection with the normal survey submit (or in `redcap_save_record`). No JSMO AJAX. | MaIS only | Strongest for PID 32218 (self-lookup). It also prevents respondents from querying other people's MaIS data. Doesn't cover projects that look up arbitrary SUNets. |
| B | **WebAuth EM: get the user back to `/surveys/` after login.** The existing redirect stays. In the same hook, when the request is a **GET** under `/webauth/surveys/` and `REMOTE_USER` is set, 302 to the same URL with `/webauth` removed. The survey then runs on `/surveys/` with `REMOTE_USER` set, which is exactly the desktop path that already works. This also covers old `/webauth/` links. Needs a loop guard (if `/surveys/` can't see `REMOTE_USER`, the existing redirect bounces straight back), and must never redirect POSTs. | WebAuth EM (sitewide) | Fixes MaIS **and every other EM using JSMO on WebAuth surveys**, with no MaIS change. Viability is proven by the URL-edit test (Open items #1). Needs a sitewide regression test of WebAuth surveys (multi-page, save & return, `webauth_user` fill, session expiry). |
| C | MaIS builds its own AJAX endpoint (e.g. a no-auth `api-actions` action, or a no-auth page) with its own HMAC token issued at render (sunet + survey hash + record + expiry), bypassing JSMO. | MaIS only | Works for arbitrary-person lookups. More code; it re-implements what JSMO provides. |
| D | Hack: strip `/webauth` from `$_SERVER['REQUEST_URI']` around `initializeJavascriptModuleObject()` so the framework builds a survey-mode endpoint, and remove the JS rewrite. | MaIS only | Fragile and depends on framework internals. Not recommended. |

Note for A: on a public-link survey with the SUNet field on page 1, the hook's `$record`
can be empty before the first submit. So the private-field save belongs in
`redcap_save_record`, with the lookup keyed on `REMOTE_USER`, not the field value.

Note: simply removing the June JS rewrite does **not** fix anything. The framework's own
endpoint on `/webauth/surveys/` is `/?__passthru…&pid=`, which is login-required and in the
wrong mode.

**Update (user input): respondents can look up someone else, so A is not viable.**

Clarifying B's auth model: on `/surveys/`, Apache `pass` still sets `REMOTE_USER` when a valid
OIDC session exists, and the WebAuth EM enforces login on every survey page load. The gap is
the JSMO AJAX to `/surveys/?__passthru…`, which neither Apache nor the EM checks. It is gated
only by the framework verification blob, so B would also need MaIS to reject lookups when
`REMOTE_USER` is empty.

**Preferred: C, implemented as a MaIS-owned endpoint under `/webauth/…`.** Apache then
enforces OIDC on every lookup call. The request carries an HMAC token issued at render
(project, survey hash, record, expiry), verified together with `REMOTE_USER`, and saves use
the token's record, not `payload['record_id']`. On session expiry, detect the OIDC bounce and
show a re-login prompt. The WebAuth EM and Apache are unchanged.

Open policy question: any authenticated respondent can query any SUNet's name, affiliations
and department. Decide whether that needs restricting, logging or rate-limiting.

Original recommendation (superseded): **A** for PID 32218. **B** is the right systemic fix if other WebAuth
surveys use JSMO-based modules. In either case remove the June endpoint rewrite / CSRF
bootstrap workarounds once the real fix is in.

## Prod PID 32218 facts (read via the UI on 2026-10-07; metadata only)

- "Incident Reporting - 2025 revision", production, REDCap **17.5.2**, classic (not longitudinal).
- Surveys: `main` (first instrument, public link), `su17b_form`, `su17_employee_form`,
  `su17_managerpi_form`. **Only `su17_employee_form` has WebAuth enabled.** The respondent
  reaches it after `main` (AutoContinue Logic is enabled), so **the record already exists**
  when the lookup runs.
- `su17_employee_form`: `webauth_user` (@HIDDEN-SURVEY, filled by the WebAuth EM) and
  `emp_sunet_person_involved` (the MaIS `sunetid-field`, typed by the user; may be
  someone else). `emp_sunet_manag` has `@SUNET_LOOKUP`, but `stanford_person_lookup` is
  **not enabled** on this project, so that tag is inert.
- MaIS settings: `ehs-environment=PROD`. Public: first/last name, email, phone,
  department, job title. **Private: `osha_job_title`, `osha_gender`, `osha_dob`.**
- Enabled modules include `autocontinue_logic`, `ehs_people_integration`, `lbre_ontology`,
  `mais_lookup`, `stanford_webauth`, `session_checker`, `survey_ui_tweaks` (and site-wide ones).

## Proposed design for C (MaIS-only; must not affect other projects)

**Activation:** only when the survey page is served under `/webauth/` **and**
`REMOTE_USER` is set (checked server-side in `redcap_survey_page`). Data-entry forms and
non-WebAuth surveys keep today's JSMO flow, byte-for-byte unchanged.

1. **Endpoint:** a new no-auth module page (e.g. `pages/webauth_ajax`), declared in
   `no-auth-pages` and `no-csrf-pages`. MaIS uses its own token instead of the framework's
   CSRF, because the CSRF mode is wrong on `/webauth/`. Its URL is built server-side as
   `https://<host>/webauth/api/?type=module&prefix=mais_lookup&page=pages/webauth_ajax&NOAUTH&pid=<pid>`.
   `/webauth/api/` does not match `<Location "/api/">`, so **Apache enforces OIDC on every call**.
   This is the same "own no-auth URL" approach `stanford_person_lookup` uses
   (`getUrl('lookup.php', true, true)`).
2. **Token:** issued at page render: HMAC-SHA256 over {pid, survey hash, instrument,
   event, instance, **record**, REMOTE_USER, expiry}, with a server-side secret. The
   endpoint verifies the signature, expiry, `pid`, and that `REMOTE_USER` equals the token's user.
3. **Actions:** only `lookupUser` / `saveUser`, reusing the existing methods. `saveUser`
   uses the **record from the token**, not `payload['record_id']`.
4. **JS:** `jsmo.js` gets a transport switch. If PHP injected the WebAuth endpoint and
   token, it POSTs there with `fetch`; otherwise it uses `module.ajax()` as today. Same response
   shape, same modal.
5. **Expired session:** if the response isn't JSON (OIDC bounce or 401), show
   "Your Stanford login expired — tap to reload". A reload re-runs WebAuth.
6. **Cleanup later (separate change):** once proven, remove the June workarounds (endpoint
   rewrite, CSRF bootstrap, network spies).

**Test plan:**
- Reproduce first, locally: add a `/webauth` symlink and set `redcap_base_url` in the local
  docker stack, then open a survey via `/webauth/surveys/?s=…`. The same misclassification
  is expected, because it doesn't depend on OIDC. Confirm the `'<'` error with Playwright
  WebKit in iPhone emulation.
- After the fix, run the same flow plus a regression check: the normal `/surveys/` flow
  and the data-entry lookup still use JSMO.
- Then test on a dev/staging server with real OIDC in the iOS Simulator (Safari Web
  Inspector), including an expired-session case. Only after that, test on prod 32218.

## Other findings

- `saveUser()` writes to `$payload['record_id']`, which the client supplies, instead of the
  verified `$record` passed to `redcap_module_ajax`. A respondent can therefore write
  "private" fields into any record ID in the project. Fix this with whichever option is chosen.
- `redcap-deploy-gcp/scripts/redcap/templates/oidc.conf.example` contains a literal
  `OIDCCryptoPassphrase` value. Check that it isn't the value used in prod.

## How to reproduce

- iOS Simulator (Xcode) → Safari → open the survey's `/surveys/?s=…` link with no prior
  REDCap login → redirected to `/webauth/surveys/…` → lookup fails with the error above.
  Inspect via Mac Safari → Develop → Simulator.
- Desktop: the same link in a private window (expected to fail, see Open items).

## Open items

1. **URL-edit test (no code):** in the logged-in simulator, change `/webauth/surveys/?s=…`
   to `/surveys/?s=…`, reload, and trigger the lookup. Lookup works → cause confirmed and
   B is viable. Bounced back to `/webauth/` → `/surveys/` can't see the OIDC session, so B
   needs infra work and A is the path. AJAX works but no affiliations → check whether the
   action tag fills the bare SUNet or the OIDC principal (`x@stanford.edu`). The reload
   creates a new test response in prod 32218.
   Second confirmation: desktop private window (expected to fail).
2. Optional: the rest of the error modal (`spy capture` / `replay` sections: finalURL,
   status, body) to see which HTML page REDCap returned.
3. Prod metadata for PID 32218 (via the UI): the instrument with the SUNet field and the
   action tag, the WebAuth EM settings, and whether other WebAuth surveys use JSMO modules
   (this decides A vs B).
