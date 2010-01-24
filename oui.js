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
posix = require('posix')
url = require("url")
querystring = require("querystring")
mpath = require('path')

RE_OUTER_DQUOTES = /^"+|"+$/g
RE_COMMA_WS = /,\s*/

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
		// exc handler -- WIP, currently broken
		/*sys.puts('ADD')
		var path = this.path;
		var self = this
		var finish = function() {
			self.finish()
		}
		var eh = function(e) {
			sys.error('error while handling request '+path)
			finish()
		}
		process.addListener('uncaughtException', eh)
		this.addListener('response', function() {
			sys.puts('REMOVE')
			process.removeListener('uncaughtException', eh)
		})*/
	},

	extractFormParams: function(chunk) {
		if (chunk === undefined)
			return;
		var params = querystring.parse(chunk)
		for (var k in params)
			this.params[k] = params[k];
	},

	processHeaders: function() {
		this.cookies = {}
		var self = this
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
	},

	findRoute: function() {
		var rv = routes[(this.method === 'HEAD') ? 'GET' : this.method];
		if (rv === undefined)
			return
		for (var i=0, L = rv.length; i < L; i++){
			var route = rv[i]
			var matches = route.path.exec(this.url.pathname)
			if (matches) {
				if (Array.isArray(matches) && matches.length)
					route.extractParams(this, matches)
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
		if (typeof body === 'string') {
			res.headers.push(['Content-Length', body.length])
			if (res.type !== undefined) {
				var contentType = res.type
				if (res.encoding !== undefined && contentType.indexOf('text/') === 0)
					contentType += '; charset='+res.encoding
				res.headers.push(['Content-Type', contentType])
			}
			res.sendHeader()
			if (res.finished) // sendHeader might have finished the response
				return;
			res.sendBody(body, res.encoding)
		}
		else {
			res.sendHeader()
		}
		res.finish()
	}
})

// request.filename
http.IncomingMessage.prototype.__defineGetter__("filename", function(){
	if (this._filename)
		return this._filename
	server = this.connection.server
	if (typeof server.documentRoot !== 'string')
		return this._filename = null
	abspath = mpath.join(server.documentRoot, this.url.pathname || '')
	abspath = mpath.normalize(abspath) // /x/y/../z --> /x/z
	if (abspath.substr(0, server.documentRoot.length) === server.documentRoot)
		return this._filename = abspath
	return this._filename = null
})


// outgoing msg additions
var _http_OutgoingMessage_finish = http.OutgoingMessage.prototype.finish
process.mixin(http.OutgoingMessage.prototype, {
	finish: function() {
		_http_OutgoingMessage_finish.call(this)
		this.emit("finish")
	}
})

