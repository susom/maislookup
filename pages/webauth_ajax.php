<?php
namespace Stanford\MaISlookup;

/** @var \Stanford\MaISlookup\MaISlookup $module */

// Lookup/save endpoint for surveys served under Stanford WebAuth (/webauth/surveys/).
// JSMO ajax cannot be used there (see docs/2026-10-07-ios-webauth-survey-lookup-investigation.md).
// Reached via /webauth/api/..., so Apache enforces OIDC on every call; requests are
// authorized by REMOTE_USER plus the signed token issued when the survey page rendered.
$module->handleWebauthAjax();
