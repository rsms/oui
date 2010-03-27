// response additions (inherits from http.OutgoingMessage)
var sys = require('sys'),
    fs = require('fs'),
    path = require('path'),
    http = require('http'),
    mimetypes = require('../../mimetypes');

const RE_OUTER_DQUOTES = /^"+|"+$/g,
      RE_COMMA_WS = /,\s*/;

// utils
function stat2etag(s) {
	return s.mtime.getTime().toString(36)+s.ino.toString(36)+s.mode.toString(36);
}

// monkey patch writeHead so we can set some headers automatically
function patchWriteHead (rsp) {
	var origWriteHead = rsp.writeHead;
  rsp.writeHead = function(statusCode, headers) {
  	if (statusCode) this.status = statusCode;
  	if (headers) this.headers = headers;
  	if (this.request.cookies && this.request.cookies.length)
  		this.addCookieHeaders(this.headers);
  	if (this.allowedOrigin)
  		this.addACLHeaders(this.headers);
  	origWriteHead.call(this, this.status, this.headers);
  	this.started = true;
  	if (this.request.method === 'HEAD')
  		this.end();
  }
}

// monkey patch close to emit an 'end' event.
var _http_OutgoingMessage_close = http.OutgoingMessage.prototype.close
mixin(http.OutgoingMessage.prototype, {
	close: function() {
		_http_OutgoingMessage_close.call(this);
		this.emit("end");
	}
});