// response additions (inherits from http.OutgoingMessage)
var _http_ServerResponse_sendHeader = http.ServerResponse.prototype.sendHeader
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
		this.type = 'text/html'
		this.allowedOrigin = server.allowedOrigin
	},

	// monkey patch sendHeader so we can set some headers automatically
	sendHeader: function(statusCode, headers) {
		statusCode = statusCode || this.status
		headers = headers || this.headers
		if (this.request.cookies && this.request.cookies.length)
			this.addCookieHeaders(headers)
		if (this.allowedOrigin)
			this.addACLHeaders(headers)
		_http_ServerResponse_sendHeader.apply(this, [statusCode, headers]);
		if (this.request.connection.server.debug) {
			var r = this.request
			var s = '[oui] HTTP/'+r.httpVersionMajor+'.'+r.httpVersionMinor+' '+
				statusCode + ' ' + http.STATUS_CODES[statusCode]
			for (var k in headers)
				s += '\n  '+headers[k][0]+': '+headers[k][1]
			sys.debug(s)
		}
		if (this.request.method === 'HEAD')
			this.finish()
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
				
				var allowMethods = reqHeaders['access-control-allow-methods']
				if (allowMethods)
					headers.push(['Access-Control-Allow-Methods', allowMethods])
				
				// set max-age
				headers.push(['Access-Control-Max-Age', '1728000'])
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
		this.status = parseInt(status) || 500
		e = {title: String(title || 'Internal Server Error')}
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
	
	guard: function(promise, msgprefix) {
		var res = this;
		return promise.addErrback(function(error) {
			msg = '' + (msgprefix || '') + error
			sys.error(msg)
			res.sendError(500, "Error", msg)
		});
	},

	sendObject: function(responseObject) {
		body = this.format(responseObject)
		this.request.sendResponse(body)
	},

	sendError: function(status, title, message, exception) {
		responseObject = this.mkError(status, title, message, exception)
		this.sendObject(responseObject)
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

	sendFile: function(path, contentType, stats, successCb) {
		if (!path || path.constructor !== String)
			throw 'first argument must be a string'
		var promise = new process.Promise();
		// we need to set successCb here as a pre-stat'ed file in combo with
		// if-match*, no I/O is done thus we will emitSuccess before returning
		// control.
		if (typeof successCb === 'function')
			promise.addCallback(successCb)
		var res = this;

		var statsCb = function (s) {
			var etag = stat2etag(s)

			if (contentType)
				res.headers.push(['Content-Type', contentType])
			res.headers.push(['Content-Length', s.size])
			res.headers.push(['Last-Modified', s.mtime.toUTCString()])
			res.headers.push(['ETag', '"'+etag+'"'])

			// not modified?
			var match_status = res.doesMatchRequestPredicates(etag, s.mtime)
			if (match_status) {
				met = res.request.method
				res.status = (met === 'GET' || me === 'HEAD') ? match_status : 412
			}

			// send headers
			res.chunked_encoding = false
			res.sendHeader()
			res.flush()
			if (match_status) {
				res.finish()
				promise.emitSuccess(0)
				return
			}

			// forward
			var enc = 'binary', rz = 16*1024
			posix.open(path, process.O_RDONLY, 0666).addCallback(function(fd) {
				var pos = 0;
				function readChunk () {
					posix.read(fd, rz, pos, enc).addCallback(function(chunk, bytes_read) {
						if (chunk) {
							res.send(chunk, enc)
							pos += bytes_read
							readChunk()
						}
						else { // EOF
							posix.close(fd)
							res.finish()
							promise.emitSuccess(pos)
						}
					}).addErrback(function () {
						// I/O error
						promise.emitError.apply(promise, arguments);
					});
				}
				readChunk();
			}).addErrback(function () {
				// open failed
				promise.emitError.apply(promise, arguments);
			});
		}

		// top level error handler
		promise.addErrback(function (error) {
			sys.error('sendFile failed for "'+path+'"')
			if (!res.finished) {
				// Since response has not begun, send a pretty error message
				res.sendError(500, "I/O error", error)
			}
			else {
				// Response already begun
				res.finish()
			}
		})

		// do we have a prepared stats object?
		if (typeof stats === 'object') {
			statsCb(stats)
		}
		else {
			// perform stat
			posix.stat(path).addCallback(statsCb).addErrback(function (error) {
				sys.puts('[oui] warn: failed to read '+sys.inspect(path)+'. '+error)
				res.sendError(404, 'File not found', 'No file at "'+path+'"')
			});
		}

		return promise;
	}
})


/**
 * Create a new OUI server.
 *
 * Optional properties:
 *
 *   .allowedOrigin = <RegExp> -- Allow origins for cross-site requests (CORS)
 *     Example of allowing specific domains, including localhost:
 *     .allowedOrigin = /^https?:\/\/(?:(?:.+\.|)(?:yourdomain|otherdomain)\.[^\.]+|localhost|.+\.local)$/
 *
 *   .documentRoot = <String> -- Document root for serving static files.
 *
 */
