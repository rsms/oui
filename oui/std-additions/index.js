var sys = require('sys'),
    path = require('path'),
    fs = require('fs'),
    util = require('../util');

// -------------------------------------------------------------------------
// GLOBAL

GLOBAL.mixin = function(target) {
  var i = 1, length = arguments.length, source;
  for ( ; i < length; i++ ) {
    // Only deal with defined values
    if ( (source = arguments[i]) !== undefined ) {
      Object.getOwnPropertyNames(source).forEach(function(k){
        var d = Object.getOwnPropertyDescriptor(source, k) || {value:source[k]};
        if (d.get) {
          target.__defineGetter__(k, d.get);
          if (d.set) target.__defineSetter__(k, d.set);
        }
        else if (target !== d.value) {
          target[k] = d.value;
        }
      });
    }
  }
  return target;
};

//------------------------------------------------------------------------------
// Object

require('./object');


//------------------------------------------------------------------------------
// Array

require('./array');

//------------------------------------------------------------------------------
// String

String.prototype.repeat = function(times) {
  var v = [], i=0;
  for (; i < times; v.push(this), i++);
  return v.join('');
}

String.prototype.fillLeft = function(length, padstr) {
  if (this.length >= length) return this;
  return String(padstr || " ").repeat(length-this.length) + this;
}

String.prototype.fillRight = function(length, padstr) {
  if (this.length >= length) return this;
  return this + String(padstr || " ").repeat(length-this.length);
}

String.prototype.linewrap = function(prefix, linewidth, lineglue) {
  if (typeof prefix === 'number') prefix = ' '.repeat(prefix);
  else if (!prefix) prefix = '';
  if (!linewidth) linewidth = 79;
  if (!lineglue) lineglue = '\n';
  var value = this.trimRight();
  if (prefix.length + value.length <= linewidth)
    return value;
  var mlen = linewidth-prefix.length, buf = [], offs = 0, p;
  while (offs < value.length) {
    p = value.length-offs > mlen ? value.lastIndexOf(' ', offs+mlen) : -1;
    if (p === -1) {
      // todo: force-split very long strings
      buf.push(value.substr(offs));
      break;
    }
    buf.push(value.substring(offs, p));
    offs = p+1; // +1 for " "
  }
  return buf.join(lineglue+prefix);
}

// by Carlos R. L. Rodrigues
String.prototype.levenshtein = function(otherString) {
  var s, l = (s = this.split("")).length,
      t = (otherString = otherString.split("")).length, i, j, m, n;
  if(!(l || t)) return Math.max(l, t);
  for(var a = [], i = l + 1; i; a[--i] = [i]);
  for(i = t + 1; a[0][--i] = i;);
  for(i = -1, m = s.length; ++i < m;) {
    for(j = -1, n = otherString.length; ++j < n;) {
      a[(i *= 1) + 1][(j *= 1) + 1] = Math.min(a[i][j + 1] + 1,
        a[i + 1][j] + 1, a[i][j] + (s[i] != otherString[j]));
    }
  }
  return a[l][t];
};

// -------------------------------------------------------------------------
// Date

