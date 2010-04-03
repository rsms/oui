/**
 * Set a cookie.
 *
 * Parameters:
 *   name   -- name of the cookie. Required.
 *   value  -- raw value of the cookie (will be passed through escape() before
 *             stored). Required.
 *   ttl    -- Time To Love in seconds from Date.now OR a Date object denoting
 *             exact expiry time. Not used is passed a false value.
 *   path   -- Base path. Defaults to "/" if undefined. Not used if false.
 *   domain -- Domain the cookie should be active in. Defaults to current domain
 *             if undefined. Not used if false.
 *   secure -- If true, only pass the cookie over secure connections. Defaults
 *             to false.
 */
exports.set = function(name, value, ttl, path, domain, secure) {
  var expires = null;
  if (path === undefined) path = '/';
  if (domain === undefined) domain = document.location.domain;
  if (secure === undefined) secure = false;
  if (typeof ttl === 'number') {
    expires = new Date();
    expires.setTime(expires.getTime()+(ttl*1000.0));
  } else if (typeof ttl === 'object' && ttl instanceof Date) {
    expires = ttl;
  }
  document.cookie = name + "=" +escape(String(value)) +
    ( ( expires ) ? ";expires=" + expires.toUTCString() : "" ) +
    ( ( path ) ? ";path=" + path : "" ) +
    ( ( domain ) ? ";domain=" + domain : "" ) +
    ( ( secure ) ? ";secure" : "" );
};

// returns undefined if not found
exports.get = function(name) {
  // first we'll split this cookie up into name/value pairs
  // note: document.cookie only returns name=value, not the other components
  var a_all_cookies = document.cookie.split(';');
  var a_temp_cookie = '';
  var cookie_name = '';
  var cookie_value = '';
  var b_cookie_found = false; // set boolean t/f default f
  for ( i = 0; i < a_all_cookies.length; i++) {
    // now we'll split apart each name=value pair
    a_temp_cookie = a_all_cookies[i].split('=');
    // and trim left/right whitespace while we're at it
    cookie_name = a_temp_cookie[0].replace(/^\s+|\s+$/g, '');
    // if the extracted name matches passed name
    if (cookie_name === name) {
      b_cookie_found = true;
      // we need to handle case where cookie has no value but exists (no = sign, that is):
      if (a_temp_cookie.length > 1)
        cookie_value = unescape( a_temp_cookie[1].replace(/^\s+|\s+$/g, '') );
      // note that in cases where cookie is initialized but no value, null is returned
      return cookie_value;
      break;
    }
    a_temp_cookie = undefined;
    cookie_name = '';
  }
};

exports.clear = function(name) {
  exports.set(name, '', -1);
};
