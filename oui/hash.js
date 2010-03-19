/*
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS 180-1
 * Version 2.2 Copyright Paul Johnston 2000 - 2009.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 */

const B64CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/";
const B16CHARS = "0123456789abcdef";

/*
 * Convert a raw string to a hex string
 */
function rstr2hex(input)
{
	var output = "";
	var x;
	for(var i = 0; i < input.length; i++)
	{
		x = input.charCodeAt(i);
		output += B16CHARS.charAt((x >>> 4) & 0x0F)
					 +	B16CHARS.charAt( x				& 0x0F);
	}
	return output;
}

/*
 * Convert a raw string to a base-64 string
 */
function rstr2b64(input, padchar)
{
  if (!padchar) padchar = "=";
	var output = "";
	var len = input.length;
	for(var i = 0; i < len; i += 3)
	{
		var triplet = (input.charCodeAt(i) << 16)
								| (i + 1 < len ? input.charCodeAt(i+1) << 8 : 0)
								| (i + 2 < len ? input.charCodeAt(i+2)			: 0);
		for(var j = 0; j < 4; j++)
		{
			if (i * 8 + j * 6 > input.length * 8) output += padchar;
			else output += B64CHARS.charAt((triplet >>> 6*(3-j)) & 0x3F);
		}
	}
	return output;
}

/*
 * Convert a raw string to an arbitrary string encoding
 */
function rstr2any(input, encoding, divisor) {
	divisor = divisor || encoding.length;
	if (divisor > encoding.length)
		throw new Error('not enough characters');
	var remainders = Array();
	var i, q, x, quotient;

	/* Convert to an array of 16-bit big-endian values, forming the dividend */
	var dividend = Array(Math.ceil(input.length / 2));
	for(i = 0; i < dividend.length; i++)
	{
		dividend[i] = (input.charCodeAt(i * 2) << 8) | input.charCodeAt(i * 2 + 1);
	}

	/*
	 * Repeatedly perform a long division. The binary array forms the dividend,
	 * the length of the encoding is the divisor. Once computed, the quotient
	 * forms the dividend for the next step. We stop when the dividend is zero.
	 * All remainders are stored for later use.
	 */
	while(dividend.length > 0)
	{
		quotient = Array();
		x = 0;
		for(i = 0; i < dividend.length; i++)
		{
			x = (x << 16) + dividend[i];
			q = Math.floor(x / divisor);
			x -= q * divisor;
			if(quotient.length > 0 || q > 0)
				quotient[quotient.length] = q;
		}
		remainders[remainders.length] = x;
		dividend = quotient;
	}

	/* Convert the remainders to the output string */
	var output = "";
	for(i = remainders.length - 1; i >= 0; i--)
		output += encoding.charAt(remainders[i]);

	/* Append leading zero equivalents */
	var full_length = Math.ceil(input.length * 8 /
																		(Math.log(encoding.length) / Math.log(2)))
	for(i = output.length; i < full_length; i++)
		output = encoding[0] + output;

	return output;
}

/*
 * Encode a string as utf-8.
 * For efficiency, this assumes the input is valid utf-16.
 */
function str2rstr_utf8(input)
{
	var output = "";
	var i = -1;
	var x, y;

	while(++i < input.length)
	{
		/* Decode utf-16 surrogate pairs */
		x = input.charCodeAt(i);
		y = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
		if(0xD800 <= x && x <= 0xDBFF && 0xDC00 <= y && y <= 0xDFFF)
		{
			x = 0x10000 + ((x & 0x03FF) << 10) + (y & 0x03FF);
			i++;
		}

		/* Encode output as utf-8 */
		if(x <= 0x7F)
			output += String.fromCharCode(x);
		else if(x <= 0x7FF)
			output += String.fromCharCode(0xC0 | ((x >>> 6 ) & 0x1F),
																		0x80 | ( x				 & 0x3F));
		else if(x <= 0xFFFF)
			output += String.fromCharCode(0xE0 | ((x >>> 12) & 0x0F),
																		0x80 | ((x >>> 6 ) & 0x3F),
																		0x80 | ( x				 & 0x3F));
		else if(x <= 0x1FFFFF)
			output += String.fromCharCode(0xF0 | ((x >>> 18) & 0x07),
																		0x80 | ((x >>> 12) & 0x3F),
																		0x80 | ((x >>> 6 ) & 0x3F),
																		0x80 | ( x				 & 0x3F));
	}
	return output;
}

/*
 * Encode a string as utf-16
 */
function str2rstr_utf16le(input)
{
	var output = "";
	for(var i = 0; i < input.length; i++)
		output += String.fromCharCode( input.charCodeAt(i)				& 0xFF,
																	(input.charCodeAt(i) >>> 8) & 0xFF);
	return output;
}