mixin(http.ServerResponse.prototype, {
	prepare: function() {
		var server = this.request.connection.server
		this.headers = [
			// Date is required by HTTP 1.1
			['Date', (new Date()).toUTCString()]
		]
		if (server.name)
			this.headers.push(['Server', server.name])
		this.status = 200
		this.encoding = 'utf-8'
		//this.type = 'text/html'
		this.allowedOrigin = server.allowedOrigin;
		patchWriteHead(this);
	},
	
	indexOfHeader: function(name) {
	  name = name.toLowerCase();
	  var v = this.headers;
	  for (var i,t; t = v[i]; i++)
	    if (t[0] && String(t[0]).toLowerCase() === name)
	      return i;
	  return -1;
	},
	
	// Add or replace header
	setHeader: function(name, value) {
	  var i = this.indexOfHeader(name);
	  if (i === -1) this.headers.push([name, value]);
	  else this.headers[i] = [name, value];
	},

	addCookieHeaders: function(headers) {
		var ret, name, options, cookies = this.request.cookies
		for (name in cookies) {
			if (cookies[name].preset)
				continue // don't re-set pre-set cookies yo
			options = cookies[name]
			ret = name + '=' + encodeURIComponent(options.value)
			if (options.expires)
				ret += '; expires=' + options.expires.toUTCString()
			if (options.path)
				ret += '; path=' + options.path
			if (options.domain)
				ret += '; domain=' + options.domain
			if (options.secure)
				ret += '; secure'
			headers.push(['Set-Cookie', ret])
		}
		return headers
	},

	/**
	 * Construct and add CORS ACL headers to the response.
	 *
	 * Per http://www.w3.org/TR/cors/
	 *
	 * Returns undefined if the request did not contain a Origin header
	 *         or the response.allowedOrigin is empty.
	 * Returns true if the origin was allowed and appropriate headers was set.
	 * Returns false if the origin was not allowed (no headers set).
	 */
	addACLHeaders: function(headers) {
		var reqHeaders = this.request.headers
		var origin = reqHeaders['origin']
		if (origin && this.allowedOrigin) {
			// origin
			var allowed = false
			if (origin.indexOf('://') === -1) {
				// Some browsers send "Origin: null" for localhost and file:// origins.
				// Also, since the model is client trust-based, we can be forgiving.
				allowed = true
				headers.push(['Access-Control-Allow-Origin', '*'])
			}
			else {
				if (this.allowedOrigin.test(origin)) {
					headers.push(['Access-Control-Allow-Origin', origin])
					allowed = true
				}
			}

			// ancillary headers
			if (allowed) {
				// todo: Access-Control-Allow-Credentials
				var allowHeaders = reqHeaders['access-control-request-headers']
				if (allowHeaders)
					headers.push(['Access-Control-Allow-Headers', allowHeaders])

				var allowMethod = reqHeaders['access-control-request-method']
				if (allowMethod)
					headers.push(['Access-Control-Allow-Methods', allowMethod])

				// we do not keep state, so please do not rely on results
				headers.push(['Access-Control-Max-Age', '0'])
			}
			return allowed
		}
	},

	format: function(obj) {
		if (obj === undefined)
			return null;
		// todo: content-negotiation or something else (strict)
		this.type = 'application/json'
		return JSON.stringify(obj)
	},

	/**
	 * Build a error response object.
	 *
	 * {error:{
	 *   title: <string>,
	 *   message: <string>,
	 *   stack: [<string>, ..]
	 * }}
	 */
	mkError: function(status, title, message, exception) {
		if (typeof status === 'object' && status.stack !== undefined) {
			exception = status
			this.status = 500
		}
		else {
			this.status = parseInt(status) || 500
		}
		e = {title: String(title || 'Error')}
		if (exception) {
			e.message = message ? String(message)+' ' : ''
			if (exception.message)
				e.message += exception.message
			else if (e.message.length === 0)
				delete e.message // no message
			if (exception.stack)
				e.stack = exception.stack.split(/[\r\n]+ +/m)
		}
		else if (message) {
			e.message = String(message)
		}
		return {error: e}
	},

	tryGuard: function(fun, msg) {
		try {
			fun()
		}
		catch(exc) {
			return res.sendError(null, null, msg || '', exc)
		}
	},

	sendData: function(body) {
		this.request.sendResponse(body)
	},

	sendObject: function(responseObject) {
		var body = this.format(responseObject)
		this.request.sendResponse(body)
	},

	sendError: function(status, title, message, error) {
	  if (status instanceof Error) {
	    error = status;
	    status = undefined;
	  }
		var obj = this.mkError(status, title, message, error);
		this.request.connection.server.debug && sys.log(
			'[oui] sendError '+sys.inspect(obj.error));
		this.sendObject(obj);
	},

	doesMatchRequestPredicates: function(etag, mtime) {
		if (etag) {
			var etags, nomatch = this.request.headers['if-none-match'];
			if (nomatch !== undefined) {
				if (nomatch === '*') return 304;
				etags = nomatch.split(RE_COMMA_WS);
				for (var i=0,t; t = etags[i]; i++) {
				  if (t && t.replace(RE_OUTER_DQUOTES,'') === etag)
				    return 304;
				}
			}
			var domatch = this.request.headers['if-match']
			if (domatch !== undefined) {
				if (domatch === '*') return false
				etags = nomatch.split(RE_COMMA_WS);
				for (var i=0,t; t = etags[i]; i++) {
				  if (t && t.replace(RE_OUTER_DQUOTES,'') === etag)
				    return false;
				}
				return 412
			}
			if (nomatch !== undefined)
				return false
		}

		if (mtime) {
			var ifmodsince = this.request.headers['if-modified-since']
			if (ifmodsince) {
				ifmodsince = new Date(ifmodsince)
				if (mtime <= ifmodsince)
					return 304
			}
		}

		return false
	},

	sendFile: function(abspath, contentType, stats, callback) {
	  if (!callback) callback = function(){};
		if (!abspath || abspath.constructor !== String)
			throw 'first argument must be a string'
		var res = this;
		var statsCb = function (s) {
			var errorClosure = function (error) {
  			sys.error('sendFile failed for "'+abspath+'"');
  			if (!res.finished) {
  				// Since response has not begun, send a pretty error message
  				res.sendError(500, "I/O error", error);
  			}
  			else {
  				// Response already begun
  				res.close();
  			}
  			callback(error);
  		}
			var etag = stat2etag(s);

			if (!contentType)
				contentType = mimetypes.lookup(path.extname(abspath)) 
				  || 'application/octet-stream';
			res.headers.push(['Content-Type', contentType]);
			res.headers.push(['Last-Modified', s.mtime.toUTCString()]);
			res.headers.push(['ETag', '"'+etag+'"']);

			// not modified?
			var match_status = res.doesMatchRequestPredicates(etag, s.mtime);
			if (match_status) {
				met = res.request.method;
				res.status = (met === 'GET' || me === 'HEAD') ? match_status : 412;
				var shouldAddContentLength = true;
				for (var i=0;i<res.headers.length;i++) {
					var kv = res.headers[i];
					if (kv[0].toLowerCase() === 'content-length') {
						res.headers[i][1] = '0';
						shouldAddContentLength = false;
						break;
					}
				}
				if (shouldAddContentLength)
					res.headers.push(['Content-Length', '0']);
			}
			else {
				res.headers.push(['Content-Length', s.size]);
			}

			// send headers
			res.chunked_encoding = false;
			res.writeHead();
			res.flush();
			if (match_status) {
				res.close();
				return callback(null, 0);
			}

			// forward
			var enc = 'binary', rz = 8*1024;
			fs.open(abspath, process.O_RDONLY, 0666, function(err, fd) {
			  if (err) return errorClosure(err);
				var pos = 0;
				function readChunk () {
					fs.read(fd, rz, pos, enc, function(err, chunk, bytes_read) {
					  if (err) return errorClosure(err);
						if (chunk) {
							res.write(chunk, enc);
							pos += bytes_read;
							readChunk();
						}
						else { // EOF
							res.close();
							fs.close(fd, function (err) {
							  if (err) errorClosure(err);
                else callback(err, pos);
              });
						}
					});
				}
				readChunk();
			});
		}

		// do we have a prepared stats object?
		if (typeof stats === 'object') {
			statsCb(stats);
		}
		else {
			// perform stat
			fs.stat(abspath, function (error, stats) {
			  if (error) {
  				sys.log('[oui] warn: failed to read '+sys.inspect(abspath)+
  				  '. '+error);
  				res.sendError(404, 'File not found', 'No file at "'+abspath+'"');
  				callback(error);
  			}
  			else {
  			  statsCb(stats);
  			}
			});
		}
	}
});