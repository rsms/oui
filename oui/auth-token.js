/*
  Auth-token generation and validation.

  A authToken is constructed like this:

      authToken    = ts ":" token
      ts           = BASE-36( TIME-NOW )
      token        = BASE-62( SHA1-HMAC( userSecret, serverSecret ":" ts ) )
      userSecret   = <user-specific data, e.g. a shadow>
      serverSecret = <constant data>

  First step of verification is performed by checking token against a calculated
  expectation:

      token == BASE-62( SHA1-HMAC( userSecret, serverSecret ":" ts ) )

  Based on this, we can expire a token based on time. The integrity of the
  embedded timestamp `ts` is implicitly verified in the step above. To check for
  timeout, we simply do this:

      timeout = ( (ts + TTL) < TIME-NOW )

*/
var hash = require('./hash');
require('./std-additions'); // Date additions

/**
 * Calculate BASE-62( SHA1-HMAC( userSecret, serverSecret ":" ts ) )
 */
exports.calculate = function(serverSecret, userSecret, ts) {
  return hash.sha1_hmac(userSecret, serverSecret + ':' + ts, 62);
}

/**
 * Generate a authToken.
 */
exports.generate = function(serverSecret, userSecret) {
  var ts = Date.currentUTCTimestamp.toString(36);
  return ts + ':' + exports.calculate(serverSecret, userSecret, ts);
}

/**
 * Validate `authToken` with optional `ttl`.
 *
 * If `ttl` is passed, the `authToken` will be considered invalid if the time it
 * was created is farther (in relation to `now`) than `ttl`.
 */
exports.validate = function(serverSecret, userSecret, authToken, ttl, now) {
  var t = authToken.split(':', 2),
      ts = t[0];
  if ((now === undefined) && (typeof ttl === 'number'))
    now = Date.currentUTCTimestamp;
  var expectedToken = exports.calculate(serverSecret, userSecret, ts);
  // validate the integrity of ts
  if (expectedToken !== t[1]) return false;
  // check ttl
  return ( (now === undefined) || ((parseInt(ts, 36) + (ttl * 1000)) > now) );
}

/* // Unit test
var assert = require('assert');
var serverSecret = 'AZGNjMWE3YTgxZTljMTMxOSIKZmxhc2hJQzonQWN0aW9uQ29udH';
var ttl = 30*24*60*60;
var userSecret = 'AdXNlcl9mbG93MDoRdHJhbnNfcHJvbXB0MDoJdXN'; // userSecret
var authToken = exports.generate(serverSecret, userSecret, ttl);
// for testing purposes
var now = Date.currentUTCTimestamp;
assert.equal(!!authToken, true);
// should be valid since practically no time has passed
assert.equal(exports.validate(serverSecret, userSecret, authToken, ttl, now), true);
// should be valid since only 80% of the time has passed
now += (ttl*1000)*0.8;
assert.equal(exports.validate(serverSecret, userSecret, authToken, ttl, now), true);
// should be invalid since more than 100% of the time has passed
now += (ttl*1000)*0.21;
assert.equal(exports.validate(serverSecret, userSecret, authToken, ttl, now), false);
*/