function str2rstr_utf16be(input) {
	var output = "";
	for(var i = 0; i < input.length; i++)
		output += String.fromCharCode((input.charCodeAt(i) >>> 8) & 0xFF,
																	 input.charCodeAt(i)				& 0xFF);
	return output;
}

/*
 * Convert a raw string to an array of big-endian words
 * Characters >255 have their high-byte silently ignored.
 */
function rstr2binb(input) {
	var output = Array(input.length >> 2);
	for(var i = 0; i < output.length; i++)
		output[i] = 0;
	for(var i = 0; i < input.length * 8; i += 8)
		output[i>>5] |= (input.charCodeAt(i / 8) & 0xFF) << (24 - i % 32);
	return output;
}

/*
 * Convert a raw string to an array of little-endian words
 * Characters >255 have their high-byte silently ignored.
 */
function rstr2binl(input) {
  var output = Array(input.length >> 2);
  for(var i = 0; i < output.length; i++)
    output[i] = 0;
  for(var i = 0; i < input.length * 8; i += 8)
    output[i>>5] |= (input.charCodeAt(i / 8) & 0xFF) << (i%32);
  return output;
}

/*
 * Convert an array of big-endian words to a string
 */
function binb2rstr(input) {
	var output = "";
	for(var i = 0; i < input.length * 32; i += 8)
		output += String.fromCharCode((input[i>>5] >>> (24 - i % 32)) & 0xFF);
	return output;
}

/*
 * Convert an array of little-endian words to a string
 */
