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

DOCUMENT_ROOT = '/dev/null'

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

// request and response mixins:

var request_mixins = {
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
					self.cookie(decodeURIComponent(cookie.substr(0, p)),
						decodeURIComponent(cookie.substr(p+1)), { preset: true })
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
}


var response_mixins = {
	prepare: function() {
		this.headers = [
			['Server', SERVER_NAME],
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
		http.ServerResponse.prototype.sendHeader.apply(this, [statusCode, headers]);
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
	
	sendError: function(status, title, message, exception) {
		responseObject = this.mkError(status, title, message, exception)
		body = this.format(responseObject)
		this.request.sendResponse(body)
	},
	
	sendFile: function(path, contentType, stats) {
		if (!path || path.constructor !== String)
			throw 'first argument must be a string'
		var promise = new process.Promise();
		var res = this;
		var statsCb = function (s) {
			if (contentType)
				res.headers.push(['Content-Type', contentType])
			res.headers.push(['Content-Length', s.size])
			res.headers.push(['Last-Modified', s.mtime.toUTCString()])
			res.headers.push(['ETag', '"'+stat2etag(s)+'"'])
			
			// todo: check request headers and reply with 304 Not Modified if appropriate
			
			// send headers
			res.chunked_encoding = false
			res.sendHeader()
			res.flush()
			
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
}


function outerExceptionHandler(e) {
	sys.puts(e)
}


var SERVER_NAME = 'oui/0.1 node/'+process.version

function createServer(silent) {
	return http.createServer(function(req, res) {
		process.mixin(req, request_mixins)
		process.mixin(res, response_mixins)
		
		req.response = res
		res.request = req
		
		req.prepare()
		res.prepare()
		
		// log request
		silent || sys.puts(req.method+' '+req.path)
		
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
			// call route, if any
			var responseObject = null
			try {
				// let handler act on req and res, possibly returning body struct
				responseObject = route.handler(req.params, req, res)
			}
			catch(ex) {
				// format exception
				sys.error('\n' + (ex.stack || ex.message))
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
}

/** Start a server listening on [port[, addr]] */
function start(port, addr, silent) {
	server = createServer(silent)
	port = port || 80
	server.listen(port, addr)
	silent || sys.puts('listening on '+(addr || '*')+':'+port)
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
	
	if (path.constructor !== RegExp) {
		this.path = new RegExp(('^'+path+'$').replace(/:[^/]*/g, '([^/]*)'))
		// this.path = this.path.compile()
		var param_keys = path.match(/:[^/]*/g)
		if (param_keys) for (var i=0; i < param_keys.length; i++)
			this.keys.push(param_keys[i].replace(/^:/, ''))
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
	relpath = req.url.pathname ? req.url.pathname.replace(/([\.]{2,}|^\/+|\/+$)/, '') : ''
	abspath = mpath.join(oui.DOCUMENT_ROOT, relpath)
	
	posix.stat(abspath).addCallback(function(stats) {
		if (stats.isFile()) {
			type = mimetype.lookup(mpath.extname(relpath))
			if (!type)
				type = 'application/octet-stream'
			res.sendFile(abspath, type, stats)
		}
		// todo: stats.isDirectory(), list...
		else {
			DEBUG && sys.puts('"'+relpath+'" is not a readable file. stats => '+JSON.stringify(stats))
			res.sendError(404, 'Unable to handle file', '"'+relpath+'" is not a readable file')
		}
	}).addErrback(function() {
		res.sendError(404, 'File not found', 'No file at '+req.url.raw, null)
	})
	
	return false
}
exports.staticFileHandler = staticFileHandler
