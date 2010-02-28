/**

	oui -- a small web service toolkit for node.js

		oui = require('oui')
		oui.start(8080)
		GET('/hello', function(params){
			return 'hello to you too'
		})

	Inspired by picard and smisk.

	URL:		 http://github.com/rsms/oui
	Author:	Rasmus Andersson <http://hunch.se/>
	License: MIT (basically do whatever you want -- see LICENSE for details)

 */
http = require('http')
sys = require('sys')
fs = require('fs')
url = require("url")
querystring = require("querystring")
path = require('path')

RE_OUTER_DQUOTES = /^"+|"+$/g
RE_COMMA_WS = /,\s*/
BODYLESS_STATUSES = [204,205,304] // HTTP statuses without body

// Enable debug mode (verbose async output to stdout)
exports.debug = false

var routes = {
	GET: [],
	POST: [],
	PUT: [],
	DELETE: [],
	OPTIONS: []
}
exports.routes = routes

// utils
function stat2etag(s) {
	return s.mtime.getTime().toString(36)+s.ino.toString(36)+s.mode.toString(36)
}

// request additions
process.mixin(http.IncomingMessage.prototype, {
	prepare: function() {
		this.path = this.url
		this.url = url.parse(this.url, true)
		this.params = {}
		// copy, not assign, query -> params
		var m = this.url.query
		for (var k in m) this.params[k] = m[k]
	},

	// Returns true on success, otherwise a response has been sent.
	parse: function() {
		var self = this;

		// cookies
		this.cookies = {}
		var s = this.headers['cookie']
		if (s) {
			s.split(/; */).forEach(function(cookie){
				var p = cookie.indexOf('=')
				if (p !== -1) {
					k = decodeURIComponent(cookie.substr(0, p).trim())
					v = decodeURIComponent(cookie.substr(p+1).trim())
					self.cookie(k, v, { preset: true })
				}
			})
		}

		// content
		this.contentType = this.headers['content-type']
		this.contentLength = parseInt(this.headers['content-length'] || 0)
		if (this.method === 'POST' || this.method === 'PUT')
			this.parseRequestEntity()
		return true;
	},

	parseRequestEntity: function() {
		// todo: handle other kind of content, like file uploads and arbitrary data.
		var server = this.connection.server, res = this.response;
		if (this.contentLength < 1)
			return res.sendError(411, 'Length Required');
		// state: if a request's content was buffered, .content is set.
		if (server.bufferableRequestTypes.indexOf(this.contentType) !== -1) {
			var send413 = function(){
				res.sendError(413, "Request Entity Too Large", "Maximum size is "+
					server.maxRequestBodySize.toString())
			};
			this.content = ''
			if (this.contentLength > 0) {
				// limited buffer
				if (typeof server.maxRequestBodySize === 'number') {
					if (this.contentLength > server.maxRequestBodySize) {
						return send413();
					}
					else {
						var fillcb;fillcb = function(chunk) {
							var z = this.content.length+chunk.length;
							if (z > server.maxRequestBodySize) {
								this.content += chunk.substr(0, server.maxRequestBodySize - z);
								this.removeListener('body', fillcb);
								// clipped the input, which is a good thing
								if (!this.started)
									send413();
							}
							else {
								this.content += chunk;
							}
						}
						this.addListener('body', fillcb);
					}
				}
				else {
					// unlimited buffer -- might be dangerous
					this.addListener('body', function(chunk) {this.content += chunk })
				}
			}
		}
	},

	addURIEncodedDataToParams: function(data) {
		var params = querystring.parse(data)
		for (var k in params)
			this.params[k] = params[k];
	},

	addJSONDataToParams: function(data) {
		var obj;
		try {
			obj = JSON.parse(data);
		}
		catch (exc) {
			return this.response.sendError(400, 'Bad JSON', exc.message)
		}
		if (typeof obj !== 'object') {
			return this.response.sendError(400, 'Bad JSON', 'Root object must be a list or a dict')
		}
		for (var k in obj)
			this.params[k] = obj[k];
	},

	solveRoute: function() {
		var rv = routes[(this.method === 'HEAD') ? 'GET' : this.method];
		if (rv === undefined)
			return
		for (var i=0, L = rv.length; i < L; i++){
			var route = rv[i]
			var matches = route.path.exec(this.url.pathname)
			if (matches) {
				if (Array.isArray(matches) && matches.length)
					route.extractParams(this, matches)
				this.route = route
				return route
			}
		}
	},

	/**
	 * Get or set a cookie
	 */
	cookie: function(name, val, options){
		if (val === undefined)
			return this.cookies[name]
		options = options || {}
		options.value = val
		options.path = options.path || '/'
		this.cookies[name] = options
	},

	/** send response */
	sendResponse: function(body) {
		var res = this.response
		if (res.finished)
			return
		if (res.status)
			res.status = parseInt(res.status)
		if (res.type !== undefined) {
			var contentType = res.type
			if (res.encoding !== undefined && contentType.indexOf('text/') === 0)
				contentType += '; charset='+res.encoding
			res.headers.push(['Content-Type', contentType])
		}
		var bodyless = BODYLESS_STATUSES.indexOf(res.status) !== -1;
		if (typeof body === 'string' && !bodyless) {
			res.headers.push(['Content-Length', body.length])
			res.writeHead()
			if (res.finished) // writeHead might have finished the response
				return;
			// HEAD responses must not include an entity
			if (!(res.status === 200 && this.method === 'HEAD'))
				res.write(body, res.encoding)
		}
		else {
			if (!bodyless)
				res.headers.push(['Content-Length', '0'])
			res.writeHead()
		}
		res.close()
	}
})