mixin(Date, {
  distantFuture: new Date((new Date()).getTime()+9000000000000),
  distantPast: new Date(0),
  
  // timestamp should be in milliseconds since the epoch, UTC
  fromUTCTimestamp: function(timestamp) {
    return new Date(timestamp+Date.timezoneOffset);
  },

  _calculateOffset: function() {
    var rightNow = new Date(),
        date1 = new Date(rightNow.getFullYear(), 0, 1, 0, 0, 0, 0),
        date2 = new Date(rightNow.getFullYear(), 6, 1, 0, 0, 0, 0),
        temp = date1.toGMTString(),
        date3 = new Date(temp.substring(0, temp.lastIndexOf(" ")-1)),
        temp = date2.toGMTString(),
        date4 = new Date(temp.substring(0, temp.lastIndexOf(" ")-1));
    // standard offset, not counting DST
    Date._timezoneOffsetStd = (date3 - date1);
    // offset including DST
    Date._timezoneOffsetDst = (date4 - date2);
  },

  // Standard offset in milliseconds
  get timezoneOffset() {
    if (Date._timezoneOffsetStd === undefined) this._calculateOffset();
    return Date._timezoneOffsetStd;
  },

  // DST offset in milliseconds
  get timezoneDSTOffset() {
    if (Date._timezoneOffsetDst === undefined) this._calculateOffset();
    return Date._timezoneOffsetDst;
  },

  get currentUTCTimestamp() {
    return (new Date()).toUTCTimestamp();
  }
});
mixin(Date.prototype, {
  get milliseconds() { return this.getMilliseconds() },
  get seconds() { return this.getSeconds() },
  get minutes() { return this.getMinutes() },
  get hours() { return this.getHours() },
  get day() { return this.getDate() },
  get weekday() { return this.getDay() },
  get month() { return this.getMonth() },
  get year() { return this.getFullYear() },

  get utcMilliseconds() { return this.getUTCMilliseconds() },
  get utcSeconds() { return this.getUTCSeconds() },
  get utcMinutes() { return this.getUTCMinutes() },
  get utcHours() { return this.getUTCHours() },
  get utcDay() { return this.getUTCDate() },
  get utcWeekday() { return this.getUTCDay() },
  get utcMonth() { return this.getUTCMonth() },
  get utcYear() { return this.getUTCFullYear() },

  toUTCTimestamp: function() {
    return this.getTime()-Date.timezoneOffset;
  },

  toUTCComponents: function(){
    with (this) { return [
      getUTCFullYear(), getUTCMonth()+1, getUTCDate(), getUTCHours(),
      getUTCMinutes(), getUTCSeconds(), getUTCMilliseconds()
    ]}
  }
});

/* Date additions test:
var sys = require('sys'), assert = require('assert');
var utcts = 1259431623345;
var d = Date.fromUTCTimestamp(utcts);
//sys.puts(d.toISOString())
assert.equal(d.toISOString(), '2009-11-28T17:07:03.345Z');
assert.equal(d.toUTCTimestamp(), utcts);*/

// -------------------------------------------------------------------------
// http module

// HTTP statuses without body
require('http').BODYLESS_STATUS_CODES = [204,205,304];

// -------------------------------------------------------------------------
// fs module

/**
 * Collect (find) files and directories matching <filter> in <dirnames>.
 *
 * The returned Promise will emit two additional events:
 *  - "file" (String relativePath, String absolutePath, Object context)
 *  - "directory" (String relativePath, String absolutePath, Object context)
 *
 * If <assembleOrFileListener> is a function, it will be added as a listener
 * of the "file" event.
 *
 * If <assembleOrFileListener> is boolean true, all matching files and
 * directories will be buffered in an array which finally is passed to success
 * handlers of the returned Promise.
 */
fs.find = function(options, callback){
  var opt = {
    //dirnames:,
    //filter:,
    //unbuffered:,
    //maxDepth:
  };
  if (typeof options === 'object')
    for (var k in options) opt[k] = options[k];
  else if (typeof options === 'string')
    opt.dirnames = options;
  if (!Array.isArray(opt.dirnames))
    opt.dirnames = opt.dirnames ? [opt.dirnames] : [];
  if (opt.dirnames.length === 0)
    throw new Error('no dirnames defined');

  if (typeof opt.filter === 'function' && !(opt.filter instanceof RegExp)) {
    callback = opt.filter;
    opt.filter = undefined;
  }
  else if (typeof opt.unbuffered === 'function') {
    callback = opt.unbuffered;
    opt.unbuffered = undefined;
  }

  if (opt.filter && !opt.filter.test)
    opt.filter.test = function(s){ return s === opt.filter; }

  var cl = new util.RCB(callback);

  if (!opt.unbuffered && callback) {
    var files = [], dirs = [];
    cl.addListener('file', function(relpath){ files.push(relpath); })
      .addListener('directory', function(relpath){ dirs.push(relpath); })
    cl.callback = function(err){ callback(err, files, dirs); };
  }

  cl.open();

  for (var i=0;i<opt.dirnames.length && !cl.closed > -1;i++) {
    var ctx = {cl:cl, filter:opt.filter};
    if (opt.maxDepth) ctx.maxDepth = opt.maxDepth;
    find_dir(ctx, opt.dirnames[i], 1);
  }

  return cl.close();
}

