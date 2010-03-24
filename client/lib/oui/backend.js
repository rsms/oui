/**
 * Backend interface.
 * The oui.backend.events object emits the following events:
 *
 *   change (event) -- a new backend was selected
 *   reset  (event) -- all backends have been tested (basically means that we're
 *                     starting over with backends[0])
 *   error  (event, error, backend) -- a backend has failed and another one will
 *                                     be picked.
 */

// List of backends -> { host: string [, port: int] [, secure: bool] }
// This list should not be altered once used.
exports.backends = [];
exports.currentIndex = -1;
exports.events = new oui.EventEmitter();

if (console.debug) {
  exports.events.on('change', function(){
    console.debug('backend changed to', exports.current());
  }).on('error', function(ev, err, backend) {
    console.debug('backend failed', err, backend);
  });
}

exports.current = function() {
	if (exports.currentIndex === -1) exports.next();
	return exports.backends[exports.currentIndex];
};

exports.currentURL = function() {
	var backend = exports.current();
	var url = (backend.secure ? 'https://' : 'http://')+
	  backend.host + ':' + backend.port;
	if (backend.path) url += backend.path;
	return url;
};

/**
 * API should use this when a backend stopped answering or caused a permanent
 * error. We will move on to another backend (but only if <backend> is current).
 */
exports.reportError = function(error, backend){
  // assure the current backend is the one that did fail
  if (backend && exports.current() !== backend)
    return; // we have already moved from that backend
  if (!error) error = new Error('backend failure');
  exports.events.emit('error', error, backend);
  exports.next();
};

/**
 * Try to perform <action> for each unqiue backend.
 *
 * <action> must be a function which accepts a single function parameter (an
 * internal callback).
 *
 * Scenario A: <action> succeeds -- <callback> is called without any arguments.
 *
 * Scenario B: <action> have failed <backends.length> times -- <callback> is
 *             called with the most recent error.
 */
exports.retry = function(action, callback) {
  // TODO: only test next backend when the error is hard or a 5xx http error.
  if (exports.setup !== undefined) { exports.setup();exports.setup=undefined; }
  var again = function(retries, prevErr){
    if (retries === exports.backends.length) {
      return callback && callback(prevErr||new Error('no retries possible'));
    }
    action(function(err) {
      if (err) again(retries+1, err);
      else if (callback) callback.apply(null, Array.prototype.slice.call(arguments));
    });
  };
  again(0);
};

// Returns true if moved on to a untested backend, false if wrapped around.
exports.next = function() {
	if (exports.setup !== undefined) { exports.setup();exports.setup=undefined; }

	// round-robin
	exports.currentIndex++;

	// sanity check
	if (exports.backends.length === 0) {
		console.warn(__name+'.backends is empty');
		return false;
	}

	// If the client does not support CORS, make sure we fall back to same-origin.
	if (!oui.capabilities.cors) {
		var backend, x = exports.currentIndex;
		for (i=0; i<exports.backends.length; i++) {
			if (x === exports.backends.length) x = 0;
			backend = exports.backends[x];
			if (backend.host === window.location.host && backend.port === window.location.port) {
			  exports.currentIndex = x;
			  break;
			}
		}
	}
	
	// wrap around?
	if (exports.currentIndex === exports.backends.length) {
		// This most likely means "no internet connection" or
		// "all servers down" since the last server is (should be) the
		// fallback to same-origin
		exports.currentIndex = 0;
		exports.events.emit('reset');
		exports.events.emit('change');
		return false;
	}
	
	exports.events.emit('change');
	
	return true;
};

exports.setup = function() {
  // setup
  if (window.OUI_BACKEND) {
  	exports.backends = $.isArray(window.OUI_BACKEND) ? window.OUI_BACKEND : [window.OUI_BACKEND];
  } else if (window.OUI_BACKENDS) {
  	exports.backends = $.isArray(window.OUI_BACKENDS) ? window.OUI_BACKENDS : [window.OUI_BACKENDS];
  }
  else {
  	// if file:, prepend localhost with same ports
  	var isFile = window.location.protocol === 'file:';
  	var isLocal = isFile || window.location.hostname.match(/(?:\.local$|^(?:localhost|127\.0\.0\.*)$)/);
  	if (isLocal) {
  		var origBackends = exports.backends, localBackends, ports = {};
  		var hostname = isFile ? 'localhost' : window.location.hostname;
  		if (origBackends.length === 0) {
  		  var p = window.location.port;
  		  origBackends = [{host:'localhost', port:(!p||p===80 ? 8080 : p)}];
  	  }
  		localBackends = [0,0]; // first 2 args to array splice later on
  		for (var i=0;i<origBackends.length;i++) {
  			var backend = origBackends[i];
  			var port = backend.port || 80;
  			if (!ports[port]) { ports[port] = 1; // unique
  				var b = {host:hostname};
  				if (backend.port) b.port = backend.port;
  				if (backend.secure !== undefined) b.secure = backend.secure;
  				localBackends.push(b);
  			}
  		}
  		if (localBackends.length > 2)
  			Array.prototype.splice.apply(exports.backends, localBackends);
  	}
  	// add same-origin fallback
  	else if (window.location.protocol !== 'file:') {
  	  exports.backends.push({
  	    host: window.location.host,
  	    port: window.location.port||80,
  	    secure: window.location.protocol.indexOf('https') !== -1
  	  });
  	}
  }
  
  // sanitize backends
  for (var i=0,backend;backend=exports.backends[i];i++) {
    if (!backend.port) backend.port = 80;
    if (!backend.host) {
      throw new Error('inconsistency error in '+__name+
      ' -- backend without host specification');
    }
    if (backend.path) backend.path = '/'+backend.path.replace(/^\/+|\/+$/g, '');
  }

  // Freeze backends if possible
  if (typeof Object.freeze === 'function') Object.freeze(exports.backends);

  console.debug('backends =>', exports.backends);
}
