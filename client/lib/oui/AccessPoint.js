function AccessPoint(){
	this._urlindex = -1;
}
oui.AccessPoint = AccessPoint;
AccessPoint.URLS = [
	'http://dropular.hunch.se:8080',
	'http://ap-001.dropular.hunch.se:8080',
	'http://dropular.hunch.se:8081',
	'http://dropular.hunch.se'
];

oui.mixin(AccessPoint.prototype, oui.EventEmitter.prototype, {
	url: function() {
		if (this._urlindex === -1) // first call
			this.next();
		return AccessPoint.URLS[this._urlindex];
	},
	
	// returns true if moved on to a untested ap, false if wrapped around
	// and restarting with first ap.
	next: function() {
		if (!this.isSetup)
			this.setup();
		
		// round-robin
		this._urlindex++;
		
		// sanity check
		if (AccessPoint.URLS.length === 0) {
			console.warn('AccessPoint.URLS is empty');
			return false;
		}
		
		// If the client does not support CORS, make sure we fall back to
		// same-origin ap, if possible
		if (!window.app.capabilities.cors) {
			var url, x = this._urlindex;
			for (i=0; i<AccessPoint.URLS.length; i++) {
				if (x === AccessPoint.URLS.length)
					x = 0;
				url = AccessPoint.URLS[x];
			}
		}
		
		// wrap around?
		if (this._urlindex === AccessPoint.URLS.length) {
			// This most likely means "no internet connection" or
			// "all servers down" since the last server is (should be) the
			// fallback to same-origin
			this._urlindex = 0;
			this.emit('reset');
			this.emit('change');
			return false;
		}
		
		this.emit('change');
		
		return true;
	},
	
	setup: function() {
		if (window.OUI_AP) {
			AccessPoint.URLS = $.isArray(window.OUI_AP) ? window.OUI_AP : [window.OUI_AP];
		}
		else {
			// if file:, prepend localhost with same ports
			var isFile = window.location.protocol === 'file:';
			var isLocal = isFile || window.location.hostname.match(/(?:\.local$|^(?:localhost|127\.0\.0\.*)$)/);
			if (isLocal) {
				var origUrls = AccessPoint.URLS, urlv, ports = {};
				var hostname = isFile ? 'localhost' : window.location.hostname;
				urlv = [0,0]; // first 2 args to array splice later on
				for (var i=0;i<origUrls.length;i++) {
					var url = origUrls[i].split(':');
					var port = (url[2] ? ':'+url[2] : '');
					if (!ports[port]) { // uniqueness
						ports[port] = 1;
						urlv.push(url[0]+'://'+hostname+port);
					}
				}
				if (urlv.length > 2)
					Array.prototype.splice.apply(AccessPoint.URLS, urlv);
			}
			// add same-origin fallback
			else if (window.location.protocol !== 'file:') {
				AccessPoint.URLS.push(window.location.protocol+'//'+window.location.host);
			}
		}
		
		console.log('URLs =>', AccessPoint.URLS);
		
		// we're done here
		var self = this;
		this.isSetup = true;
		this.setup = null;
		setInterval(function(){ delete self.setup; }, 1); // next tick
	}
});