function find_dir(ctx, srcdir, depth) {
  if (ctx.basedir === undefined)
    ctx.basedir = srcdir;
  if (ctx.maxDepth !== undefined && depth >= ctx.maxDepth)
    return;
  var callback = ctx.cl.handle();
  fs.readdir(srcdir, function(err, relnames) {
    if (err || !relnames) {
      if (err && err.message) err.message += " "+sys.inspect(srcdir);
      if (callback) callback(err);
      return;
    }
    for (var i=0;i<relnames.length;i++) {
      var relname = relnames[i];
      var absname = path.join(srcdir, relname);
      if (srcdir !== ctx.basedir)
        relname = path.join(srcdir.substr(ctx.basedir.length+1), relname);
      if (!ctx.filter || ctx.filter.test(relname))
        find_check(ctx, absname, relname, false, depth);
      else
        find_check(ctx, absname, relname, true, depth);
    }
    callback();
  });
}

function find_check(ctx, abspath, relpath, skipFile, depth) {
  var callback = ctx.cl.handle();
  fs.stat(abspath, function(err, stats) {
    if (err) return callback(err);
    if (!skipFile && stats.isFile()) {
      ctx.cl.emit('file', relpath, abspath, ctx);
    }
    else if (stats.isDirectory()) {
      ctx.cl.emit('directory', relpath, abspath, ctx);
      find_dir(ctx, abspath, depth+1);
    }
    callback();
  });
}


if (fs.mkdirs === undefined) {
  // mkdirs(path, [mode=(0777^umask)], [callback(err, pathsCreated)])
  fs.mkdirs = function (dirname, mode, callback) {
    if (typeof mode === 'function') {
      callback = mode;
      mode = undefined;
    }
    if (mode === undefined) mode = 0777 ^ process.umask();
    var pathsCreated = [], pathsFound = [];
    var makeNext = function() {
      var fn = pathsFound.pop();
      if (!fn) {
        if (callback) callback(null, pathsCreated);
      }
      else {
        fs.mkdir(fn, mode, function(err) {
          if (!err) {
            pathsCreated.push(fn);
            makeNext();
          }
          else if (callback) {
            callback(err);
          }
        });
      }
    }
    var findNext = function(fn){
      fs.stat(fn, function(err, stats) {
        if (err) {
          if (err.errno === process.ENOENT) {
            pathsFound.push(fn);
            findNext(path.dirname(fn));
          }
          else if (callback) {
            callback(err);
          }
        }
        else if (stats.isDirectory()) {
          // create all dirs we found up to this dir
          makeNext();
        }
        else {
          if (callback) {
            callback(new Error('Unable to create directory at '+fn));
          }
        }
      });
    }
    findNext(dirname);
  };
}

//------------------------------------------------------------------------------
// path

if (!path.relativeArray) {
  path.relativeArray = function(base, target) {
    base = path.normalizeArray(base);
    target = path.normalizeArray(target);
    var commonality = 0, npath = [];
    if (target.length === 0) return base;
    if (target[0] !== '') return base.concat(target);
    for (; commonality < base.length; commonality++) {
      var bc = base[commonality], tc = target[commonality];
      if (bc !== tc)
        break;
    };
    if (commonality > 0) {
      if (commonality > 1 || base[0] !== '') {
        for (var x=commonality; x < base.length; x++)
          npath.push('..');
      }
      else {
        npath.push('');
      }
    }
    for (; commonality < target.length; commonality++)
      npath.push(target[commonality]);
    return npath;
  };
  path.relative = function(base, target) {
    base = base.replace(/\/+$/, '').split('/');
    target = target.replace(/\/+$/, '').split('/');
    return path.relativeArray(base, target).join('/');
  };
}

//------------------------------------------------------------------------------
// process

// Fix process.umask in <=0.1.31
try { process.umask(); }
catch(e) {
  if (e.toString().indexOf('argument must be an integer') !== -1) {
    var _process_umask = process.umask;
    process.umask = function(newmask){
      if (!newmask) {
        var old = _process_umask(0); // read and clear
        _process_umask(old); // reset
        return old;
      }
      else {
        return _process_umask(newmask);
      }
    }
  }
}
