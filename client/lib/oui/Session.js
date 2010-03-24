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
	  if (!id && this.id) console.debug('loaded session id =>', this.id);
		this.on('userchange', function(ev, prevUser){
			if (this.user)
				console.log('signed in '+this.user.username);
			else if (prevUser && prevUser.username)
				console.log('signed out '+prevUser.username);
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
			console.log('session established', self.id, result);
			self.emit('open');
			self.emit('userchange', prevUser);
			return callback && callback();
		});
	},
	
	// Sign out the current user, if any
	signOut: function(callback) {
		if (!this.user) return callback && callback();
		console.log('signing out '+this.user.username);
		var self = this;
		this.get('session/sign-out', function(err, result){
		  if (err) {
		    self.app.emitError('Sign out failed', self, err);
		    return callback && callback(err);
		  }
			var prevUser = self.user;
			delete self.user;
			self.emit('userchange', prevUser);
			callback && callback();
		});
	},
	
	// Sign in <username> authenticated with <password>
	signIn: function(username, password, callback) {
		// pass_hash     = BASE16( SHA1( user_id ":" password ) )
		// auth_response = BASE16( SHA1_HMAC( auth_nonce, pass_hash ) )
		var self = this, cb = function(err, result) {
		  if (!err) return callback && callback(null, result);
		  self.app && self.app.emitError({
				message: 'Sing in failed',
				description: 'Failed to sign in user "'+username+'"',
				data: {username: username, result: result}
			}, self, err);
			callback && callback(err, result);
		};
		console.log('signing in '+username);
		this.get('session/sign-in', {username: username}, function(err, result) {
		  if (err) return cb(err);
		  self._handleSignInChallenge(result, password, cb);
		});
	},
	
	_handleSignInChallenge: function(result, password, callback) {
		var self = this;
		console.log('got response from sign-in:', result);
		if (!result.user || !result.nonce) {
			return callback(new Error('Missing user_id and/or nonce in response (got: '+
				$.toJSON(result)+')'), result);
		}
		var passHash = oui.hash.sha1(result.user.id + ":" + password),
		    auth_response = oui.hash.sha1_hmac(result.nonce, passHash);
		var params = {
			username: result.user.username,
			auth_response: auth_response
		};
		this.get('session/sign-in', params, function(err, result) {
		  if (err) return callback && callback(err, result);
		  // successfully signed in
    	var prevUser = self.user;
    	self.user = result.user;
    	self.user.passHash = passHash; // cache passHash to be able to seamlessly switch backends
    	self.emit('userchange', prevUser);
    	callback && callback();
		});
	},
	
	/*OLD_signIn: function(username, password) {
		// pass_hash     = BASE16( SHA1( user_id ":" password ) )
		// auth_response = BASE16( SHA1_HMAC( auth_nonce, pass_hash ) )
		var self = this;
		var promise = new Promise(this), p1, p2;
		promise.addErrback(function(ev, er){
			self.app && self.app.emitError({
				message: 'Sing in failed',
				description: 'Failed to sign in user "'+username+'"',
				data: {username: username}
			}, self, er, ev);
		});
		console.log('signing in '+username);
		p1 = oui.http.GET(this.ap.url()+'/session/sign-in', {sid: this.id, username: username});
		p1.addCallback(function(ev, res) {
			console.log('got response from sign-in:', res, 'ev:', ev);
			if (!res.data.user_id || !res.data.nonce) {
				promise.emitError(new Error(
					'Missing user_id and/or nonce in response (got: '+
					$.toJSON(res.data)+')'), res);
				return;
			}
			var pass_hash = hash.sha1(res.data.user_id + ":" + password);
			var auth_response = hash.sha1_hmac(res.data.nonce, pass_hash);
			var params = {
				sid: self.id,
				user_id: res.data.user_id,
				auth_response: auth_response
			};
			p2 = oui.http.GET(self.ap.url()+'/session/sign-in', params);
			p2.addCallback(function(ev, res) {
				// success!
				var prevUser = self.user;
				self.user = res.data.user;
				self.user.passHash = pass_hash; // cache passHash to be able to seamlessly switch backends
				self.emit('userchange', prevUser);
				promise.emitSuccess(self.user);
			}).addErrback(function(ev, exc, res){
				promise.emitError(exc, res);
			});
		}).addErrback(function(ev, exc, res){
			promise.emitError(exc, res);
		});
		return promise;
	}*/

});
