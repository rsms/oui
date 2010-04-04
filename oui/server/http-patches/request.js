// request additions
var sys = require('sys'),
    path = require('path'),
    http = require('http'),
    querystring = require("querystring"),
    url = require("url"),
    authToken = require("../../auth-token");

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

  // parse request
  parse: function(callback) {
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

    // note: cookies must be parsed before session

    // session
    this.parseSession(function(err){
      if (err) return callback(err); // forward

      // content
      self.contentType = self.headers['content-type']
      self.contentLength = parseInt(self.headers['content-length'] || 0)
      if (self.method === 'POST' || self.method === 'PUT') {
        try {
          self.parseRequestEntity();
        } catch (err) {
          return callback(err);
        }
      }

      // done
      callback();
    });
  },

  parseSession: function (callback) {
    var server = this.server, sessions = server.sessions;
    // no sessions?
    if (!sessions)
      return callback();

    // Find session id and auth_* cookies
    var sid = this.cookie(sessions.sidCookieName),
        auth_token = this.cookie(sessions.authTokenCookieName);

    // abort if no session id or auth_token was passed
    if (!sid && !auth_token)
      return callback();

    // Pick up auth_user
    var auth_user = this.cookie(sessions.authUserCookieName);

    // Find session if sid is set
    if (sid) this.session = sessions.find(sid);

    // If there is no session (or the session is not authed) -- and auth_token
    // including auth_user is set -- try to resurrect authenticated user.
    if ((!this.session || !this.session.data.user) && auth_token && auth_user) {
      // We require a user prototype to be able to look up the user
      if (server.userPrototype) {
        sessions.resurrectAuthedUser(this, sid, auth_token, auth_user, callback);
        return;
      } else {
        // As this is an easy mistake to make during early development, let's
        // warn the developer.
        if (server.debug) {
          sys.log('[oui] warning: request/parseSession: client sent auth_token,'+
            ' but server.userPrototype is not configured'+
            ' -- unable to authenticate user');
        }
      }
    }
    callback();
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
    if (val === undefined) {
      val = this.cookies[name];
      return val ? val.value : val;
    }
    options = options || {}
    options.value = val
    options.path = options.path || '/'
    this.cookies[name] = options;
  },

  /** send response */
  sendResponse: function(body) {
    var res = this.response;
    if (res.finished)
      return;
    if (res.status)
      res.status = parseInt(res.status);
    if (res.type !== undefined) {
      var contentType = res.type
      if (res.encoding !== undefined && contentType.indexOf('text/') === 0)
        contentType += '; charset='+res.encoding
      res.setHeader('Content-Type', contentType);
    }
    var bodyless = BODYLESS_STATUSES.indexOf(res.status) !== -1;
    if (typeof body === 'string' && !bodyless) {
      res.contentLength = body.length;
      res.writeHead()
      if (res.finished) // writeHead might have finished the response
        return;
      // HEAD responses must not include an entity
      if (!(res.status === 200 && this.method === 'HEAD'))
        res.write(body, res.encoding)
    } else {
      if (!bodyless) res.contentLength = 0;
      res.writeHead();
    }
    res.close();
  },

  get server() {
    return this.connection.server;
  },

  // request.filename
  get filename() {
    var server = this.server;
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
