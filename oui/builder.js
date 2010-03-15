var sys = require('sys')
   ,path = require('path')
   ,fs = require('fs')
   ,CallQueue = require('./queue').CallQueue
   ,util = require('./util')

require('./fs-additions');
require('./string-additions');

// -------------------------------------------------------------------------

const HUNK_CSS_START = /<style[^>]+type=\"text\/css\"[^>]*>/im
     ,HUNK_CSS_END = /<\/style>/i
     ,HUNK_JS_START = /<script[^>]+type=\"text\/javascript\"[^>]*>/im
     ,HUNK_JS_END = /<\/script>/i

function extract_hunks(content, startRe, endRe, hunksOrCb) {
	var index = 0;
	var hunksOrCbIsFun = typeof hunksOrCb === 'function';
	while (1) {
		var m1 = startRe.exec(content, index);
		if (!m1)
			break;
		index = m1.index + m1[0].length;
		// find end
		var m2 = endRe.exec(content, index);
		if (!m2)
			throw new Error('unable to find terminator ('+endRe+')');
		// extract style from content
		var hunk = content.substring(index, m2.index);
		
		if (hunksOrCbIsFun)
		  hunksOrCb(hunk);
		else
		  hunks.push(hunk);
		
		content = content.substring(0, m1.index)
			+ content.substr(m2.index+m2[0].length);
		// fwd
		index = (m2.index + m2[0].length) - hunk.length;
	}
	return content;
}

function fwriteall(fd, data, cb) {
  fs.write(fd, data, 0, 'binary', function (writeErr, written) {
    if (writeErr) {
      fs.close(fd, function(){ if (cb) cb(writeErr); });
    } else {
      if (written === data.length) cb();
      else fwriteall(fd, data.slice(written), cb);
    }
  });
}

// -------------------------------------------------------------------------

var statable = {
  /**
   * stat() this.
   *
   * The results will be available at this.stats (which will be false if
   * the product did/does not exist or is not statable).
   */
  stat: function(onlyIfNeeded, callback){
    // wrapped up in an outer promise, since we do not differ from success
    // or error (even if the product is not found, we consider this action
    // a success).
    if (typeof onlyIfNeeded === 'function') {
      callback = onlyIfNeeded;
      onlyIfNeeded = undefined;
    }
    var self = this;
    if ((onlyIfNeeded||onlyIfNeeded===undefined) && this.stats!==undefined) {
      if (callback) callback();
      return;
    }
    fs.stat(this.filename, function(err, stats){
      if (err) {
        self.stats = false;
        self.builder.log(self+' not stat-able', 2);
      }
      else {
        self.stats = stats;
        self.builder.log(self+' stats.mtime: '+stats.mtime, 2);
      }
      if (callback) callback(); // always success
    });
  }
};

// -------------------------------------------------------------------------

function Product(builder, filename, type, sources) {
  this.builder = builder;
  this.filename = filename;
  this.type = type || path.extname(filename).substr(1).toLowerCase();
  this.sources = sources || [];
  this.stats = undefined;
}
process.mixin(Product.prototype, statable);
process.mixin(Product.prototype, {
  get dirty() {
    if (this._dirty !== undefined)
      return this._dirty;
    if (!this.stats || !this.stats.mtime)
      return this._dirty = true;
    for (var i=0;i<this.sources.length;i++) {
      var source = this.sources[i];
      if (!source.stats || !source.stats.mtime)
        return this._dirty = true;
      if (this.stats.mtime < source.stats.mtime)
        return this._dirty = true;
    }
    return this._dirty = false;
  },
  
  output: function(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    
    if (!this.builder.force && !this.dirty) {
      this.builder.log('skipping up-to-date '+this.filename, 2);
      if (callback) callback();
      return;
    }
    
    this.builder.log('writing '+this.filename, 2);
    var self = this;
    
    var flags = process.O_CREAT | process.O_TRUNC | process.O_WRONLY;
    fs.open(this.filename, flags, 0666, function (err, fd) {
      if (err) {
        if (err.message) err.message += " "+sys.inspect(self.filename);
        if (callback) callback(err);
        return;
      }
      var queue = new CallQueue(self, false, callback);
      self.sources.sort(function(a, b){
        return (a.name.toLowerCase() < b.name.toLowerCase()) ? -1 : 1;
      });
      // jquery module has top prioritity
      for (var i=0; i<self.sources.length; i++) {
        var source = self.sources[i];
        if (source.name.toLowerCase() === 'jquery') {
          self.sources.splice(i,1);
          self.sources.unshift(source);
          break; //i--;
        }
      }
      for (var i=0; i<self.sources.length; i++) {
        var source = self.sources[i];
        sys.error('write '+source)
        queue.push(function(cl){ source.write(fd, cl); });
      }
      queue.start();
    });
  },
  
  /// String rep
  toString: function() {
    return 'Product('+JSON.stringify(this.filename)+')';
  }
});

