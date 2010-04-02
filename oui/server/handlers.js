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

var hash = require('../hash');

exports.session = {
  establish: function(params, req, res) {
    var sessions = this.sessions,
        session = sessions.findOrCreate(params.sid);
    res.setHeader('Cache-Control', 'no-cache');
    return {
      sid: session.id,
      user: session.data.user,
    }
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
    // Custom authentication implementation?
    if (typeof user.handleAuthRequest === 'function') {
      // returns true if it took over responsibility
      return user.handleAuthRequest(params, req, res, session);
    }
  },

  // get challenge
  GET_signIn: function(params, req, res) {
    var self = this, session = this.sessions.findOrCreate(params.sid);
    if (exports.session._preSignIn.call(this, params, req, res)) return;
    // Clear any "auth_nonce" in session
    if (session.data.auth_nonce) delete session.data.auth_nonce;
    // Find user
    server.userPrototype.find(params.username, function(err, user){
      if (exports.session._postSignInFindUser.call(self, params, req, res, err, user, session)) return;
      // Create and respond with challenge
      var nonce = hash.sha1_hmac(server.authNonceHMACKey || '?', String(new Date())); // todo
      session.data.auth_nonce = nonce;
      // include username, as it's used to calculate passhash and might be
      // MixEDcAse (depending on the application, usernames might be looked up
      // in a case-insensitive manner).
      res.sendObject({ nonce: nonce, username: user.username });
    });
  },

  // post response to previous challenge
  POST_signIn: function(params, req, res) {
    // todo: time-limit the auth_nonce
    if (exports.session._preSignIn.call(this, params, req, res)) return;
    var self = this,
        session = this.sessions.findOrCreate(params.sid),
        success = false;
    // find user
    server.userPrototype.find(params.username, function(err, user){
      if (exports.session._postSignInFindUser.call(self, params, req, res, err, user, session)) return;

      // If "auth_nonce" isn't set in session, the client should have performed a GET
      if (!session.data.auth_nonce)
        return res.sendError(400, 'Bad request: uninitialized session');

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
            session.data.user = user.sessionRepresentation;
            res.sendObject({user: user.authedRepresentation});
            if (server.debug)
              sys.log('[oui] session/signIn: successfully authenticated user '+params.username);
            return;
          } else if (server.debug) {
            sys.log('[oui] session/signIn: bad credentials for user '+params.username);
          }
        }
      }

      // If we got here, success == false
      res.sendError(401, 'Bad credentials');
    }); //< User.find
  },

  signOut: function(params, req, res) {
    if (!params.sid)
      return res.sendError(400, 'Missing sid in request');
    res.setHeader('Cache-Control', 'no-cache');
    var session = this.sessions.find(params.sid);
    if (session && session.data.user)
      delete session.data.user;
    return '';
  }
};
