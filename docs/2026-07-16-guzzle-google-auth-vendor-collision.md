# Fix: Guzzle / google-auth vendor collision crashing production (2026-07-16)

## Symptom

Production (pid 32218, `DataEntry/index.php`, form `incident_lead_followup`):

```
Uncaught Error: Call to undefined method GuzzleHttp\Utils::normalizeIdnConversionOption()
  in redcap_v17.2.3/Libraries/vendor/guzzlehttp/guzzle/src/Client.php:256
```

Triggered by `DataEntry::saveRecord` → `Alerts::saveRecordAction` → sending a notification
with an embedded image stored via REDCap's Google Cloud Storage edoc backend — a code path
with no direct relationship to MaIS-lookup's own SUNet lookup feature. The customer also
reproduced the identical error directly through the module's own `lookupUser` ajax action.
It did not reproduce on every project — only some.

## Root cause

REDCap core and this module each bundle their **own separate copies** of `guzzlehttp/guzzle`
and `google/auth` (plus `guzzlehttp/promises`, `guzzlehttp/psr7`, `firebase/php-jwt`, which
`google/auth` depends on) — at different versions:

| Package | Core 17.2.3 (`Libraries/vendor/`) | Module (this repo's old `composer.lock`) |
|---|---|---|
| `guzzlehttp/guzzle` | 7.11.0 | 7.9.3 |
| `google/auth` | v1.50.2 | v1.47.1 |
| `firebase/php-jwt` | v7.0.5 | v6.11.1 |

Both vendor trees declare **identically-named PHP classes** (`GuzzleHttp\Client`,
`GuzzleHttp\Utils`, `Google\Auth\ApplicationDefaultCredentials`, ...) at those different
versions. PHP's class autoloading is global and load-order-dependent: whichever vendor tree's
file gets referenced *first* for a given class name in a request wins, for the rest of that
request. A single request can therefore end up with `Client` resolved from core (7.11.0,
which calls `Utils::normalizeIdnConversionOption()`) while `Utils` resolves from the module
(7.9.3, which doesn't have that method) — an invalid, crashing pairing.

This was **confirmed empirically**, not just inferred from reading the files: a repro script
(`Client` forced to resolve from core's real 17.2.3 vendor, `Utils` forced to resolve from the
module's real vendor, both loaded in one PHP process) reproduces the exact same fatal,
character-for-character.

The module's `MaISlookup.php` did `require_once 'vendor/autoload.php'` unconditionally at the
top of the file, so the module's Composer autoloader registered on **every** request where the
module is enabled (REDCap's EM framework loads every enabled module's class to check for
hooks) — not only when a SUNet lookup actually happens. That's why the crash could surface via
an unrelated Alert/save path, and why it was inconsistent across projects: it depends on which
Guzzle/Google-Auth-touching code paths (core's GCS/Alerts vs. the module's own MAIS/Secret
Manager calls vs. other modules) get exercised, and in what order, within a given request —
not on anything project-specific in the module's own configuration.

**Why simply pinning the module's guzzle/google-auth versions to match core's isn't a real
fix:** it only holds until the next time REDCap core (or any other enabled module bundling its
own copy) changes its version. The underlying hazard — two independent copies of the same
classes sharing one PHP process — remains.

## Fix

Vendor-prefix the colliding packages so they can never share a class name with core's (or
another module's) copies, using [`coenjacobs/mozart`](https://github.com/coenjacobs/mozart):

- **Prefixed** (into the `MaisLookupVendor\` namespace, in `vendor_prefixed/`):
  `guzzlehttp/guzzle`, `guzzlehttp/promises`, `guzzlehttp/psr7`, `google/auth`,
  `firebase/php-jwt`. `psr/http-message`, `psr/http-client` and `psr/http-factory` got pulled
  in as an unavoidable side effect (Mozart's dependency exclusion doesn't reach packages nested
  more than one level deep — e.g. `guzzle → psr7 → psr/http-message`) — harmless, since the
  interfaces move together with their only real implementation (Guzzle's own PSR-7 classes).
- **Left shared/untouched:** `psr/log`, `psr/cache`, `ralouphie/getallheaders` (safe — pure
  interfaces or a `function_exists`-guarded polyfill), and the entire
  `google/cloud-secret-manager` / `google/gax` / `google/protobuf` / `grpc/grpc` /
  `google/common-protos` / `google/longrunning` stack.
- **`google/gax`, `google/cloud-secret-manager` and `google/longrunning` depend on the
  prefixed packages** (that's how the collision happened in the first place) but Mozart only
  rewrites references *inside* the packages it moves, not their outside dependents. Their own
  `use GuzzleHttp\...` / `use Google\Auth\...` / `use Firebase\JWT\...` / `use Psr\Http\...`
  imports are repointed at the new namespace by a small custom script,
  `bin/patch-vendor-references.php`, run right after `mozart compose`. It only rewrites
  `use` statements (confirmed by inspection that none of these packages reference
  Guzzle/google-auth/JWT via dynamic/runtime-built class name strings — only plain imports),
  so it's safe and naturally idempotent.
- `protobuf`/`grpc`/`common-protos` were deliberately **not** touched at all: they use runtime,
  string-built class resolution (descriptor pools, transport auto-detection) that static
  namespace-rewriting can silently break in ways that are hard to detect short of extensive
  live testing, and there's no confirmed incident on that path. If a similar collision is ever
  observed there, treat it as a separate, follow-up hardening task — don't fold it into this
  fix.
- `coenjacobs/mozart` is a **regular** (not dev) composer dependency, because
  `vendor/bin/mozart compose` runs automatically via `composer.json`'s `post-install-cmd` /
  `post-update-cmd` scripts, and a `composer install` run with `--no-dev` would otherwise skip
  installing it.
- `composer install` (or `update`) remains the only command needed to build/deploy this
  module — see `../CLAUDE.md`.

Module code (`MaISlookup.php`, `classes/MAISClient.php`, `pages/mapping_helper.php`,
`pages/mais_lookup.php`) now imports `MaisLookupVendor\GuzzleHttp\...` instead of bare
`GuzzleHttp\...`. `require_once 'vendor/autoload.php'` is unchanged — the prefixed classes are
reachable through the same autoloader via a `psr-4` entry added to this module's own
`composer.json` (`"MaisLookupVendor\\": "vendor_prefixed/"`).

## Verification

1. **Repro, before and after** — a script loading REDCap core 17.2.3's actual
   `Libraries/vendor/autoload.php` and the module's `vendor/autoload.php` in one process,
   forcing the exact `Client`(core)/`Utils`(module) pairing the production stack trace implies:
   - Before the fix: reproduced the identical fatal
     (`Call to undefined method GuzzleHttp\Utils::normalizeIdnConversionOption()`).
   - After the fix: loading both vendors normally (no forcing) shows `GuzzleHttp\Client`/
     `Utils` resolve only to core's copies, `MaisLookupVendor\GuzzleHttp\Client`/`Utils`
     resolve only to the module's, and both pairs work correctly on their own (including the
     exact `idn_conversion` call that used to crash).
2. **Live end-to-end test** — against a real REDCap 17.2.3 instance (local docker, upgraded to
   match production) with project 202's `su17_employee_form` (`emp_sunet_person_involved` as
   `sunetid-field`), driven through a real browser via Playwright: typing a SUNet ID triggered
   `GoogleSecretManager` → `CertificateManager` → `MAISClient`, made a real mutual-TLS call to
   `registry.stanford.edu` using the now-prefixed Guzzle/google-auth stack, and failed
   *gracefully* with a handled 404 (the test SUNet ID doesn't exist) rather than a fatal —
   confirming the full credential/API chain works correctly post-fix. No PHP errors/fatals in
   the web container log during the test.

## Deferred follow-up (not part of this fix)

`google/protobuf`, `grpc/grpc`, `google/common-protos` are bundled by both core and this
module too, at different versions, and are a latent instance of the same class of bug. They
were deliberately left alone here (see "Fix" above) because there's no confirmed incident on
that path and the risk of silently breaking Secret Manager access via careless scoping is
worse than the current, narrower, already-fixed bug. If a related crash is ever seen
originating in that stack, scope it as its own task rather than expanding this one.
