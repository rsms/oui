var fs = require('fs'),
    sys = require('sys'),
    path = require('path');

// Does nothing
exports.noop = function(){ return false; }

// Takes care of requests for files
exports.static = function(params, req, res) {
  var server = this;
  var notfoundCb = function() {
    server.debug && sys.log('[oui] "'+req.path+'" does not exist');
    res.sendError(404, 'File not found', 'Nothing found at '+req.path, null);
  }
  if (!req.filename) return notfoundCb();
  fs.stat(req.filename, function(err, stats) {
    if (err) return notfoundCb();
    if (stats.isFile()) {
      res.sendFile(req.filename, null, stats);
    } else if (server.indexFilenames && stats.isDirectory()) {
      server.debug && sys.log(
        '[oui] trying server.indexFilenames for directory '+req.filename);
      var _indexFilenameIndex = 0;
      // todo: cache known paths
      var tryNextIndexFilename = function() {
        var name = server.indexFilenames[_indexFilenameIndex++];
        if (!name) {
          notfoundCb();
          return;
        }
        var filename = path.join(req.filename, name);
        //sys.log('try '+filename);
        fs.stat(filename, function(err, stats2) {
          if (err || !stats2.isFile()) tryNextIndexFilename();
          else res.sendFile(filename, null, stats2);
        });
      }
      tryNextIndexFilename();
    } else {
      server.debug && sys.log('[oui] "'+req.url.pathname+
        '" is not a readable file.'+' stats => '+JSON.stringify(stats));
      res.sendError(404, 'Unable to handle file',
        sys.inspect(req.url.pathname)+' is not a readable file');
    }
  });
}

// -----------------------------------------------------------------------------
// Session

var hash = require('../hash'),
    authToken = require('../auth-token');

