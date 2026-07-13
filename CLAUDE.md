# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Instructions

- **Never use subagents** (the Agent tool / Task tool). Do all work directly in the main conversation.
- Use these two documents in the parent directory as your primary reference for REDCap and the External Module framework:
  - `../EXTERNAL_MODULES_INDEX.md` — catalog of all Stanford EMs plus a framework reference (config.json keys, framework methods, hooks, JSMO).
  - `../REDCAP_TECHNICAL_REFERENCE.md` — deep technical reference for REDCap internals (v17.1.2) and EM framework versions 1–17, with source file paths.

## What This Module Is

`MaIS-lookup` (namespace `Stanford\MaISlookup`) is a Stanford REDCap External Module. When a user enters a SUNet ID into a configured field on a data entry form or survey, it queries Stanford's MaIS registry API (`registry.stanford.edu` / `registry-uat.stanford.edu`) over mutual TLS, shows an affiliation-picker modal, and maps the selected person's attributes into REDCap fields.

This is a live dev copy inside the Stanford REDCap docker-compose stack: the REDCap docroot is `../../` (`www/`), and `modules-local/` holds locally developed modules. The `_v9.9.9` directory suffix is the local-dev version convention. There are no tests and no linter; verification is manual through the running REDCap instance.

## Commands

```bash
composer install   # installs google/cloud-secret-manager; vendor/ is gitignored but required at runtime
```

There is no build step. PHP and JS are served directly. Requires PHP 8.0+ (uses `match`). The module is enabled/configured per-project via REDCap's External Module manager UI.

## Architecture

**Request flow (the big picture):**

1. `MaISlookup.php` hooks `redcap_data_entry_form_top` and `redcap_survey_page`. If the project setting `sunetid-field` is set, it includes `pages/mais_lookup.php`, which injects the JSMO (`injectJSMO()`), a CSS loader/modal, and boots the JS module with the sunet field name, mapped attributes, and record id.
2. `assets/jsmo.js` extends `ExternalModules.Stanford.MaISlookup`. On blur/change of the SUNet field it calls `module.ajax('lookupUser', ...)`; the user picks an affiliation from a vanilla (deliberately non-Bootstrap) modal, which triggers `module.ajax('saveUser', ...)`.
3. Both AJAX actions route through `redcap_module_ajax()` in `MaISlookup.php` (declared in `config.json` under both `auth-ajax-actions` and `no-auth-ajax-actions` so they work on public surveys).
4. `saveUser()` fetches five data sections concurrently (`affiliation`, `biodemo`, `telephone`, `email`, `name`) via Guzzle promises (`Utils::settle`), merges them with `array_replace_recursive`, resolves each configured attribute path, then saves "private" fields server-side via `REDCap::saveData` and returns "public" fields for the JS to populate into the form.

**Backend service chain (lazily constructed, torn down after every call):**

`GoogleSecretManager` (reads secrets from GCP Secret Manager, using the system-setting JSON key or default credentials) → `CertificateManager` (writes `{ENV}_EHS_CERT` / `{ENV}_EHS_PRIVATE_KEY` secrets to temp `.pem` files; a passphrase secret value of the string `'null'` means no passphrase) → `MAISClient` (Guzzle client with client-cert TLS). `get()`/`saveUser()` always `cleanup()` the temp cert files and null out the clients in `finally` blocks — preserve this lifecycle when adding API calls.

**Attribute mapping:** The repeatable `attribute_instance` sub-setting maps a MaIS "path" (e.g. `[name][#][first]`) to a REDCap field. Paths are bracket syntax against the merged XML-as-array structure; `[#]` is a placeholder replaced by the affiliation index the user selected. `Utilities::simplexmlToArray` produces this structure using `@attributes` and `#text` keys, and single-element sections are normalized to arrays so indexing stays consistent. `pages/mapping_helper.php` (a project-links page) prints every path→value pair for the current user so admins can discover paths for config.

**Visibility:** Each mapping is `private` (saved server-side only, never sent to the browser) or `public` (returned to JS and written into visible form inputs). Don't leak private attributes to the client.

## Gotchas (hard-won — see git history)

- **iOS Safari is the fragile platform.** Most recent commits are iOS lookup fixes. The code contains deliberate workarounds — do not "clean them up":
  - `jsmo.js`: SUNet IDs are lowercased/trimmed because iOS auto-capitalizes and the MaIS API is case-sensitive; the modal is vanilla CSS (no transforms/animations); lookup triggers on both `blur` and `change` with a debounce; network spies + a "pristine XHR from iframe" replay exist to surface diagnostics on devices with no console; `maisRewriteEndpointForPathPrefix()` fixes the JSMO endpoint when REDCap sits behind Stanford's WebAuth path prefix (`/webauth/...`).
  - `MaISlookup.php` `injectJSMO()`: bootstraps a REDCap CSRF token into `$_SESSION` (missing on some public-survey requests, which otherwise breaks the framework's ajax settings), probes `getAjaxSettings()` for diagnostics, and cache-busts `jsmo.js` with the file mtime because iOS caches it aggressively.
- `getProjectSetting('sunetid-field') !== ''` gates hook injection — an unconfigured project gets no JS.
- MaIS API responses are XML; single vs. multiple elements produce different structures, hence the wrap-to-array normalization in `getUserData`/`getUserDataAsync`. Keep it when touching parsing.
- Secrets are named by environment prefix (`UAT_`/`PROD_` + `EHS_CERT`, `EHS_PRIVATE_KEY`, `EHS_PASSPHRASE`) in the Google project given by the `google-project-id` project setting.
- `config.json` uses framework-version 16. Consult `../REDCAP_TECHNICAL_REFERENCE.md` before changing framework-facing code.
