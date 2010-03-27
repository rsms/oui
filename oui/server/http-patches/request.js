// request additions
var path = require('path'),
    http = require('http'),
    querystring = require("querystring"),
    url = require("url");

// HTTP statuses without body
const BODYLESS_STATUSES = [204,205,304];

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
			this.content = '';
			if (this.contentLength > 0) {
				// limited buffer
				if (typeof server.maxRequestBodySize === 'number') {
					if (this.contentLength > server.maxRequestBodySize) {
						return send413();
					} else {
						var fillcb;
						fillcb = function(chunk) {
							var z = this.content.length+chunk.length;
							if (z > server.maxRequestBodySize) {
								this.content += chunk.substr(0, server.maxRequestBodySize - z);
								this.removeListener('data', fillcb);
								// clipped the input, which is a good thing
								if (!this.started)
									send413();
							} else {
								this.content += chunk;
							}
						}
						this.addListener('data', fillcb);
					}
				} else {
					// unlimited buffer -- might be dangerous
					this.addListener('data', function(chunk) {this.content += chunk })
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
		} catch (exc) {
			return this.response.sendError(400, 'Bad JSON', exc.message+' -- received '+data);
		}
		if (typeof obj !== 'object')
			return this.response.sendError(400, 'Bad JSON', 'Root object must be a list or a dict');
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
	},
	
	// request.filename
	get filename() {
	  var server = this.connection.server;
  	if (this._filename) return this._filename;
  	if (!server || !server.documentRoot) return this._filename = null;
  	var abspath = path.join(server.documentRoot, this.url.pathname || '');
  	abspath = path.normalize(abspath); // /x/y/../z --> /x/z
  	if (abspath.substr(0, server.documentRoot.length) === server.documentRoot)
  		return this._filename = abspath;
  	return this._filename = null;
	},
	set filename(v) {
	  this._filename = String(v);
	}
})