function binl2rstr(input) {
  var output = "";
  for(var i = 0; i < input.length * 32; i += 8)
    output += String.fromCharCode((input[i>>5] >>> (i % 32)) & 0xFF);
  return output;
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
	var lsw = (x & 0xFFFF) + (y & 0xFFFF);
	var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
	return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function bit_rol(num, cnt)
{
	return (num << cnt) | (num >>> (32 - cnt));
}

function _rstrfin(r, rawOrRadix, padchar) {
	if (rawOrRadix === 16 || rawOrRadix === undefined || !rawOrRadix)
		return rstr2hex(r);
	else if (rawOrRadix === 64)
		return rstr2b64(r, padchar);
	else if (rawOrRadix !== 1 && typeof rawOrRadix === 'number') {
		if (rawOrRadix < 65)
			return rstr2any(r, B64CHARS, rawOrRadix);
		// we could do larger radixes, but we do not have a larger map
		throw new Error('rawOrRadix argument must be between 2 and 64');
	}
	return r;
}

// ----------------------------------------------------------------------------
// MD5

/*
 * Calculate the MD5 of an array of little-endian words, and a bit length.
 */
function binl_md5(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << ((len) % 32);
  x[(((len + 64) >>> 9) << 4) + 14] = len;

  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;

  for(var i = 0; i < x.length; i += 16)
  {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;

    a = md5_ff(a, b, c, d, x[i+ 0], 7 , -680876936);
    d = md5_ff(d, a, b, c, x[i+ 1], 12, -389564586);
    c = md5_ff(c, d, a, b, x[i+ 2], 17,  606105819);
    b = md5_ff(b, c, d, a, x[i+ 3], 22, -1044525330);
    a = md5_ff(a, b, c, d, x[i+ 4], 7 , -176418897);
    d = md5_ff(d, a, b, c, x[i+ 5], 12,  1200080426);
    c = md5_ff(c, d, a, b, x[i+ 6], 17, -1473231341);
    b = md5_ff(b, c, d, a, x[i+ 7], 22, -45705983);
    a = md5_ff(a, b, c, d, x[i+ 8], 7 ,  1770035416);
    d = md5_ff(d, a, b, c, x[i+ 9], 12, -1958414417);
    c = md5_ff(c, d, a, b, x[i+10], 17, -42063);
    b = md5_ff(b, c, d, a, x[i+11], 22, -1990404162);
    a = md5_ff(a, b, c, d, x[i+12], 7 ,  1804603682);
    d = md5_ff(d, a, b, c, x[i+13], 12, -40341101);
    c = md5_ff(c, d, a, b, x[i+14], 17, -1502002290);
    b = md5_ff(b, c, d, a, x[i+15], 22,  1236535329);

    a = md5_gg(a, b, c, d, x[i+ 1], 5 , -165796510);
    d = md5_gg(d, a, b, c, x[i+ 6], 9 , -1069501632);
    c = md5_gg(c, d, a, b, x[i+11], 14,  643717713);
    b = md5_gg(b, c, d, a, x[i+ 0], 20, -373897302);
    a = md5_gg(a, b, c, d, x[i+ 5], 5 , -701558691);
    d = md5_gg(d, a, b, c, x[i+10], 9 ,  38016083);
    c = md5_gg(c, d, a, b, x[i+15], 14, -660478335);
    b = md5_gg(b, c, d, a, x[i+ 4], 20, -405537848);
    a = md5_gg(a, b, c, d, x[i+ 9], 5 ,  568446438);
    d = md5_gg(d, a, b, c, x[i+14], 9 , -1019803690);
    c = md5_gg(c, d, a, b, x[i+ 3], 14, -187363961);
    b = md5_gg(b, c, d, a, x[i+ 8], 20,  1163531501);
    a = md5_gg(a, b, c, d, x[i+13], 5 , -1444681467);
    d = md5_gg(d, a, b, c, x[i+ 2], 9 , -51403784);
    c = md5_gg(c, d, a, b, x[i+ 7], 14,  1735328473);
    b = md5_gg(b, c, d, a, x[i+12], 20, -1926607734);

    a = md5_hh(a, b, c, d, x[i+ 5], 4 , -378558);
    d = md5_hh(d, a, b, c, x[i+ 8], 11, -2022574463);
    c = md5_hh(c, d, a, b, x[i+11], 16,  1839030562);
    b = md5_hh(b, c, d, a, x[i+14], 23, -35309556);
    a = md5_hh(a, b, c, d, x[i+ 1], 4 , -1530992060);
    d = md5_hh(d, a, b, c, x[i+ 4], 11,  1272893353);
    c = md5_hh(c, d, a, b, x[i+ 7], 16, -155497632);
    b = md5_hh(b, c, d, a, x[i+10], 23, -1094730640);
    a = md5_hh(a, b, c, d, x[i+13], 4 ,  681279174);
    d = md5_hh(d, a, b, c, x[i+ 0], 11, -358537222);
    c = md5_hh(c, d, a, b, x[i+ 3], 16, -722521979);
    b = md5_hh(b, c, d, a, x[i+ 6], 23,  76029189);
    a = md5_hh(a, b, c, d, x[i+ 9], 4 , -640364487);
    d = md5_hh(d, a, b, c, x[i+12], 11, -421815835);
    c = md5_hh(c, d, a, b, x[i+15], 16,  530742520);
    b = md5_hh(b, c, d, a, x[i+ 2], 23, -995338651);

    a = md5_ii(a, b, c, d, x[i+ 0], 6 , -198630844);
    d = md5_ii(d, a, b, c, x[i+ 7], 10,  1126891415);
    c = md5_ii(c, d, a, b, x[i+14], 15, -1416354905);
    b = md5_ii(b, c, d, a, x[i+ 5], 21, -57434055);
    a = md5_ii(a, b, c, d, x[i+12], 6 ,  1700485571);
    d = md5_ii(d, a, b, c, x[i+ 3], 10, -1894986606);
    c = md5_ii(c, d, a, b, x[i+10], 15, -1051523);
    b = md5_ii(b, c, d, a, x[i+ 1], 21, -2054922799);
    a = md5_ii(a, b, c, d, x[i+ 8], 6 ,  1873313359);
    d = md5_ii(d, a, b, c, x[i+15], 10, -30611744);
    c = md5_ii(c, d, a, b, x[i+ 6], 15, -1560198380);
    b = md5_ii(b, c, d, a, x[i+13], 21,  1309151649);
    a = md5_ii(a, b, c, d, x[i+ 4], 6 , -145523070);
    d = md5_ii(d, a, b, c, x[i+11], 10, -1120210379);
    c = md5_ii(c, d, a, b, x[i+ 2], 15,  718787259);
    b = md5_ii(b, c, d, a, x[i+ 9], 21, -343485551);

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
  }
  return Array(a, b, c, d);
}

// These functions implement the four basic operations the algorithm uses.
function md5_cmn(q, a, b, x, s, t) {
  return safe_add(bit_rol(safe_add(safe_add(a, q), safe_add(x, t)), s),b);
}
function md5_ff(a, b, c, d, x, s, t) {
  return md5_cmn((b & c) | ((~b) & d), a, b, x, s, t);
}
function md5_gg(a, b, c, d, x, s, t) {
  return md5_cmn((b & d) | (c & (~d)), a, b, x, s, t);
}
function md5_hh(a, b, c, d, x, s, t) {
  return md5_cmn(b ^ c ^ d, a, b, x, s, t);
}
function md5_ii(a, b, c, d, x, s, t) {
  return md5_cmn(c ^ (b | (~d)), a, b, x, s, t);
}

/*
 * Calculate the MD5 of a raw string
 */
function rstr_md5(s) {
  return binl2rstr(binl_md5(rstr2binl(s), s.length * 8));
}

/*
 * Calculate the HMAC-MD5, of a key and some data (raw strings)
 */
function rstr_hmac_md5(key, data) {
  var bkey = rstr2binl(key);
  if(bkey.length > 16) bkey = binl_md5(bkey, key.length * 8);

  var ipad = Array(16), opad = Array(16);
  for(var i = 0; i < 16; i++)
  {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  var hash = binl_md5(ipad.concat(rstr2binl(data)), 512 + data.length * 8);
  return binl2rstr(binl_md5(opad.concat(hash), 512 + 128));
}

// ---------
// SHA-1

/*
 * Calculate the SHA-1 of an array of big-endian words, and a bit length
 */
function binb_sha1(x, len)
{
	/* append padding */
	x[len >> 5] |= 0x80 << (24 - len % 32);
	x[((len + 64 >> 9) << 4) + 15] = len;

	var w = Array(80);
	var a =	1732584193;
	var b = -271733879;
	var c = -1732584194;
	var d =	271733878;
	var e = -1009589776;

	for(var i = 0; i < x.length; i += 16)
	{
		var olda = a;
		var oldb = b;
		var oldc = c;
		var oldd = d;
		var olde = e;

		for(var j = 0; j < 80; j++)
		{
			if(j < 16) w[j] = x[i + j];
			else w[j] = bit_rol(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
			var t = safe_add(safe_add(bit_rol(a, 5), sha1_ft(j, b, c, d)),
											 safe_add(safe_add(e, w[j]), sha1_kt(j)));
			e = d;
			d = c;
			c = bit_rol(b, 30);
			b = a;
			a = t;
		}

		a = safe_add(a, olda);
		b = safe_add(b, oldb);
		c = safe_add(c, oldc);
		d = safe_add(d, oldd);
		e = safe_add(e, olde);
	}
	return Array(a, b, c, d, e);

}

/*
 * Perform the appropriate triplet combination function for the current
 * iteration
 */
function sha1_ft(t, b, c, d)
{
	if(t < 20) return (b & c) | ((~b) & d);
	if(t < 40) return b ^ c ^ d;
	if(t < 60) return (b & c) | (b & d) | (c & d);
	return b ^ c ^ d;
}

/*
 * Determine the appropriate additive constant for the current iteration
 */
function sha1_kt(t)
{
	return (t < 20) ?	1518500249 : (t < 40) ?	1859775393 :
				 (t < 60) ? -1894007588 : -899497514;
}

/*
 * Calculate the SHA1 of a raw string
 */
function rstr_sha1(s)
{
	return binb2rstr(binb_sha1(rstr2binb(s), s.length * 8));
}

/*
 * Calculate the HMAC-SHA1 of a key and some data (raw strings)
 */
function rstr_hmac_sha1(key, data)
{
	var bkey = rstr2binb(key);
	if(bkey.length > 16) bkey = binb_sha1(bkey, key.length * 8);

	var ipad = Array(16), opad = Array(16);
	for(var i = 0; i < 16; i++)
	{
		ipad[i] = bkey[i] ^ 0x36363636;
		opad[i] = bkey[i] ^ 0x5C5C5C5C;
	}

	var hash = binb_sha1(ipad.concat(rstr2binb(data)), 512 + data.length * 8);
	return binb2rstr(binb_sha1(opad.concat(hash), 512 + 160));
}

// -------
// Exports

exports.sha1 = function(data, rawOrRadix, padchar) {
	if (typeof data !== 'string')
		throw new Error('first argument must be a string');
	r = rstr_sha1(str2rstr_utf8(data));
	return _rstrfin(r, rawOrRadix, padchar);
}
exports.sha1_hmac = function(key, data, rawOrRadix, padchar) {
	if (typeof key !== 'string' || typeof data !== 'string')
		throw new Error('first and second argument must be a string');
	r = rstr_hmac_sha1(str2rstr_utf8(key), str2rstr_utf8(data))
	return _rstrfin(r, rawOrRadix, padchar);
}

exports.md5 = function(data, rawOrRadix, padchar) {
	if (typeof data !== 'string')
		throw new Error('first argument must be a string');
	r = rstr_md5(str2rstr_utf8(data));
	return _rstrfin(r, rawOrRadix, padchar);
}
exports.md5_hmac = function(key, data, rawOrRadix, padchar) {
	if (typeof key !== 'string' || typeof data !== 'string')
		throw new Error('first and second argument must be a string');
	r = rstr_hmac_md5(str2rstr_utf8(key), str2rstr_utf8(data))
	return _rstrfin(r, rawOrRadix, padchar);
}
