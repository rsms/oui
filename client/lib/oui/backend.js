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
    console.debug('backend changed to', exports.current(), exports.backends);
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
  if (backend)
    return backend.url();
};

var backend_url = function() {
  var url = (this.secure ? 'https://' : 'http://')+
    this.host + ':' + this.port;
  if (this.path) url += this.path;
  return url;
};

/**
 * API should use this when a backend stopped answering or caused a permanent
 * error. We will move on to another backend (but only if <backend> is current).
 */
exports.reportError = function(error, backend){
  // assure the current backend is the one that did fail
  if (backend && exports.current() !== backend)
    return true; // we have already moved from that backend
  if (!error) error = new Error('backend failure');
  exports.events.emit('error', error, backend);
  return exports.next();
};

/**
 * Try to perform <action> for each unqiue backend.
 *
 * <action> must be a function which accepts two arguments:
 *   (Object backend, Function callback).
 * The backend argument is the backend to connect with.
 * The callback passed to <action> must be called with at least one argument:
 *   (Error err, [Object response|Number httpCode])
 *
 * - If <[Object response|Number httpCode]> is undefined or does not match the
 *   prototype, a retry will be done if err is a true value, no matter what the
 *   error is.
 *
 * - If <response|httpCode> then we test
 *   (((response.statusCode || httpCode) % 500) < 100) -- if true, a retry
 *   (using the next backend) will be executed. Otherwise the call will be
 *   forwarded to <callback>.
 *
 * Scenario A: <action> succeeds -- <callback> is called without any arguments.
 *
 * Scenario B: <action> have failed <backends.length> times -- <callback> is
 *             called with the most recent error.
 */
exports.retry = function(action, callback) {
  if (exports.setup !== undefined) {
    exports.setup();
    exports.setup = undefined;
  }
  var again, backend, onend, self = this;
  onend = function(prevArgs) {
    console.warn(__name+'.retry: all backends failed. action =>', action);
    if (callback) {
      if (!$.isArray(prevArgs)) prevArgs = [];
      if (prevArgs.length === 0) {
        prevArgs = [new Error('All backends failed')];
      } else if (!prevArgs[0]) {
        prevArgs[0] = new Error('All backends failed');
      }
      callback.apply(self, prevArgs);
    }
  };
  again = function(retries, prevArgs){
    if (retries === exports.backends.length)
      return onend(prevArgs);
    backend = exports.current();
    console.debug(__name+' trying '+backend.host+':'+backend.port+' for '+action);
    action(backend, function(err, responseOrHTTPCode) {
      var args = Array.prototype.slice.call(arguments);
      if (err) {
        if (typeof responseOrHTTPCode === 'object')
          responseOrHTTPCode = responseOrHTTPCode.statusCode;
        if (typeof responseOrHTTPCode !== 'number')
          responseOrHTTPCode = 0;
        if ((responseOrHTTPCode % 500) < 100) {
          if (exports.reportError(err, backend)) {
            console.debug(__name+' retrying '+action);
            return again(retries+1, args);
          } else {
            return onend(prevArgs);
          }
        }
      } else if (exports.currentIndex > -1) {
        var b = exports.backends[exports.currentIndex];
        // keep track of this backend since it seems to work.
        oui.cookie.set('__oui_backend', b.host+':'+b.port);
      }
      if (callback) callback.apply(self, args);
    });
  };
  again(0);
};

// Returns true if moved on to an untested backend, false if wrapped around.
exports.next = function() {
  /*
  Idea for improvement of load balancing:

  Backend server could embed a key like "__oui" in any response with meta
  information about oui stuff, like backend load.

  E.g: When a backend is overloaded, it could respond with:

      503 Service Unavailable
      Retry-after: 120
      Content-type: application/json

      {
        "__oui":{
          "backend_status": {
            "host.name:8100": { "load": 0.9 },
            "host.name:8101": { "load": 2.1 },
            "host.name:8102": { "load": 0.3 }
          }
        }
      }

  In this case we simply re-order our "backends" list according to "load" and
  try the next backend (explicitly skipping the one we just got a 503 from).
  */
  if (exports.setup !== undefined) {
    exports.setup();
    exports.setup = undefined;
    return true;
  }

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
  var b, i, isFile, isLocal, sameOriginBackend;
  // setup
  if (window.OUI_BACKEND) {
    // global OUI_BACKEND overrides <backends>
    exports.backends = $.isArray(window.OUI_BACKEND) ?
      window.OUI_BACKEND : [window.OUI_BACKEND];
  } else if (window.OUI_BACKENDS) {
    // global OUI_BACKENDS overrides <backends>
    exports.backends = $.isArray(window.OUI_BACKENDS) ?
      window.OUI_BACKENDS : [window.OUI_BACKENDS];
  }
  else {
    // if file:, prepend localhost with same ports
    isFile = window.location.protocol === 'file:';
    isLocal = isFile || window.location.hostname.match(
        /(?:\.local$|^(?:localhost|127\.0\.0\.*)$)/);
    sameOriginBackend = {
      host: isFile ? 'localhost' : window.location.hostname,
      port: window.location.port || (isLocal ? 8100 : 80),
      secure: window.location.protocol.indexOf('https') === 0
    };
    if (isLocal) {
      exports.backends = [sameOriginBackend];
      exports.currentIndex = 0;
    } else {
      // add same-origin fallback
      // TODO: allow this to be disabled (so that the backends list is never modified)
      // first, check that the current backend is not already in the list
      var found = false;
      for (i=0;(b=exports.backends[i]);++i) {
        if (b.host === sameOriginBackend.host && b.port === sameOriginBackend.port) {
          found = true; break;
        }
      }
      if (!found) exports.backends.push(sameOriginBackend);
    }
  }

  // sanitize backends
  for (i=0;(b=exports.backends[i]);++i) {
    b.port = b.port ? parseInt(b.port) : 80;
    if (!b.host) {
      throw new Error('inconsistency error in '+__name+
      ' -- backend without host specification');
    }
    if (b.path) b.path = '/'+b.path.replace(/^\/+|\/+$/g, '');
    if (!b.url) b.url = jQuery.proxy(backend_url, b);
  }

  if (!isLocal) {
    // Restore current backend from browser session (between page reloads).
    // This cookie is transient, lives in browser session)
    // Value in the format "host:port"
    var restored, t, previousBackend = oui.cookie.get('__oui_backend');
    if (previousBackend !== undefined && (t = previousBackend.split(':')) && t.length === 2) {
      t[1] = parseInt(t[1]);
      for (i=0; (b=exports.backends[i]); ++i) {
        if (b.host === t[0] && b.port === t[1]) {
          exports.currentIndex = i;
          restored = true;
          console.debug(__name+' restored previously used backend from cookie:',
            exports.backends[exports.currentIndex]);
          break;
        }
      }
    }
    // In the case there was no previous backend, choose one by random from the first
    // 75%
    if (!restored) {
      var hi = Math.floor((exports.backends.length-1)*0.75);
      exports.currentIndex = Math.round(Math.random()*hi);
      console.debug(__name+' selected a random backend:',
        exports.backends[exports.currentIndex]);
    }
  }

  console.debug('backends =>', exports.backends);
};
