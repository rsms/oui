/**
 * Represents a client-server session.
 *
 * Events:
 *  - open () -- when the session is open
 *  - userchange (previousUser) -- when authenticated user has changed
 *
 * Session([[app, ]id])
 */
exports.Session = function(app, id) {
  if (typeof app === 'string') {
    id = app;
    app = undefined;
  }
  this.app = app;
  this.ttl = 30*24*60*60; // 30 days
  this.id = id || oui.cookie.get('sid'); // todo: make cookie name configurable

  if (console.debug) {
    if (!id && this.id)
      console.debug('[oui] session: loaded session id =>', this.id);
    this.on('userchange', function(ev, prevUser){
      console.debug('[oui] session <userchange>', prevUser, '-->', this.user);
    });
  }
};

oui.mixin(exports.Session.prototype, oui.EventEmitter.prototype, {

  // Execute a remote function which is idempotent.
  get: function(remoteName, params, callback) {
    return this.exec('GET', remoteName, params, callback);
  },

  // Execute a remote function which might alter the remote state.
  post: function(remoteName, params, callback) {
    return this.exec('POST', remoteName, params, callback);
  },

  // ( String method, String remoteName, [Object params,]
  //   [function callback(Error err, Object result, Response response)] )
  exec: function(method, remoteName, params, callback) {
    if (typeof params === 'function') { callback = params; params = undefined; }
    var options = {}; // TODO: expose as set:able in exec function call
    if (typeof params !== 'object')
      params = {};

    // TODO X activate these if the host env does not fully support xhr.withCredentials
    /*if (this.id && !params.sid) params.sid = this.id;
    if (this.authToken && !params.auth_token) params.auth_token = this.authToken;
    if (this.user && !params.auth_user) params.auth_user = this.user.canonicalUsername;*/

    var self = this, action = function(backend, cl){
      var url = backend.url()+'/'+remoteName;
      console.log('url =>',url);
      oui.http.request(method, url, params, options, cl);
    };
    this.emit('exec-send', remoteName);
    oui.backend.retry(action, function(err, response) {
      self.emit('exec-recv', remoteName);
      if (callback) {
        callback(err, response.data, response);
        // TODO X activate these if the host env does not fully support xhr.withCredentials
        // if not err:
        /*var d = response.data;
        if (typeof d === 'object') {
          if (d.sid) self.setId(d.sid);
          if (d.auth_token) self.setAuthToken(d.auth_token);
        }*/
      }
    });
    return this;
  },

  setId: function(sid) {
    if (this.id === sid) return;
    var prevSid = this.id;
    this.id = sid;
    if (sid) {
      oui.cookie.set('sid', sid, this.ttl); // todo: make cookie name configurable
    } else {
      oui.cookie.clear('sid');
    }
    this.emit('id', prevSid);
  },

  setAuthToken: function(token) {
    if (this.authToken === token) return;
    var prevToken = this.authToken;
    this.authToken = token;
    if (token) {
      oui.cookie.set('auth_token', token, Date.distantFuture);
    } else {
      oui.cookie.clear('auth_token');
    }
    this.emit('auth_token', prevToken);
  },

  setUser: function(user) {
    if (user === this.user) {
      // always emit userchange
      this.emit('userchange', user);
      return;
    }
    var prevUser = this.user, username;
    this.user = user || undefined; // object if authed
    if (this.user && (username = this.user.canonicalUsername || this.user.username)) {
      oui.cookie.set('auth_user', username, Date.distantFuture);
    } else {
      oui.cookie.clear('auth_user');
    }
    this.emit('userchange', prevUser);
  },

  // Open the session
  establish: function(callback) {
    var self = this;
    var onerr = function(err){
      self.app.emitError({
        message: 'Connection error',
        description: 'Failed to connect to the dropular service. Please try again in a few minutes.',
        data: {backends: oui.backend.backends, error: err}
      }, self, err);
      if (callback) callback(err);
    };
    this.get('session/establish', function(err, result) {
      if (err) return onerr(err);
      self.setId(result.sid);
      self.setUser(result.user || undefined);
      console.log('[oui] session/open: established', self.id, result);
      self.emit('open');
      return callback && callback();
    });
  },

  // Sign out the current user, if any
  signOut: function(callback) {
    if (!this.user) return callback && callback();
    console.log('[oui] session/signOut: '+this.user.username);
    var self = this;
    this.get('session/sign-out', function(err, result){
      if (err) {
        self.app.emitError('Sign out failed', self, err);
        return callback && callback(err);
      }
      console.log('[oui] session/signIn: successfully signed out '+
        self.user.username);
      self.setUser();
      if (callback) callback();
    });
  },

  // Sign in <username> authenticated with <password>
  signIn: function(username, password, callback) {
    // passhash     = BASE16( SHA1( username ":" password ) )
    // auth_response = BASE16( SHA1_HMAC( auth_nonce, passhash ) )
    var self = this, cb = function(err, result) {
      if (!err) return callback && callback(null, result);
      if (self.app) self.app.emitError({
        message: 'Sing in failed',
        description: 'Failed to sign in user "'+username+'"',
        data: {username: username, result: result}
      }, self, err);
      if (callback) callback(err, result);
    };
    console.log('[oui] session/signIn: signing in '+username);
    this.get('session/sign-in', {username: username}, function(err, result) {
      if (err) return cb(err, result);
      self._handleSignInChallenge(result, username, password, cb);
    });
  },

  // Special sign-in handlers used when server responds with {"expect": <key>}
  // during sign-in. Replaces the role of `_handleSignInChallenge`.
  specialSignInHandlers: {
    // Universal "legacy authentication" handler which will pass the password in
    // clear text.
    //
    // WARNING! -- This handler sends the password in clear text! Make sure to
    //             either remove this or to send the request in a secure
    //             connection. A rouge server could otherwise request the
    //             password and get it.
    //
    legacy_auth: function(result, username, password, callback) {
      var params = {
        legacy_auth: true,
        username: username,
        password: password
      };
      this._requestSignIn(params, callback);
      // todo: cache new passhash to be able to seamlessly switch backends.
    }
  },

  _requestSignIn: function(params, callback) {
    var self = this;
    console.log('[oui] (session/sign-in) <-- ', params);
    this.post('session/sign-in', params, function(err, result) {
      console.log('[oui] (session/sign-in) --> ', err, result);
      if (callback) callback(err, result);
      if (!err && result.user) {
        if (result.auth_token)
          self.setAuthToken(result.auth_token);
        if (result.sid)
          self.setId(result.sid);
        self.setSignedInUser(result.user);
      }
    });
  },

  _handleSignInChallenge: function(result, username, password, callback) {
    var self = this;
    console.log('[oui] session/signIn: got response from sign-in:', result);
    if (result.expect) {
      console.log('[oui] session/signIn: server expects "'+result.expect+'"');
      var handler = this.specialSignInHandlers[result.expect];
      if (handler && typeof handler === 'function') {
        return handler.call(this, result, username, password, callback);
      } else {
        return callback(new Error('Unable to satisfy server expectation "'+
          result.expect+'"'), result);
      }
    }
    if (!result.username || !result.nonce) {
      return callback(new Error('Missing "username" and/or "nonce" in response (got: '+
        $.toJSON(result)+')'), result);
    }
    // refresh sid (it might have changed if the backend session cache was purged)
    if (result.sid)
      self.setId(result.sid);
    // use result.username instead of username here since we need the actual,
    // case-sensitive username to calculate the correct response.
    var passhash = oui.hash.sha1(result.username + ":" + password),
        auth_response = oui.hash.sha1_hmac(result.nonce, passhash);
    var params = {
      username: result.username,
      auth_response: auth_response
    };
    this._requestSignIn(params, callback);
  },

  setSignedInUser: function(user) {
    if (typeof user !== 'object')
      throw new Error('Invalid argument: user is not an object');
    if (!user.username)
      throw new Error('Data inconsistency: Missing username in user argument');
    this.setUser(user);
    console.log('[oui] session/signIn: successfully signed in '+user.username);
  }

});

// since app is created before we exist
if (oui.app) {
  oui.app.session = new exports.Session(oui.app);
}
