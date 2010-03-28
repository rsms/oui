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
  this.id = id || oui.cookie.get('sid');

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
    if (this.id) {
      if (typeof params === 'object') {
        if (!params.sid) {
          // make a copy
          var nparams = {sid: this.id};
          oui.mixin(nparams, params);
          params = nparams;
        }
      } else {
        params = {sid: this.id};
      }
    }
    var options = {}; // TODO: expose as set:able in exec function call
    var self = this, action = function(cl){
      var url = oui.backend.currentURL()+'/'+remoteName;
      oui.http.request(method, url, params, options, cl);
    }
    this.emit('exec-send', remoteName);
    oui.backend.retry(action, function(err, response) {
      self.emit('exec-recv', remoteName);
      if (callback) {
        if (err) callback(err);
        else callback(err, response.data, response);
      }
    });
    return this;
  },

  // Open the session
  open: function(callback) {
    var self = this;
    var onerr = function(err){
      self.app.emitError({
        message: 'Connection error',
        description: 'Failed to connect to the dropular service. Please try again in a few minutes.',
        data: {backends: oui.backend.backends, error: err}
      }, self, err);
      callback && callback(err);
    };
    this.get('session/establish', function(err, result) {
      if (err) return onerr(err);
      self.id = result.sid;
      oui.cookie.set('sid', self.id);
      var prevUser = self.user;
      self.user = result.user || undefined; // object if authed
      console.log('[oui] session/open: established', self.id, result);
      self.emit('open');
      self.emit('userchange', prevUser);
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
      var prevUser = self.user;
      delete self.user;
      console.log('[oui] session/signIn: successfully signed out '+prevUser.username);
      self.emit('userchange', prevUser);
      callback && callback();
    });
  },

  // Sign in <username> authenticated with <password>
  signIn: function(username, password, callback) {
    // passhash     = BASE16( SHA1( username ":" password ) )
    // auth_response = BASE16( SHA1_HMAC( auth_nonce, passhash ) )
    var self = this, cb = function(err, result) {
      if (!err) return callback && callback(null, result);
      self.app && self.app.emitError({
        message: 'Sing in failed',
        description: 'Failed to sign in user "'+username+'"',
        data: {username: username, result: result}
      }, self, err);
      callback && callback(err, result);
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
      callback && callback(err, result);
      if (!err && result.user)
        self.setSignedInUser(result.user);
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
    } if (!result.username || !result.nonce) {
      return callback(new Error('Missing "username" and/or "nonce" in response (got: '+
        $.toJSON(result)+')'), result);
    }
    // use result.username instead of username here since we need the actual,
    // case-sensitive username to calculate the correct response.
    var passhash = oui.hash.sha1(result.username + ":" + password),
        auth_response = oui.hash.sha1_hmac(result.nonce, passhash);
    var params = {
      username: result.username,
      auth_response: auth_response
    };
    this._requestSignIn(params, function(err, result) {
      // cache passhash to be able to seamlessly switch backends
      if (!err) result.user.passhash = passhash;
      callback && callback(err, result);
    });
  },

  setSignedInUser: function(user) {
    if (typeof user !== 'object')
      throw new Error('Invalid argument: user is not an object');
    if (!user.username)
      throw new Error('Data inconsistency: Missing username in user argument');
    var prevUser = this.user;
    this.user = user;
    console.log('[oui] session/signIn: successfully signed in '+this.user.username);
    this.emit('userchange', prevUser);
  }

});
