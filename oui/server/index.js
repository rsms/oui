var http = require('http'),
    sys = require('sys'),
    fs = require('fs'),
    url = require("url"),
    querystring = require("querystring"),
    path = require('path'),
    
    mimetypes = require('../mimetypes'),
    Routes = require('./routes').Routes,
    oui = require('../'),
    sessions = require('./session'),
    handlers = exports.handlers = require('./handlers');

const RE_OUTER_DQUOTES = /^"+|"+$/g,
      RE_COMMA_WS = /,\s*/,
      BODYLESS_STATUSES = [204,205,304]; // HTTP statuses without body

// Enable debug mode (verbose async output to stdout)
exports.debug = false;

// utils
function stat2etag(s) {
	return s.mtime.getTime().toString(36)+s.ino.toString(36)+s.mode.toString(36)
}

// request additions
mixin(http.IncomingMessage.prototype, {
	prepare: function() {
		this.path = this.url;
		this.url = url.parse(this.url, true);
		this.params = {};
		// copy, not assign, query -> params
		var m = this.url.query;
		for (var k in m) this.params[k] = m[k];
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
	  return this.route || (this.route = this.connection.server.routes.solve(this));
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
	if (this._filename) return this._filename;
	server = this.connection.server
	if (!server.documentRoot) return this._filename = null;
	abspath = path.join(server.documentRoot, this.url.pathname || '');
	abspath = path.normalize(abspath); // /x/y/../z --> /x/z
	if (abspath.substr(0, server.documentRoot.length) === server.documentRoot)
		return this._filename = abspath;
	return this._filename = null;
});
http.IncomingMessage.prototype.__defineSetter__("filename", function(v) {
	this._filename = String(v);
});


// outgoing msg additions
var _http_OutgoingMessage_close = http.OutgoingMessage.prototype.close
mixin(http.OutgoingMessage.prototype, {
	close: function() {
		_http_OutgoingMessage_close.call(this);
		this.emit("close");
	}
})

// response additions (inherits from http.OutgoingMessage)
var _http_ServerResponse_writeHead = http.ServerResponse.prototype.writeHead
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
				statusCode + ' ' + http.STATUS_CODES[statusCode];
			for (var i=0,t; t = headers[i];i++) s += '\n  '+t[0]+': '+t[1];
			sys.log(s);
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
		this.request.connection.server.debug && sys.log(
			'[oui] sendError '+sys.inspect(obj.error));
		this.sendObject(obj);
	},

	doesMatchRequestPredicates: function(etag, mtime) {
		if (etag) {
			var nomatch = this.request.headers['if-none-match']
			if (nomatch !== undefined) {
				if (nomatch === '*') return 304;
				v = nomatch.split(RE_COMMA_WS);
				for (var i in v) {
				  v = v[i]; if (v && v.replace) {
  					t = v.replace(RE_OUTER_DQUOTES,'');
  					if (t === etag) return 304;
  				}
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
			sys.log('[oui] response finished (total time spent: '+ms+' ms)')
		})
	}
	req.response = res
	res.request = req

	req.prepare()
	res.prepare()

	// log request
	if (this.debug) {
		var s = '[oui] <-- '+req.method+' '+req.path;
		for (var k in req.headers)
			s += '\n  '+k+': '+req.headers[k]
		sys.log(s);
	}
	else if (this.verbose) {
		sys.log('[oui] '+req.method+' '+req.path);
	}

	try {
		// solve route
		if (!req.solveRoute())
			return res.sendError(404, req.path+' not found');

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

// ----------------------------------------------------------------------------
// Basic user prototype

exports.BasicUser = function(username){
  this.username = username;
  this.pass_hash = '';
  this.email = '';
}

// The following methods MUST be implemeted for user objects:

// Find a user by username
exports.BasicUser.find = function(username, callback) {
	callback(null, exports.BasicUser.map[username]);
}
// Generate a minimal representation to be stored persitently in the users session
exports.BasicUser.prototype.sessionObject = function() {
  return {username: this.username, email: this.email};
}

/* Example extension:
exports.BasicUser.map = {};
exports.BasicUser.create = function(properties, callback) {
  var user = new exports.BasicUser();
  mixin(user, properties);
  if (user.username) exports.BasicUser.map[user.username] = user;
	callback(null, user);
}
exports.BasicUser.remove = function(username, callback) {
  if (exports.BasicUser.map[username]) {
    delete exports.BasicUser.map[username];
    callback(null, true);
  } else {
    callback(null, false);
  }
}*/

// ----------------------------------------------------------------------------

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
exports.createServer = function() {
	var server = http.createServer(requestHandler);

	// Inherit debug property from module-wide property
	server.debug = exports.debug;
	
	// URL routing
	server.routes = new Routes();
	server.on = function(methods, path, priority, handler) {
	  methods = Array.isArray(methods) ? methods : [methods];
	  for (var i=0,L=methods.length;i<L;i++) {
	    var method = methods[i];
	    this.routes[method](path, priority, handler);
	  }
	  return this;
	};
	
	// Sessions
	server.sessions = new sessions.MemoryStore();

	// Server name returned in responses. Please do not change this.
	server.name = 'oui/'+oui.version+' node/'+process.version;

	// Allow any origin by default
	server.allowedOrigin = /./;

	// File to look for when requesting a directory
	server.indexFilenames = ['index.html'];

	// List of request content types we will buffer before parsing
	server.bufferableRequestTypes = [
		'application/x-www-form-urlencoded',
		'application/json',
	];

	// Limit the size of a request body
	server.maxRequestBodySize = 1024*1024*2; // 2 MB
	
	// secret key used for nonce creation. you should change this.
	server.authNonceHMACKey = __filename;
	
	// User prototype
	server.userPrototype = exports.BasicUser;
	
	// Standard handlers
	server.enableStandardHandlers = function(sessionPrefix) {
	  sessionPrefix = sessionPrefix || '/session';
    this.on('GET', sessionPrefix+'/establish', handlers.session.establish);
    this.on('GET', sessionPrefix+'/sign-in', handlers.session.signIn);
    this.on('GET', sessionPrefix+'/sign-out', handlers.session.signOut);
    // Serve static files & pass any OPTIONS request to allow XSS lookup:
    this.on('GET', /^.+/, 0, handlers.static);
    this.on('OPTIONS', /^.*/ , 0, handlers.noop);
  }

	return server;
}

/** Start a server listening on [port[, addr]] */
exports.start = function(options) {
  var opt = {
    port: 80,
    //addr
    // any other property is assigned to the server object
  };
  if (typeof options==='object') mixin(opt, options);
	server = exports.createServer();
	const skipKeys = {'port':1, 'addr':1, 'verbose':1};
	Object.keys(opt).forEach(function(k){ if (!skipKeys[k]) server[k] = opt[k]; });
	server.verbose = (opt.verbose === undefined || opt.verbose) ? true : false;
	server.listen(opt.port, opt.addr);
	server.verbose && sys.log('[oui] listening on '+(opt.addr || '*')+':'+opt.port);
	return server;
}
