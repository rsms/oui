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

RE_OUTER_WHITESPACE = /(^\s+|\s+$)/g
RE_OUTER_DQUOTES = /(^"+|"+$)/g
RE_COMMA_WS = /,\s*/

exports.SERVER_NAME = 'oui/0.1 node/'+process.version
exports.debug = false

var routes = {
	GET: [],
	POST: [],
	PUT: [],
	DELETE: []
}
exports.routes = routes

// utils:

function uridecode(s) {
	return querystring.unescape(s, true)
}

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
				if (p !== -1)
					self.cookie(decodeURIComponent(cookie.substr(0, p).replace(RE_OUTER_WHITESPACE,'')),
						decodeURIComponent(cookie.substr(p+1).replace(RE_OUTER_WHITESPACE,'')), { preset: true })
			})
		}
	},

	findRoute: function() {
		var rv = routes[(this.method === 'HEAD') ? 'GET' : this.method];
		if (rv === undefined)
			return
		for (var i=0, L = rv.length; i < L; i++){
			var route = rv[i]
			var matches = this.url.pathname.match(route.path)
			if (matches) {
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

	appendCookieHeaders: function(headers) {
		var ret, name, options
		for (name in this.cookies) {
			if (this.cookies[name].preset)
				continue // don't re-set pre-set cookies yo
			options = this.cookies[name]
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


// response additions
var _sendHeader = http.ServerResponse.prototype.sendHeader
process.mixin(http.ServerResponse.prototype, {
	prepare: function() {
		this.headers = [
			['Server', exports.SERVER_NAME],
			['Date', (new Date()).toUTCString()]
		]
		this.status = 200
		this.encoding = 'utf-8'
		this.type = 'text/html'
	},

	// monkey patch sendHeader so we can set some headers automatically
	sendHeader: function(statusCode, headers) {
		statusCode = statusCode || this.status
		headers = headers || this.headers
		this.request.appendCookieHeaders(headers)
		_sendHeader.apply(this, [statusCode, headers]);
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

	format: function(obj) {
		if (obj === undefined)
			return null;
		// todo: content-negotiation or something else (strict) -- just something, please
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
		this.status = (status && typeof status === 'number') ? status : 500
		e = {title: (title && title.constructor === String) ? title : 'Internal Server Error'}
		if (exception) {
			if (message) e.message = message ? String(message) + exception.message : String(exception.message)
			if (exception.stack) e.stack = exception.stack.split(/[\r\n]+ +/m)
		}
		else if (message) {
			e.message = String(message)
		}
		return {error:e};
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
		// if-match*, no I/O is done thus we will emitSuccess before returning control.
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

			// send file
			encoding = 'binary'
			readsize = 16*1024
			posix.open(path, process.O_RDONLY, 0666).addCallback(function (fd) {
				var pos = 0;
				function readChunk () {
					posix.read(fd, readsize, pos, encoding).addCallback(function (chunk, bytes_read) {
						if (chunk) {
							res.send(chunk, encoding)
							pos += bytes_read
							readChunk()
						}
						else { // EOF
							posix.close(fd)
							res.finish()
							promise.emitSuccess(pos)
						}
					}).addErrback(function () {
						promise.emitError.apply(promise, arguments);
						// todo: move the res.finish and co up here + impl the two todos below this line
					});
				}
				readChunk();
			}).addErrback(function () {
				promise.emitError.apply(promise, arguments);
				// todo: send 401 if not readable or 500
			});
		}

		// top level error handler
		promise.addErrback(function () {
			sys.error('sendFile failed for "'+path+'"')
			res.closeOnFinish = true
			res.finish()
		})

		// do we have a stats object?
		if (typeof stats === 'object') {
			statsCb(stats)
		}
		else {
			posix.stat(path).addCallback(statsCb).addErrback(function () {
				res.sendError(404, 'File not found', 'No file at "'+path+'"')
			});
		}

		return promise;
	}
})


function createServer() {
	server = http.createServer(function(req, res) {
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
			req.sendResponse('<h1>'+req.uri.path+' not found</h1>\n')
			return
		}

		// process headers (cookies etc)
		req.processHeaders()

		// extract url-encoded body parts into req
		if (req.headers['content-type'] === 'application/x-www-form-urlencoded')
			req.addListener('body', req.extractFormParams)
		// todo: handle other kinds of payloads, like file uploads and arbitrary data.
		//			 Q: Will "complete" be emitted even if there is data still to be read?

		// take action when request is completely received
		req.addListener('complete', function(){
			server.debug && sys.debug('[oui] request '+req.method+' '+req.path+' completed -- creating response')

			// call route, if any
			var responseObject = null
			try {
				// let handler act on req and res, possibly returning body struct
				responseObject = route.handler.apply(server, [req.params, req, res])
			}
			catch(ex) {
				// format exception
				sys.puts('\n' + (ex.stack || ex.message))
				responseObject = res.mkError(null, null, ex)
			}

			// did the handler finish the response or take over responsibility?
			if (res.finished || responseObject === false)
				return;

			// format responseObject
			var body = responseObject;
			if (responseObject && responseObject.constructor !== String)
				body = res.format(responseObject)

			// send and mark as finished
			req.sendResponse(body)
		})
	})
	server.debug = exports.debug
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
function Route(path, handler) {
	this.keys = []
	this.path = path
	this.handler = handler

	if (handler.routes === undefined)
		handler.routes = [this]
	else
		handler.routes.push(this)

	// GET(['/users/([^/]+)/info', 'username'], ..
	if (path.constructor === Array) {
		var pat = path.shift()
		this.path = (!path || pat.constructor !== RegExp) ? new RegExp('^'+pat+'$') : pat
		this.keys = path
	}
	// GET('/users/:username/info', ..
	else if (path.constructor !== RegExp) {
		var nsrc = ('^'+path.replace(/:[^/]*/g, '([^/]*)')+'$')
		exports.debug && sys.debug('[oui] route '+sys.inspect(path)+' compiled to '+sys.inspect(nsrc))
		this.path = new RegExp(nsrc)
		// this.path = this.path.compile()
		var param_keys = path.match(/:[^/]*/g)
		if (param_keys) for (var i=0; i < param_keys.length; i++)
			this.keys.push(param_keys[i].replace(/^:/, ''))
	}
	// Pure RegExp
	// GET(/\/users\/(<username>[^\/]+)\/info/', ..
	// GET(/\/users\/([^/]+)\/info/, ..
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
			path = new RegExp(nsrc, path.ignoreCase ? 'i' : undefined)
		}
		this.path = path
	}
}
exports.Route = Route

Route.prototype.extractParams = function(req, matches) {
	var i, l, captures = []
	matches.shift()
	for (i=0, l = this.keys.length; i < l; i++)
		req.params[this.keys[i]] = uridecode(matches.shift())
	for (i=0, l = matches.length; i < l; i++)
		captures[i] = uridecode(matches[i])
	req.params.captures = captures
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

/** Expose handler on path for multiple methods */
exports.expose = function(methods, path, handler){
	for (var method in methods)
		GLOBAL[method] && GLOBAL[method](path, handler)
	return handler
}


/** Handler which takes care of requests for files */
function staticFileHandler(params, req, res) {
	server = this
	if (typeof server.documentRoot !== 'string')
		throw new Error('server.documentRoot is not set or is not a string')
	relpath = req.url.pathname ? req.url.pathname.replace(/([\.]{2,}|^\/+|\/+$)/, '') : ''
	abspath = mpath.join(server.documentRoot, relpath)

	posix.stat(abspath).addCallback(function(stats) {
		if (stats.isFile()) {
			type = mimetype.lookup(mpath.extname(relpath))
			if (!type)
				type = 'application/octet-stream'
			res.sendFile(abspath, type, stats)
		}
		// todo: stats.isDirectory(), list...
		else {
			server.debug && sys.debug('[oui] "'+relpath+'" is not a readable file. stats => '+JSON.stringify(stats))
			res.sendError(404, 'Unable to handle file', '"'+relpath+'" is not a readable file')
		}
	}).addErrback(function() {
		res.sendError(404, 'File not found', 'No file at '+req.url.raw, null)
	})

	return false
}
exports.staticFileHandler = staticFileHandler
