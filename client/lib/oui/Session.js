/**
 * Represents a client-server session.
 *
 * Events:
 *  - open () -- when the sessions is open
 *  - userchange (previousUser) -- when authenticated user has changed
 *
 * Session([[app, ]id])
 */
oui.Session = function(app, id) {
	if (typeof app === 'string') {
		id = app;
		app = undefined;
	}
	this.app = app;
	this.id = id || cookie.get('sid');
	this.ap = new AccessPoint();
	
	if (oui.debug) {
		this.on('userchange', function(prevUser){
			if (this.user)
				console.log('signed in '+this.user.username);
			else if (prevUser && prevUser.username)
				console.log('signed out '+prevUser.username);
		});
		this.ap.on('change', function(){
			console.log('trying ap '+this.url());
		}).on('connect', function(){
			console.log('connected to ap '+this.url());
		});
	}
}

oui.mixin(oui.Session.prototype, oui.EventEmitter.prototype, {
	// todo: rip out the ap-next-retry code and make a universal wrapper
	//       e.g. ap.guard(mkreqfunc) -> promise

	_open: function(promise) {
		var self = this;
		var p1 = http.GET(this.ap.url()+'/session/establish', {sid: this.id}, {timeout:10000});
		var req = p1.context;
		if (promise._nretries === undefined)
		 	promise._nretries = AccessPoint.URLS.length;
		p1.addCallback(function(ev, res){
			// todo: validate & sanitize response
			self.id = res.data.sid;
			var prevUser = self.user;
			self.user = res.data.user || undefined; // object if authed
			cookie.set('sid', self.id);
			console.log('session established', self.id, res);
			self.emit('open');
			self.emit('userchange', prevUser);
			promise.emitSuccess();
		}).addErrback(function(ev, er){
			console.log('failed to query ap '+self.ap.url(), ev, er);
			promise._nretries--;
			if (promise._nretries > 0) {
				self.ap.next();
				// trying next ap
				setTimeout(function(){ self._open(promise); }, 1);
			}
			else {
				promise.emitError(er);
			}
		});
		return p1;
	},
	
	open: function() {
		var self = this;
		var promise = new Promise(this);
		promise.addErrback(function(ev, er) {
			self.app.emitError({
				message: 'Connection error',
				description: 'Failed to connect to the dropular service. Please try again in a few minutes.',
				data: {aps: AccessPoint.URLS}
			}, self, er, ev);
		});
		this._open(promise);
		return promise;
	},
	
	signOut: function() {
		if (!this.user)
			return;
		console.log('signing out '+this.user.username);
		var self = this;
		http.GET(this.ap.url()+'/session/sign-out', {sid: this.id}).addCallback(function(){
			var prevUser = self.user;
			delete self.user;
			self.emit('userchange', prevUser);
		}).addErrback(function(ev, er){
			self.app.emitError('Sign out failed', self, er, ev);
		});
	},
	
	signIn: function(username, password) {
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
		p1 = http.GET(this.ap.url()+'/session/sign-in', {sid: this.id, username: username});
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
			p2 = http.GET(self.ap.url()+'/session/sign-in', params);
			p2.addCallback(function(ev, res) {
				// success!
				var prevUser = self.user;
				self.user = res.data.user;
				self.user.passHash = pass_hash; // cache passHash to be able to seamlessly switch APs
				self.emit('userchange', prevUser);
				promise.emitSuccess(self.user);
			}).addErrback(function(ev, exc, res){
				promise.emitError(exc, res);
			});
		}).addErrback(function(ev, exc, res){
			promise.emitError(exc, res);
		});
		return promise;
	}

});
