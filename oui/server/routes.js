var querystring = require('querystring');
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

exports.Routes = function() {
  this.map = {};
};

exports.Routes.METHODS = METHODS;

exports.Routes.prototype.solve = function(req) {
  var route, matches,
    rv = this.map[(req.method === 'HEAD') ? 'GET' : req.method];
  if (rv === undefined) return;
  for (var i=0, L = rv.length; i < L; i++){
    route = rv[i][1];
    if (route && (matches = route.path.exec(req.url.pathname))) {
      if (Array.isArray(matches) && matches.length)
        route.extractParams(req, matches);
      return route;
    }
  }
}

exports.Routes.prototype.toString = function() {
  var i, m, v, s = [],
      spacing = 2,
      mlen = "OPTIONS".length+spacing;
  // find widest columns
  var colwidths = [];
  for (m in this.map) {
    this.map[m].forEach(function(t) {
      var priority = t[0], route = t[1];
      var col, cols = String(route).split(/\t/);
      for (i=0; col=cols[i];i++) {
        if (!(i in colwidths)) colwidths[i] = 0;
        colwidths[i] = Math.max(colwidths[i], String(col).length);
      }
    });
  }
  // create lines
  for (m in this.map) {
    this.map[m].forEach(function(t) {
      var priority = t[0], route = t[1],
          col, cols = String(route).split(/\t/),
          b = m.fillRight(mlen);
      for (i=0; i<colwidths.length; i++) {
        b += String(cols[i] || '').fillRight(colwidths[i] + spacing);
      }
      b += '('+priority+')';
      s.push(b);
    });
  }
  return s.join('\n');
}

METHODS.forEach(function(method){
  exports.Routes.prototype[method] = function(path, priority, handler){
    if (typeof priority === 'function') {
      handler = priority;
      priority = NaN;
    } else {
      priority = parseInt(priority);
    }
    if (isNaN(priority)) {
      priority = 100;
    }
    var m = this.map[method];
    if (m === undefined) m = this.map[method] = [];
    m.push([priority, new exports.Route(path, handler)]);
    m.sort(function(a,b){ return b[0]-a[0]; });
    return handler;
  }
});

/** Represents a route to handler by path */
function FixedStringMatch(string, caseSensitive) {
  this.string = caseSensitive ? string : string.toLowerCase();
  this.caseSensitive = caseSensitive;
}
FixedStringMatch.prototype.exec = function(str) {
  return this.caseSensitive ? (str === this.string) : (str.toLowerCase() === this.string);
}
FixedStringMatch.prototype.toString = function() {
  return this.string;
}


exports.Route = function(pat, handler) {
  this.keys = [];
  this.path = pat;
  this.handler = handler;
  if (typeof handler !== 'function') throw new Error('handler must be a function');
  if (handler.routes === undefined) handler.routes = [this];
  else handler.routes.push(this);
  // GET(['/users/([^/]+)/info', 'username'], ..
  if (Array.isArray(pat)) {
    re = pat.shift();
    if (!re || re.constructor !== RegExp) re = new RegExp('^'+re+'$');
    this.path = re;
    this.keys = pat;
  }
  // GET('/users/:username/info', ..
  else if (pat.constructor !== RegExp) {
    pat = String(pat);
    if (pat.indexOf(':') === -1) {
      this.path = new FixedStringMatch(pat);
      //exports.debug && sys.log(
      //  '[oui] route '+sys.inspect(pat)+' treated as absolute fixed-string match');
    }
    else {
      this.originalPath = pat;
      var nsrc = pat.replace(/:[^\/]+/g, '([^\\/]+)');
      nsrc = '^'+nsrc+'$';
      this.path = new RegExp(nsrc, 'i'); // case-insensitive by default
      //var sys=require('sys');
      //sys.log('[oui] route '+sys.inspect(pat)+' compiled to '+this.path);
      var param_keys = pat.match(/:[^\/]+/g);
      if (param_keys) for (var i=0; i < param_keys.length; i++)
        this.keys.push(param_keys[i].replace(/^:/, ''));
    }
  }
  // Pure RegExp
  // GET(/^\/users\/(<username>[^\/]+)\/info$/', ..
  // GET(/^\/users\/([^/]+)\/info$/, ..
  else {
    var src = pat.source;
    var p = src.indexOf('<');
    if (p !== -1 && src.indexOf('>', p+1) !== -1) {
      var re = /\(<[^>]+>/;
      var m = null;
      p--;
      var nsrc = src.substr(0, p);
      src = src.substr(p);
      while (m = re.exec(src)) {
        nsrc += src.substring(0, m.index+1) // +1 for "("
        var mlen = m[0].length;
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
}

exports.Route.prototype.extractParams = function(req, matches) {
  var i, l, captures = [];
  matches.shift();
  for (i=0, l = this.keys.length; i < l; i++)
    req.params[this.keys[i]] = querystring.unescape(matches.shift(), true);
  for (i=0, l = matches.length; i < l; i++)
    captures[i] = querystring.unescape(matches[i], true);
  req.params.captures = captures;
}

exports.Route.prototype.toString = function() {
  var s = String(this.originalPath || this.path);
  if (this.keys && this.keys.length)
    s += '\t{'+this.keys+'}';
  return s;
}