exports.session = {
  establish: function(params, req, res) {
    var self = this,
        session = this.sessions.findOrCreate(params.sid || req.cookie('sid')),
        responseObj = {
          sid: session.id,
          user: session.data.user,
        };
    res.setHeader('Cache-Control', 'no-cache');
    // if the session is not yet auth, and there was a auth_token in the request,
    // check the auth:
    if (!session.data.user) {
      var auth_ttl = 30*24*60*60; // todo: move somewhere
      var auth_token = req.cookie('auth_token');
      var auth_user = req.cookie('auth_user');
      if (auth_token && auth_user) {
        this.userPrototype.find(auth_user, function(err, user){
          if (err) return res.sendError(err);
          if (user && user.passhash
            && authToken.validate(self.authSecret, user.passhash, auth_token, auth_ttl))
          {
            // Yay. user auth resurrected
            // todo: consider refreshing the auth_token here. Simply 
            //       authToken.generate() and return that as auth_token
            //       (client lib will handle updating).
            session.data.user = user;
            responseObj.user = user;
            if (self.debug) {
              sys.log('[oui] session/establish: resurrected authenticated user '+
                user.canonicalUsername+' from auth_token.');
            }
          }
          return res.sendObject(responseObj);
        });
        return;
      }
    }
    return responseObj;
  },

  // Sanity checks and preparation before a GET or POST to signIn
  _preSignIn: function(params, req, res) {
    // Sanity check
    if (!this.userPrototype) {
      sys.log('[oui] session/signIn: ERROR: server.userPrototype is undefined, '+
        'but is required by session handlers');
      res.sendError(500, 'Internal error');
      return true;
    }
    // 400 bad request if username is missing
    if (!params.username) {
      res.sendError(400, 'Missing username parameter');
      return true;
    }
    // no caching please
    res.setHeader('Cache-Control', 'no-cache');
  },

  // Response checks and preparation after a GET or POST to signIn
  _postSignInFindUser: function(params, req, res, err, user, session) {
    // Error?
    if (err) {
      if (this.debug)
        sys.log('[oui] session/signIn: failed to find user: '+(err.stack || err));
      res.sendError(err);
      return true;
    }
    // Bad user object?
    if (!user || typeof user !== 'object') {
      if (this.debug)
        sys.log('[oui] session/signIn: no such user '+params.username);
      res.sendError(401, 'Bad credentials');
      return true;
    }
    // Assign a new authToken to the users session
    if (session && req.method === 'POST' && user.passhash)
      session.data.authToken = authToken.generate(this.authSecret, user.passhash);
    // Custom authentication implementation?
    if (typeof user.handleAuthRequest === 'function') {
      // returns true if it took over responsibility
      return user.handleAuthRequest(params, req, res, session);
    }
  },

  // get challenge
  GET_signIn: function(params, req, res) {
    if (!this.authSecret)
      throw new Error('server.authSecret is not set');
    var self = this, session = this.sessions.findOrCreate(params.sid || req.cookie('sid'));
    if (exports.session._preSignIn.call(this, params, req, res)) return;
    // Clear any "auth_nonce" in session
    if (session.data.auth_nonce) delete session.data.auth_nonce;
    // Find user
    this.userPrototype.find(params.username, function(err, user){
      if (exports.session._postSignInFindUser.call(
        self, params, req, res, err, user, session)) return;
      // Create and respond with challenge
      var nonce = hash.sha1_hmac(self.authSecret,
        Date.currentUTCTimestamp.toString(36)+':'+
        Math.round(Math.random()*616892811).toString(36));
      session.data.auth_nonce = nonce;
      // include username, as it's used to calculate passhash and might be
      // MixEDcAse (depending on the application, usernames might be looked up
      // in a case-insensitive manner).
      res.sendObject({
        nonce: nonce,
        username: user.username,
        sid: session.id
      });
    });
  },

  // post response to previous challenge
  POST_signIn: function(params, req, res) {
    // todo: time-limit the auth_nonce
    if (exports.session._preSignIn.call(this, params, req, res)) return;
    var self = this,
        session = this.sessions.findOrCreate(params.sid || req.cookie('sid')),
        success = false;
    // find user
    this.userPrototype.find(params.username, function(err, user){
      // custom handler or error taken care of?
      if (exports.session._postSignInFindUser.call(
        self, params, req, res, err, user, session)) return;

      // If "auth_nonce" isn't set in session, the client should have performed a GET
      if (!session.data.auth_nonce)
        return res.sendError(400, 'uninitialized_session');

      // Keep a local ref of nonce and remove it from the session.
      var nonce = session.data.auth_nonce;
      delete session.data.auth_nonce;

      // Only proceed if the request contains "auth_response"
      if (params.auth_response) {
        if (err) return res.sendError(err);
        if (user) {
          var success = false;
          // Check auth response
          if (typeof user.checkAuthResponse === 'function') {
            // Custom control implemented by user object
            success = user.checkAuthResponse(nonce, params.auth_response);
            if (success && success !== true) {
              // strictness reduces chance of unintentional mis-auth
              sys.log('[oui] session/signIn: ERROR: user.checkAuthResponse '+
                'returned a true value which is not the constant "true"'+
                ' -- aborting auth attempt');
              res.sendError(500, 'Internal error -- check server log for details');
              return;
            }
          } else if (user.passhash) {
            // Standard control:
            //   passhash     = BASE16( SHA1( username ":" password ) )    TODO: move -- does not belong here
            //   auth_response = BASE16( SHA1_HMAC( auth_nonce, passhash ) )
            success = (hash.sha1_hmac(nonce, user.passhash) === params.auth_response);
          }
          if (success) {
            if (self.debug)
              sys.log('[oui] session/signIn: successfully authenticated user '+params.username);
            session.data.user = user.sessionRepresentation;
            var finalize = function(err){
              if (err) return res.sendError(err);
              var msg = {user: user.authedRepresentation};
              if (session.data.authToken)
                msg.auth_token = session.data.authToken;
              res.sendObject(msg);
            };
            if (typeof user.handleAuthSuccessResponse === 'function') {
              if (user.handleAuthSuccessResponse(params, req, res, session, finalize))
                return;
            }
            return finalize();
          } else if (self.debug) {
            sys.log('[oui] session/signIn: bad credentials for user '+params.username);
          }
        }
      }

      // If we got here, success == false
      res.sendError(401, 'Bad credentials');
    }); //< User.find
  },

  signOut: function(params, req, res) {
    var sid = params.sid || req.cookie('sid');
    if (!sid)
      return res.sendError(400, 'Missing sid in request');
    res.setHeader('Cache-Control', 'no-cache');
    var session = this.sessions.find(sid);
    if (session && session.data.user)
      delete session.data.user;
    return '';
  }
};
