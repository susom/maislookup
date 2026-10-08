<?php

namespace Stanford\MaISlookup;

/**
 * The WebAuth login/lookup token is missing, expired or belongs to another user.
 * The browser should reload the survey page to re-authenticate.
 */
class WebauthSessionException extends \Exception
{
}
