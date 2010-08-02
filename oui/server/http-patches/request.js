// request additions
var sys = require('sys'),
    path = require('path'),
    http = require('http'),
    querystring = require("querystring"),
    url = require("url"),
    authToken = require("../../auth-token");

mixin(http.IncomingMessage.prototype, {
  get session() {
    return this._session;
  },

  set session(session) {
    this._session = session;
    this.authorizedUser = this._session && this._session.data ?
      this._session.data.user : undefined;
  },

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
    var self = this, p;

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

    // Parse content type header
    if ((self.contentType = self.headers['content-type'])) {
      self.contentType = self.contentType.toLowerCase();
      if ((p = self.contentType.indexOf(';')) !== -1) {
        self.contentType = self.contentType.substr(0, p).trim();
        // TODO: parse charset if set, and convert characters -- euhm, how do we
        // do that in nodejs? Yeah, we don't. So probably just respond with 400
        // telling the client it need to send us ASCII or UTF-8).
      }
    }

    // Parse content length header
    self.contentLength = parseInt(self.headers['content-length'] || 0)

    // note: cookies must be parsed before session

    // session
    this.parseSession(function(err){
      if (err) return callback(err); // forward
      // content
      if (self.method === 'POST' || self.method === 'PUT') {
        try {
          self.startParsingRequestEntity();
        } catch (err) {
          return callback(err);
        }
      }
    });
    //done
    callback();
  },

  parseSession: function (callback) {
    var server = this.server, sessions = server.sessions;
    // no sessions?
    if (!sessions)
      return callback();

    // Find session id and auth_* cookies
    var sid = this.params[sessions.sidCookieName]
           || this.cookie(sessions.sidCookieName),
        auth_token = this.params[sessions.authTokenCookieName]
                  || this.cookie(sessions.authTokenCookieName);

    // abort if no session id or auth_token was passed
    if (!sid && !auth_token)
      return callback();

    // Pick up auth_user
    var auth_user = this.params[sessions.authUserCookieName]
                 || this.cookie(sessions.authUserCookieName);

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

  startParsingRequestEntity: function(callback) {
    // todo: handle other kind of content, like file uploads and arbitrary data.
    var server = this.connection.server, res = this.response;
    if (this.contentLength < 1) {
      var e = new Error();
      e.title = 'Length Required';
      e.statusCode = 411;
      res.sendError(e);
    }
    // state: if a request's content was buffered, .content is set.
    if (server.bufferableRequestTypes.indexOf(this.contentType) !== -1) {
      var send413 = function(){
        var e = new Error("Maximum size is "+server.maxRequestBodySize);
        e.title = "Request Entity Too Large";
        e.statusCode = 413;
        res.sendError(e);
      };
      this.content = '';
      if (this.contentLength > 0) {
        var fillcb;
        // limited buffer
        if (typeof server.maxRequestBodySize === 'number') {
          if (this.contentLength > server.maxRequestBodySize) {
            return send413();
          }
          fillcb = function(chunk) {
            var z = this.content.length+chunk.length;
            if (z > server.maxRequestBodySize) {
              // abort
              this.content += chunk.substr(0, server.maxRequestBodySize - z);
              this.removeListener('data', fillcb);
              // clipped the input, which is a good thing
              return send413();
            }
            this.content += chunk;
            if (z === this.contentLength) {
              this.removeListener('data', fillcb);
              // done
            }
          };
        } else {
          // unlimited buffer -- might be dangerous
          fillcb = function(chunk) {
            this.content += chunk;
            if (this.content.length === this.contentLength) {
              this.removeListener('data', fillcb);
              // done
            }
          };
        }
        this.on('data', fillcb);
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
      return this.response.sendError(400, 'Bad JSON',
                                     exc.message+' -- received '+data);
    }
    if (typeof obj !== 'object') {
      return this.response.sendError(400, 'Bad JSON',
                                     'Root object must be an array or a map');
    }
    for (var k in obj) {
      this.params[k] = obj[k];
    }
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

  /**
   * Abort and send 401 unless this.authorizedUser is true (has a session with a
   * valid .data.user).
   *
   * Example:
   *
   *   GET('/some/path, function(p, req){
   *     if (req.abortUnlessAuthorized()) return;
   *     // if we got here, we know for sure this request is authorized
   *   })
   *
   * If validationPredicate is set, it must be a function which will be called
   * to further verify the user associated with an authorized request.
   *
   * Example:
   *
   *   function requireSuperUser(user){
   *     return user.level && user.level > 1;
   *   }
   *   GET('/some/path, function(p, req){
   *     if (req.abortUnlessAuthorized(requireSuperUser)) return;
   *     // if we got here, we know for sure this request is authorized and
   *     // the user has a "level" property which is greater than 1.
   *   })
   *
   * Returns a true value if aborted, or a false value if authorized.
   */
  abortUnlessAuthorized: function(validationPredicate) {
    if (this.authorizedUser) {
      if (typeof validationPredicate === 'function') {
        if (validationPredicate(this.authorizedUser))
          return false;
      } else {
        return false;
      }
    }
    this.response.sendError(401);
    return true;
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
    var bodyless = http.BODYLESS_STATUS_CODES.indexOf(res.status) !== -1;
    if (typeof body === 'string' && !bodyless) {
      res.contentLength = body.length;
      res.writeHead()
      if (res.finished) // writeHead might have finished the response
        return;
      // HEAD responses must not include an entity
      if (!(res.status === 200 && this.method === 'HEAD'))
        res.write(body, res.encoding)
    } else {
      res.contentLength = 0;
      res.writeHead();
    }
    res.end();
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