// -------------------------------------------------------------------------

const SOURCE_DEMUXABLE_TYPE_RE = /^x?html?$/i;

function Source(builder, filename, relname, content) {
  this.builder = builder;
  this.filename = filename;
  this.relname = relname;
  this.content = content;
  this.type = path.extname(filename).substr(1).toLowerCase();
  this.products = []; // all products which are build using this source
}
process.mixin(Source.prototype, statable);
process.mixin(Source.prototype, {
  /**
   * Demux (split) a source into possibly multiple sources, appended to
   * <sources>
   */
  demux: function(sources, callback) {
    if (!SOURCE_DEMUXABLE_TYPE_RE.test(this.type)) {
      if (callback) callback();
      return false;
    }
    this.builder.log('demuxing '+this, 2);
    if (!Array.isArray(sources)) sources = [];
    var self = this;
    fs.readFile(this.filename, function(err, content) {
      if (err) {
        if (callback) callback(err);
        return;
      }
      var css = [],
          js = [],
          addsource = function(type, hunk) {
            var source = new self.constructor(self.builder, 
              self.filename, self.relname, hunk);
            source.type = type;
            source.stats = self.stats;
            sources.push(source);
            self.builder.log('extracted '+source+' from '+self, 2);
          }
      content = extract_hunks(content, HUNK_CSS_START, HUNK_CSS_END,function(h){
        addsource('css', h);
      });
      content = extract_hunks(content, HUNK_JS_START, HUNK_JS_END,function(h){
        addsource('js', h);
      });
      self.content = content;
      if (callback) callback();
    });
  },
  
  get dirty() {
    if (this._dirty !== undefined)
      return this._dirty;
    if (!this.stats || !this.stats.mtime)
      return this._dirty = true;
    for (var i=0;i<this.products.length;i++) {
      if (this.products[i].dirty)
        return this._dirty = true;
    }
    return this._dirty = false;
  },
  
  get name() {
    if (this._name === undefined) {
      this._name = this.relname;
      if (this._name.length)
        this._name = this._name.replace(/(?:\.min|)\.[^\.]+$/, '');
    }
    return this._name;
  },
  
  write: function(fd, callback) {
    if (!this.content) {
      fs.readFile(this.filename, 'binary', function(err, content) {
        if (!err) fwriteall(fd, content, callback);
        else if (callback) callback(err);
        // yes, throw away content
      })
    }
    else {
      fwriteall(fd, this.content, callback);
    }
  },
  
  /**
   * Compile the source, if needed.
   */
  compile: function(callback) {
    // only js sources can be compiled
    if (this.type !== 'js') {
      if (callback) callback();
      return;
    }
    
    // skip compilation of "*.min.js"
    if (this.filename.lastIndexOf('.min.js') === this.filename.length-7) {
      this.builder.log('not compiling '+this+' (already compiled)', 2);
      if (callback) callback();
      return;
    }
    
    // skip compilation if not dirty
    if (!this.builder.force && !this.dirty) {
      this.builder.log('not compiling '+this+' (not dirty)', 2);
      if (callback) callback();
      return;
    }
    
    this.builder.log('compiling '+this, 2);
    // todo: compile
    // start by stating for an already compiled version
    if (callback) callback();
  },
  
  /// String rep
  toString: function() {
    return 'Source('+this.type+', '+JSON.stringify(this.name)+')';
  }
});

// -------------------------------------------------------------------------

const BUILDER_DEFAULT_SRCFILTER = /^[^\.].*\.(?:js|css|x?html?)$/i;

function Builder(srcDirs) {
  this.srcDirs = Array.isArray(srcDirs) || [];
  this.srcFilter = BUILDER_DEFAULT_SRCFILTER;
  this.productsDir = 'build';
  this.productsName = 'index';
  this.sources = [];  // [Source, ..]
  this.products = {}; // {type: Product, ..}
  this.logLevel = 1; // 0: only errors, 1: info and warnings, 2: debug
  this.force = false; // ignore timestamps
}