function createServer() {
	server = http.createServer(function(req, res) {
		if (this.debug) {
			dateStarted = (new Date()).getTime()
			res.addListener('finish', function(){
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
			var s = '[oui] '+req.method+' '+req.path
			for (var k in req.headers)
				s += '\n  '+k+': '+req.headers[k]
			sys.debug(s)
		}
		else if (this.verbose) {
			sys.puts('[oui] '+req.method+' '+req.path)
		}

		// solve route
		var route = req.findRoute()
		if (route === undefined) {
			res.status = 404
			req.sendResponse('<h1>'+req.url.pathname+' not found</h1>\n')
			return
		}

		// process headers (cookies etc)
		req.processHeaders()

		// extract url-encoded body parts into req
		if (req.headers['content-type'] === 'application/x-www-form-urlencoded')
			req.addListener('body', req.extractFormParams)
		// todo: handle other kinds of payloads, like file uploads and arbitrary
		//       data.

		// Q: Will request:"complete" be emitted even if there is data still to
		//    be read?

		// take action when request is completely received
		req.addListener('complete', function(){
			server.debug && sys.debug('[oui] request '+req.method+' '+req.path+
				' completed -- creating response')

			// call route, if any
			var responseObject = null
			try {
				// let handler act on req and res, possibly returning body struct
				responseObject = route.handler.apply(server, [req.params, req, res])
			}
			catch(ex) {
				// format exception
				sys.puts('\nError: ' + (ex.stack || ex.message || ex))
				responseObject = res.mkError(null, null, ex)
			}

			// did the handler finish the response or take over responsibility?
			if (res.finished || responseObject === false)
				return

			// format responseObject
			var body = responseObject;
			if (responseObject && responseObject.constructor !== String)
				body = res.format(responseObject)

			// send and mark as finished
			req.sendResponse(body)
		})
	})
	server.debug = exports.debug
	// Server name returned in responses. Please do not change this.
	server.name = 'oui/0.1 node/'+process.version
	server.allowedOrigin = /./; // any
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

function Route(path, handler) {
	this.keys = []
	this.path = path
	this.handler = handler

	if (handler.routes === undefined)
		handler.routes = [this]
	else
		handler.routes.push(this)

	// GET(['/users/([^/]+)/info', 'username'], ..
	if (Array.isArray(path)) {
		re = path.shift()
		if (!re || re.constructor !== RegExp)
			re = new RegExp('^'+re+'$')
		this.path = re
		this.keys = path
	}
	// GET('/users/:username/info', ..
	else if (path.constructor !== RegExp) {
		path = String(path);
		if (path.indexOf(':') === -1) {
			this.path = new FixedStringMatch(path)
			exports.debug && sys.debug(
				'[oui] route '+sys.inspect(path)+' treaded as absolute fixed-string match')
		}
		else {
			var nsrc = path.replace(/:[^/]*/g, '([^/]*)')
			nsrc = '^'+nsrc+'$'
			exports.debug && sys.debug(
				'[oui] route '+sys.inspect(path)+' compiled to '+sys.inspect(nsrc))
			this.path = new RegExp(nsrc, 'i') // case-insensitive by default
			var param_keys = path.match(/:[^/]*/g)
			if (param_keys) for (var i=0; i < param_keys.length; i++)
				this.keys.push(param_keys[i].replace(/^:/, ''))
		}
	}
	// Pure RegExp
	// GET(/^\/users\/(<username>[^\/]+)\/info$/', ..
	// GET(/^\/users\/([^/]+)\/info$/, ..
	else {
		var src = path.source
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
			this.path = new RegExp(nsrc, path.ignoreCase ? 'i' : undefined)
		}
		else {
			this.path = path
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

	_parseSystemTypes: function(paths) {
		promise = new process.Promise()
		var next = function(){
			path = paths.shift()
			if (!path) {
				promise.emitError()
				return
			}
			posix.cat(path).addCallback(function (content) {
				mimetype.parse(content)
				promise.emitSuccess(path)
			}).addErrback(function(){
				next()
			});
		}
		next()
		return promise
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
	 *   mimetype.lookup('text/yaml') => ["yml", "yaml"]
	 */
	lookup: function(extOrType) {
		// lazy importing of system mime types
		if (mimetype.knownfiles !== undefined) {
			try {
				// do this synchronously, since we want to avoid first lookup
				// to yield different results from following lookups
				mimetype._parseSystemTypes(mimetype.knownfiles).wait()
			} catch(e){}
			delete mimetype.knownfiles
		}
		// look up type based on extension, or extension based on type
		extOrType = extOrType.toLowerCase()
		if (extOrType.indexOf('/') === -1) {
			if (extOrType.charAt(0) === '.')
				extOrType = extOrType.substr(1)
			return mimetype.types[extOrType]
		}
		else {
			exts = []
			for (var k in mimetype.types) {
				if (mimetype.types[k] === extOrType)
					exts.push(k)
			}
			return exts
		}
	},
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
	server = this
	notfoundCb = function() {
		res.sendError(404, 'File not found', 'No file at '+req.url.raw, null)
	}

	if (!req.filename) {
		notfoundCb()
		return false
	}

	posix.stat(req.filename).addCallback(function(stats) {
		if (stats.isFile()) {
			type = mimetype.lookup(mpath.extname(req.url.pathname))
				|| 'application/octet-stream'
			res.sendFile(req.filename, type, stats)
		}
		// todo: stats.isDirectory(), list... (enabled should be configurable)
		else {
			server.debug && sys.debug('[oui] "'+req.url.pathname+'" is not a readable file.'+
				' stats => '+JSON.stringify(stats))
			res.sendError(404, 'Unable to handle file',
				sys.inspect(req.url.pathname)+' is not a readable file')
		}
	}).addErrback(notfoundCb)

	return false
}
exports.staticFileHandler = staticFileHandler
