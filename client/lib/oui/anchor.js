// The module emit events
exports.events = new oui.EventEmitter();

/*
Events emitted by exports.events:
  change (ev, String currentPath, String previousPath, Array routes)
    Called when hash changes, before calling routes
  changed (ev, String currentPath, String previousPath, Array routes)
    Called when hash changed, after calling routes
*/

// Map of path => element ( => [handler, ...] )
exports.routes = [];

// Current path
//exports.path;

exports.on = function(path, priority, handler){
  if (typeof priority === 'function') {
    handler = priority;
    priority = 100;
  } else {
    priority = parseInt(priority);
  }
  handler = new exports.Route(path, handler);
  exports.routes.push([priority, handler]);
  exports.routes.sort(function(a,b){ return b[0]-a[0]; });
  handler.isIndex = (path === '' || (typeof path.test === 'function' && path.test('') === true));
  if (handler.isIndex && document.location.hash.substr(1) === '') {
    exports.path = undefined; // force update
	  onHashChange();
  }
  return handler;
};

exports.enableMultiRoutes = false;

exports.solve = function(path, params) {
  var route, matches, routes = [];
  for (var i=0, L = exports.routes.length; i < L; i++){
    route = exports.routes[i][1];
    if (route && (matches = route.path.exec(path))) {
      if (params && Array.isArray(matches) && matches.length)
        route.extractParams(params, matches);
      routes.push(route);
      if (!exports.enableMultiRoutes) break;
    }
  }
  return routes;
};

exports.reload = function(){
  exports.path = undefined;
  onHashChange();
};

// ----------------------------------------------------------------------------
// Internal

if (Array.prototype.indexOf === undefined) {
  Array.prototype.indexOf = function(item){
    for (var i=0,L=this.length; i<L; ++i)
      if (this[i] === item) return i;
    return -1;
  };
}
if (Array.isArray === undefined) {
  Array.isArray = $.isArray;
}

function querystringUnescape(str, decodeSpaces) {
  str = String(str);
  return decodeURIComponent(decodeSpaces ? str.replace(/\+/g, " ") : str);
}

function findByStrictPath(path) {
  var i, route;
  for (i=0; (route = exports.routes.routes[i]); ++i)
		if (route.path === path) return route;
}

function onHashChange() {
  var prevPath = exports.path,
      params = {}, routes;
  exports.path = document.location.hash.substr(1);
  if (prevPath === exports.path) return;
  routes = exports.solve(exports.path, params);
  exports.events.emit('change', exports.path, prevPath, routes);
  for (var i=0; (route = routes[i]); ++i) {
    try {
      route.handler(params, exports.path, prevPath);
		} catch (e) {
			console.error('['+module.id+'] error when calling handler: '+(e.stack || e),
			  'handler =>', route.handler);
		}
	}
	exports.events.emit('changed', exports.path, prevPath, routes);
}

function isRegExp(obj) {
  return (obj instanceof RegExp)
      || (typeof obj === 'object' && (obj.constructor === RegExp));
}

// ----------------------------------------------------------------------------

/** Represents a route to handler by path */
function FixedStringMatch(string, caseSensitive) {
  this.string = caseSensitive ? string : string.toLowerCase();
  if (caseSensitive) this.caseSensitive = caseSensitive;
}
FixedStringMatch.prototype.exec = function(str) {
  return this.caseSensitive ? (str === this.string) : (str.toLowerCase() === this.string);
};

/** Route */
exports.Route = function(pat, handler) {
  var nsrc, p, re, m, mlen;
  this.keys = [];
  this.path = pat;
  this.handler = handler;
  if (typeof handler !== 'function') throw new Error('handler must be a function');
  if (handler.routes === undefined) handler.routes = [this];
  else handler.routes.push(this);
  // x(['/users/([^/]+)/info', 'username'], ..
  if (Array.isArray(pat)) {
    re = pat.shift();
    if (!re || !isRegExp(re)) re = new RegExp('^'+re+'$');
    this.path = re;
    this.keys = pat;
  }
  // x('/users/:username/info', ..
  else if (!isRegExp(pat)) {
    pat = String(pat).replace(/^[#\/]+/, ''); // strip prefix "#" and "/"
    if (pat.indexOf(':') === -1) {
      this.path = new FixedStringMatch(pat);
    } else {
      nsrc = pat.replace(/:[^\/]*/g, '([^/]*)');
      nsrc = '^'+nsrc+'$';
      this.path = new RegExp(nsrc, 'i'); // case-insensitive by default
      var param_keys = pat.match(/:[^\/]*/g);
      if (param_keys) {
        for (var i=0; i < param_keys.length; i++)
          this.keys.push(param_keys[i].replace(/^:/g, ''));
      }
    }
  }
  // Pure RegExp
  // x(/^\/users\/(<username>[^\/]+)\/info$/', ..
  // x(/^\/users\/([^/]+)\/info$/, ..
  else {
    src = pat.source;
    p = src.indexOf('<');
    if (p !== -1 && src.indexOf('>', p+1) !== -1) {
      re = /\(<[^>]+>/;
      m = null;
      p--;
      nsrc = src.substr(0, p);
      src = src.substr(p);
      while ((m = re.exec(src))) {
        nsrc += src.substring(0, m.index+1); // +1 for "("
        mlen = m[0].length;
        src = src.substr(m.index+mlen);
        this.keys.push(m[0].substr(2,mlen-3));
      }
      if (src.length) nsrc += src;
      // i is the only modifier which makes sense for path matching routes
      this.path = new RegExp(nsrc, pat.ignoreCase ? 'i' : undefined);
    }
    else {
      this.path = pat;
    }
  }
};

exports.Route.prototype.extractParams = function(params, matches) {
  var i, l, captures = [], m;
  matches.shift();
  for (i=0, l = this.keys.length; i < l; i++) {
    if ((m = matches.shift()))
      params[this.keys[i]] = querystringUnescape(m, true);
  }
  for (i=0, l = matches.length; i < l; i++)
    captures[i] = querystringUnescape(matches[i], true);
  if (captures.length)
    params._captures = captures;
};


function _init() {
  exports._prevhash = '';
	if ("onhashchange" in window) {
		$(window).bind('hashchange', function(){
		  if (exports._prevhash !== document.location.hash){
				exports._prevhash = document.location.hash;
				onHashChange();
			}
		});
	}
	// even though onhashchange exists in modern browsers, it's a bit buggy in some,
	// so always poll (however at a lower rate in that case) the state.
	setInterval(function(){
		if (exports._prevhash !== document.location.hash){
			exports._prevhash = document.location.hash;
			onHashChange();
		}
	}, ("onhashchange" in window) ? 500 : 100);
	onHashChange();
	return true;
}

$(function(){
  setTimeout(function(){ _init(); },1); // next tick
});