// request.filename
http.IncomingMessage.prototype.__defineGetter__("filename", function(){
	if (this._filename)
		return this._filename
	server = this.connection.server
	if (typeof server.documentRoot !== 'string')
		return this._filename = null
	abspath = path.join(server.documentRoot, this.url.pathname || '')
	abspath = path.normalize(abspath) // /x/y/../z --> /x/z
	if (abspath.substr(0, server.documentRoot.length) === server.documentRoot)
		return this._filename = abspath
	return this._filename = null
});
http.IncomingMessage.prototype.__defineSetter__("filename", function(v) {
	this._filename = String(v);
});


// outgoing msg additions
var _http_OutgoingMessage_close = http.OutgoingMessage.prototype.close
process.mixin(http.OutgoingMessage.prototype, {
	close: function() {
		_http_OutgoingMessage_close.call(this);
		this.emit("close");
	}
})

// response additions (inherits from http.OutgoingMessage)
var _http_ServerResponse_writeHead = http.ServerResponse.prototype.writeHead
process.mixin(http.ServerResponse.prototype, {
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
		this.allowedOrigin = server.allowedOrigin
	},

	// monkey patch writeHead so we can set some headers automatically
	writeHead: function(statusCode, headers) {
		statusCode = statusCode || this.status
		headers = headers || this.headers
		if (this.request.cookies && this.request.cookies.length)
			this.addCookieHeaders(headers)
		if (this.allowedOrigin)
			this.addACLHeaders(headers)
		_http_ServerResponse_writeHead.apply(this, [statusCode, headers]);
		if (this.request.connection.server.debug) {
			var r = this.request
			var s = '[oui] --> '+r.method+' '+r.path+
				'\n  HTTP/'+r.httpVersionMajor+'.'+r.httpVersionMinor+' '+
				statusCode + ' ' + http.STATUS_CODES[statusCode]
			for (var k in headers)
				s += '\n  '+headers[k][0]+': '+headers[k][1]
			sys.debug(s)
		}
		this.started = true;
		if (this.request.method === 'HEAD')
			this.end();
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
		this.request.connection.server.debug && sys.debug(
			'[oui] sendError '+sys.inspect(obj.error));
		this.sendObject(obj);
	},

	doesMatchRequestPredicates: function(etag, mtime) {
		if (etag) {
			var nomatch = this.request.headers['if-none-match']
			if (nomatch !== undefined) {
				if (nomatch === '*') return 304
				v = nomatch.split(RE_COMMA_WS)
				for (var i in v) {
					t = v[i].replace(RE_OUTER_DQUOTES,'')
					if (t === etag) return 304
				}
			}
			var domatch = this.request.headers['if-match']
			if (domatch !== undefined) {
				if (domatch === '*') return false
				v = domatch.split(RE_COMMA_WS)
				for (var i in v) {
					t = v[i].replace(RE_OUTER_DQUOTES,'')
					if (t === etag) return false
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
				contentType = mimetype.lookup(path.extname(abspath)) 
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
  				sys.puts('[oui] warn: failed to read '+sys.inspect(abspath)+
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
})


function requestCompleteHandler(req, res) {
	try {
		// only proceed if the response have not yet started
		if (res.started)
			return;

		// load form request
		if (req.content) {
			if (req.contentType === 'application/x-www-form-urlencoded')
				req.addURIEncodedDataToParams(req.content)
			else if (req.contentType === 'application/json')
				req.addJSONDataToParams(req.content)
		}

		// did the response start already?
		if (res.started)
			return;

		// let route handler act on req and res, possibly returning body struct
		var body = req.route.handler.apply(server, [req.params, req, res])

		// did the handler start the response or take over responsibility?
		if (body === undefined || res.started)
			return;

		// format response object
		if (body && body.constructor !== String)
			body = res.format(body)

		// send and mark as finished
		req.sendResponse(body)
	}
	catch(exc) {
		return res.sendError(exc)
	}
}


function requestHandler(req, res) {
	if (this.debug) {
		dateStarted = (new Date()).getTime()
		res.addListener('close', function(){
			ms = ((new Date()).getTime() - dateStarted)
			sys.debug('[oui] response finished (total time spent: '+ms+' ms)')
		})
	}
	req.response = res
	res.request = req

	req.prepare()
	res.prepare()

	// log request
	if (this.debug) {
		var s = '[oui] <-- '+req.method+' '+req.path
		for (var k in req.headers)
			s += '\n  '+k+': '+req.headers[k]
		sys.debug(s)
	}
	else if (this.verbose) {
		sys.puts('[oui] '+req.method+' '+req.path)
	}

	try {
		// solve route
		if (!req.solveRoute())
			return res.sendError(404, req.path+' not found')

		// parse the request (process header, cookies, register body buffer collectors, etc)
		if (!req.parse())
			return;

		// take action when request is completely received
		req.addListener('end', function(){ requestCompleteHandler(req, res) });
	}
	catch(exc) {
		return res.sendError(exc)
	}
}

/**
 * Create a new OUI server.
 *
 * Server properties:
 *
 *   .verbose = bool
 *      If true, send limited logging to stdout. Basically, just print a line
 *      each time a request is received containing the method and the path
 *      requested. Uses asynchronous I/O (in contrast to .debug). True by default.
 *
 *   .debug = bool
 *      If true, send excessive logging to stderr through sys.debug and sys.p.
 *      This should NOT BE ENABLED for production sites as the logging I/O is
 *      blocking and thus introduces a considerable performance penalty.
 *      By default, a new server instance's debug property has the same value
 *      as the module-wide property of the same name.
 *
 *   .allowedOrigin = <RegExp>
 *      Allow origins for cross-site requests (CORS)
 *      Example of allowing specific domains, including localhost:
 *      .allowedOrigin = /^https?:\/\/(?:(?:.+\.|)(?:yourdomain|otherdomain)\.[^\.]+|localhost|.+\.local)$/
 *
 *   .documentRoot = <String>
 *      Document root for serving static files.
 *
 *   .indexFilenames = <Array of <String>s>
 *      File to look for when requesting a directory.
 *
 *   .bufferableRequestTypes = <Array of <String>s>
 *      List of MIME types which denote "bufferable" request content payloads,
 *      that is; if a request is received with content and the value of a
 *      content-type header equals one of the strings in this list, the content
 *      entity of the request will be automatically read into a buffer. This
 *      buffer (a String) is later accessible from request.content.
 *
 *   .maxRequestBodySize = int
 *      When oui handled reading of request content entities, this limits the
 *      number of bytes which will be read. Important to keep this to a relatively
 *      low number to prevent DoS attacks.
 *
 */
function createServer() {
	var server = http.createServer(requestHandler)

	// Inherit debug property from module-wide property
	server.debug = exports.debug

	// Server name returned in responses. Please do not change this.
	server.name = 'oui/0.1 node/'+process.version

	// Allow any origin by default
	server.allowedOrigin = /./;

	// List of request content types we will buffer
	server.bufferableRequestTypes = [
		'application/x-www-form-urlencoded',
		'application/json']

	// Limit the size of a request body
	server.maxRequestBodySize = 1024*1024*2; // 2 MB

	return server
}

/** Start a server listening on [port[, addr]] */
function start(port, addr, verbose, debug) {
	server = createServer()
	server.verbose = (verbose === undefined || verbose) ? true : false
	if (debug !== undefined)
		server.debug = debug
	port = port || 80
	server.listen(port, addr ? addr : undefined)
	server.verbose && sys.puts('[oui] listening on '+(addr || '*')+':'+port)
	return server
}

exports.createServer = createServer
exports.start = start


/** Represents a route to handler by path */
function FixedStringMatch(string, caseSensitive) {
	this.string = caseSensitive ? string : string.toLowerCase();
	this.caseSensitive = caseSensitive;
}
FixedStringMatch.prototype.exec = function(str) {
	return this.caseSensitive ? (str === this.string) : (str.toLowerCase() === this.string);
}

function Route(pat, handler) {
	this.keys = []
	this.path = pat
	this.handler = handler

	if (handler.routes === undefined)
		handler.routes = [this]
	else
		handler.routes.push(this)

	// GET(['/users/([^/]+)/info', 'username'], ..
	if (Array.isArray(pat)) {
		re = pat.shift()
		if (!re || re.constructor !== RegExp)
			re = new RegExp('^'+re+'$')
		this.path = re
		this.keys = pat
	}
	// GET('/users/:username/info', ..
	else if (pat.constructor !== RegExp) {
		pat = String(pat);
		if (pat.indexOf(':') === -1) {
			this.path = new FixedStringMatch(pat)
			exports.debug && sys.debug(
				'[oui] route '+sys.inspect(pat)+' treated as absolute fixed-string match')
		}
		else {
			var nsrc = pat.replace(/:[^/]*/g, '([^/]*)')
			nsrc = '^'+nsrc+'$'
			exports.debug && sys.debug(
				'[oui] route '+sys.inspect(pat)+' compiled to '+sys.inspect(nsrc))
			this.path = new RegExp(nsrc, 'i') // case-insensitive by default
			var param_keys = pat.match(/:[^/]*/g)
			if (param_keys) for (var i=0; i < param_keys.length; i++)
				this.keys.push(param_keys[i].replace(/^:/, ''))
		}
	}
	// Pure RegExp
	// GET(/^\/users\/(<username>[^\/]+)\/info$/', ..
	// GET(/^\/users\/([^/]+)\/info$/, ..
	else {
		var src = pat.source
		var p = src.indexOf('<')
		if (p !== -1 && src.indexOf('>', p+1) !== -1) {
			var re = /\(<[^>]+>/;
			var m = null
			p--
			var nsrc = src.substr(0, p)
			src = src.substr(p)
			while (m = re.exec(src)) {
				nsrc += src.substring(0, m.index+1) // +1 for "("
				var mlen = m[0].length
				src = src.substr(m.index+mlen)
				this.keys.push(m[0].substr(2,mlen-3))
			}
			if (src.length)
				nsrc += src
			// i is the only modifier which makes sense for path matching routes
			this.path = new RegExp(nsrc, pat.ignoreCase ? 'i' : undefined)
		}
		else {
			this.path = pat
		}
	}
}
exports.Route = Route

Route.prototype.extractParams = function(req, matches) {
	var i, l, captures = []
	matches.shift()
	for (i=0, l = this.keys.length; i < l; i++)
		req.params[this.keys[i]] = querystring.unescape(matches.shift(), true)
	for (i=0, l = matches.length; i < l; i++)
		captures[i] = querystring.unescape(matches[i], true)
	req.params.captures = captures
}


exports.mimetype = mimetype = {
	knownfiles: [
		"/etc/mime.types",
		"/etc/apache2/mime.types",              // Apache 2
		"/etc/apache/mime.types",               // Apache 1
		"/etc/httpd/mime.types",                // Mac OS X <=10.5
		"/etc/httpd/conf/mime.types",           // Apache
		"/usr/local/etc/httpd/conf/mime.types",
		"/usr/local/lib/netscape/mime.types",
		"/usr/local/etc/httpd/conf/mime.types", // Apache 1.2
		"/usr/local/etc/mime.types"            // Apache 1.3
	],

	// a few common types "built-in"
	types: {
		 "css" : "text/css"
		,"flv" : "video/x-flv"
		,"gif" : "image/gif"
		,"gz" : "application/x-gzip"
		,"html" : "text/html"
		,"ico" : "image/vnd.microsoft.icon"
		,"jpg" : "image/jpeg"
		,"js" : "application/javascript"
		,"json" : "application/json"
		,"mp4" : "video/mp4"
		,"ogg" : "application/ogg"
		,"pdf" : "application/pdf"
		,"png" : "image/png"
		,"svg" : "image/svg+xml"
		,"tar" : "application/x-tar"
		,"tbz" : "application/x-bzip-compressed-tar"
		,"txt" : "text/plain"
		,"xml" : "application/xml"
		,"yml" : "text/yaml"
		,"zip" : "application/zip"
	},

	parse: function(data) {
		data.split(/[\r\n]+/).forEach(function(line){
			line = line.trim()
			if (line.charAt(0) === '#')
				return
			words = line.split(/\s+/)
			if (words.length < 2)
				return
			type = words.shift().toLowerCase()
			words.forEach(function(suffix) {
				mimetype.types[suffix.toLowerCase()] = type
			})
		})
	},

	_parseSystemTypes: function(paths, callback) {
	  if (!callback) {
	    for (var i=0;i<paths.length;i++) {
	      var content;
	      try {
	        content = fs.readFileSync(paths[i], 'binary');
        }
        catch (e) {
          if (i === paths.length-1)
            throw new Error('no mime types databases found');
          continue;
        }
        // parse outside of try so errors in parse propagates
        mimetype.parse(content);
        return paths[i];
	    }
	    return; // no error if the list <paths> was empty
	  }
	  // async
		var next = function(){
			var abspath = paths.shift();
			if (!abspath)
				return callback(new Error('no mime types databases found'));
			fs.readFile(abspath, 'binary', function (err, content) {
			  if (err) return next();
				mimetype.parse(content);
				callback(null, abspath);
			});
		}
		next();
	},

	/**
	 * Look up mime type for a filename extension, or look up
	 * list of filename extension for a mime type.
	 *
	 * Returns a string if <extOrType> is an extension (does not
	 * contain a "/"), otherwise a list of strings is returned.
	 *
	 * For compatibility with path.extname(), a filename extension
	 * is allowed to include the "." prefix (which will be stripped).
	 *
	 * Example:
	 *   mimetype.lookup('yml') => "text/yaml"
	 *   mimetype.lookup('text/yaml', function(err, types){
	 *     // types => ["yml", "yaml"]
	 *   })
	 */
	lookup: function(extOrType, callback) {
		// lazy importing of system mime types
		if (mimetype.knownfiles !== undefined) {
		  var filenames = mimetype.knownfiles;
		  delete mimetype.knownfiles;
			if (callback) {
			  // async
			  mimetype._parseSystemTypes(filenames, function(err){
			    callback(err, mimetype._lookup(extOrType));
			  });
			  return;
		  }
		  else {
		    // sync
		    mimetype._parseSystemTypes(filenames);
		    return mimetype._lookup(extOrType);
		  }
		}
		var r = mimetype._lookup(extOrType);
		return callback ? callback(null, r) : r;
	},
	
	_lookup: function(extOrType) {
	  // look up type based on extension, or extension based on type
		extOrType = extOrType.toLowerCase();
		if (extOrType.indexOf('/') === -1) {
			if (extOrType.charAt(0) === '.')
				extOrType = extOrType.substr(1);
			return mimetype.types[extOrType];
		}
		else {
			var exts = [];
			for (var k in mimetype.types) {
				if (mimetype.types[k] === extOrType)
					exts.push(k);
			}
			return exts;
		}
	}
}


/** Expose handler on path for GET (and implicitly also HEAD) */
GLOBAL.GET = function(path, handler){
	routes.GET.push(new Route(path, handler))
	return handler
}
/** Expose handler on path for POST */
GLOBAL.POST = function(path, handler){
	routes.POST.push(new Route(path, handler))
	return handler
}
/** Expose handler on path for PUT */
GLOBAL.PUT = function(path, handler){
	routes.PUT.push(new Route(path, handler))
	return handler
}
/** Expose handler on path for DELETE */
GLOBAL.DELETE = function(path, handler){
	routes.DELETE.push(new Route(path, handler))
	return handler
}
/** Expose handler on path for DELETE */
GLOBAL.OPTIONS = function(path, handler){
	routes.OPTIONS.push(new Route(path, handler))
	return handler
}

/** Expose handler on path for multiple methods */
exports.expose = function(methods, path, handler){
	for (var method in methods)
		GLOBAL[method] && GLOBAL[method](path, handler)
	return handler
}


/** Handler which takes care of requests for files */
function staticFileHandler(params, req, res) {
	var server = this;
	var notfoundCb = function() {
		server.debug && sys.debug('[oui] "'+req.filename+'" does not exist')
		res.sendError(404, 'File not found', 'Nothing found at '+req.path, null)
	}

	if (!req.filename)
		return notfoundCb();

	fs.stat(req.filename, function(err, stats) {
	  if (err) return notfoundCb();
		if (stats.isFile()) {
			res.sendFile(req.filename, null, stats);
		}
		else if (server.indexFilenames && stats.isDirectory()) {
			server.debug && sys.debug(
				'[oui] trying server.indexFilenames for directory '+req.filename);
			var _indexFilenameIndex = 0;
			var tryNextIndexFilename = function() {
				var name = server.indexFilenames[_indexFilenameIndex++];
				if (!name) {
					sys.debug('indexFilenames END')
					notfoundCb();
					return;
				}
				var filename = path.join(req.filename, name);
				sys.debug('try '+filename)
				fs.stat(filename, function(err, stats2) {
				  if (err || !stats2.isFile())
				    tryNextIndexFilename();
					else
					  res.sendFile(filename, null, stats2);
				});
			}
			tryNextIndexFilename();
		}
		else {
			server.debug && sys.debug('[oui] "'+req.url.pathname+
			  '" is not a readable file.'+' stats => '+JSON.stringify(stats));
			res.sendError(404, 'Unable to handle file',
				sys.inspect(req.url.pathname)+' is not a readable file');
		}
	});
}
exports.staticFileHandler = staticFileHandler

// Shorthand empty handler
exports.noopHandler = function(){ return false; }
