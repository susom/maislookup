<?php

/**
 * Mozart (run just before this script, via the composer post-install/post-update
 * scripts) prefixes guzzlehttp/guzzle, guzzlehttp/promises, guzzlehttp/psr7,
 * google/auth and firebase/php-jwt into the MaisLookupVendor\ namespace, but it only
 * rewrites references *inside* the packages it moves. google/gax, google/cloud-secret-manager
 * and google/longrunning depend on those packages too (that's how the mismatched-version
 * class collision with REDCap core happened in the first place) but aren't themselves
 * moved/prefixed, so their own `use GuzzleHttp\...` / `use Google\Auth\...` /
 * `use Firebase\JWT\...` imports still need to be repointed at the new namespace by hand.
 *
 * Restricted to `use` statements specifically (not arbitrary text) so this can't mangle
 * comments/strings, and so re-running it against an already-patched vendor/ is a no-op.
 */

$targets = [
    __DIR__ . '/../vendor/google/gax/src',
    __DIR__ . '/../vendor/google/cloud-secret-manager/src',
    __DIR__ . '/../vendor/google/longrunning/src',
];

$replacements = [
    '/^use GuzzleHttp\\\\/m'    => 'use MaisLookupVendor\\GuzzleHttp\\',
    '/^use Google\\\\Auth\\\\/m'  => 'use MaisLookupVendor\\Google\\Auth\\',
    '/^use Firebase\\\\JWT\\\\/m' => 'use MaisLookupVendor\\Firebase\\JWT\\',
    // psr/http-message, psr/http-client and psr/http-factory get pulled into the same
    // prefix as an unavoidable side effect of Mozart moving guzzlehttp/guzzle and
    // guzzlehttp/psr7 (Mozart's dependency exclusion doesn't reach packages nested more
    // than one level deep, e.g. guzzle -> psr7 -> psr/http-message). Since the interfaces
    // move together with their only real implementations (Guzzle's PSR-7 classes) this is
    // harmless -- it just means anything outside the moved tree that type-hints against
    // the bare PSR HTTP interfaces needs repointing too, same as the Guzzle/auth imports above.
    '/^use Psr\\\\Http\\\\Message\\\\/m' => 'use MaisLookupVendor\\Psr\\Http\\Message\\',
    '/^use Psr\\\\Http\\\\Client\\\\/m'  => 'use MaisLookupVendor\\Psr\\Http\\Client\\',
];

$patchedFiles = 0;

foreach ($targets as $dir) {
    if (!is_dir($dir)) {
        continue;
    }

    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->getExtension() !== 'php') {
            continue;
        }

        $path = $file->getPathname();
        $original = file_get_contents($path);
        $patched = preg_replace(array_keys($replacements), array_values($replacements), $original);

        if ($patched !== $original) {
            file_put_contents($path, $patched);
            $patchedFiles++;
        }
    }
}

echo "patch-vendor-references: rewrote guzzle/google-auth/firebase-jwt imports in $patchedFiles file(s)\n";