process.mixin(Builder.prototype, {
  log: function(msg, level) {
    if (this.logLevel >= (level === undefined ? 0 : level)) {
      if (level < 2) {
        sys.error(msg);
      }
      else {
        var r = "\n"+('  '.repeat(level));
        sys.error(('  '.repeat(level-1))+(msg.replace(/\n/g, r)));
      }
    }
  },
  
  forEachSource: function(fun, callback) {
    var rcb;
    if (callback && callback instanceof util.RCB) rcb = callback;
    else rcb = new util.RCB(callback);
    rcb.open();
    for (var i=0,L=this.sources.length;i<L;i++)
      fun.call(this, this.sources[i], rcb.handle());
    rcb.close();
  },
  
  forEachProduct: function(fun, callback) {
    var rcb;
    if (callback && callback instanceof util.RCB) rcb = callback;
    else rcb = new util.RCB(callback);
    var types = Object.keys(this.products);
    rcb.open();
    for (var i=0; i<types.length;i++)
      fun.call(this, this.products[types[i]], rcb.handle());
    rcb.close();
  },
  
  setupProducts: function(){
    this.products = {};
    for (var i=0,L=this.sources.length;i<L;i++) {
      var source = this.sources[i];
      var t = source.type, product = this.products[t];
      if (product) {
        product.sources.push(source);
        source.products = [product];
      }
      else {
        var fn = path.join(this.productsDir, this.productsName+'.'+t);
        product = new Product(this, fn, t, [source]);
        source.products = [product];
        this.products[t] = product;
      }
    }
  },
  
  // ----------
  
  collectSources: function(callback) {
    this.log('Collecting', 1);
    var self = this,
        eve = fs.find(this.srcDirs, this.srcFilter, true, callback),
        didAddStdlib = false;
    eve.addListener('file', function(relpath, abspath, ctx){
      var source;
      if (!didAddStdlib && self.stdlib && self.stdlibJSPath) {
        source = new Source(self, self.stdlibJSPath, '');
        self.sources.push(source);
        source.stat(ctx.cl.handle());
        didAddStdlib = true;
      }
      self.log('collect '+relpath, 2);
      source = new Source(self, abspath, relpath);
      self.sources.push(source);
      source.stat(ctx.cl.handle());
    });
  },
  
  demux: function(callback) {
    this.log('Demuxing', 1);
    var self = this;
    this.forEachSource(function(source, cl){
      source.demux(self.sources, cl);
    }, callback);
  },
  
  statProducts: function(callback) {
    this.log('Stating products', 2);
    this.setupProducts();
    this.forEachProduct(function(product, cl){
      product.stat(cl);
    }, callback);
  },
  
  compile: function(callback) {
    this.log('Compiling', 1);
    this.forEachSource(function(source, cl){
      source.compile(cl);
    }, callback);
  },
  
  _mkOutputDirs: function(callback) {
    // mkdirs
    var dirnames = {}, types = Object.keys(this.products);
    for (var i=0; i<types.length;i++) {
      var product = this.products[types[i]];
      if (product.dirty || this.force)
        dirnames[path.dirname(product.filename)] = 1;
    }
    dirnames = Object.keys(dirnames);
    if (dirnames.length) {
      var rcb = new util.RCB(callback);
      rcb.open();
      for (var i=0; i<dirnames.length;i++)
        fs.mkdirs(dirnames[i], rcb.handle());
      rcb.close();
    }
    else {
      callback();
    }
  },
  
  output: function(callback) {
    this.log('Writing products', 1);
    var rcb = new util.RCB(callback);
    rcb.open();
    this.forEachProduct(function(product, cl){
      product.output(cl);
    }, rcb);
    rcb.close();
  },
  
  all: function(callback) {
    var queue = new CallQueue(this, false, callback);
    queue.push([
      this.collectSources,
      this.demux,
      function(cl){ this.log('sources: '+this.sources.join('\n'), 2); cl(); },
      this.statProducts,
      this.compile,
      this._mkOutputDirs,
      this.output,
      /*this.group,
      this.compile,
      this.merge,*/
    ]);
    queue.start();
    return queue;
  }
});

exports.Builder = Builder;
