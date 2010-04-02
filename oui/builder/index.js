var sys = require('sys'),
    path = require('path'),
    fs = require('fs'),

    util = require('../util'),
    cli = require('../cli'),

    jsmin = require('./jsmin'),
    jslint = require('./jslint'),
    sass = require('./sass'),
    less = require('./less');

require('../std-additions');

// -------------------------------------------------------------------------

const HUNK_CSS_START = /[\n\r\t ]*<style[^>]+type=\"text\/css\"[^>]*>/img
     ,HUNK_CSS_END = '</style>'
     ,HUNK_SASS_START = /[\n\r\t ]*<style[^>]+type=\"text\/sass\"[^>]*>/img
     ,HUNK_SASS_END = HUNK_CSS_END
     ,HUNK_JS_START = /[\n\r\t ]*<script[^>]+type=\"text\/javascript\"[^>]*>/img
     ,HUNK_JS_END = '</script>';

function extract_hunks(content, startRe, endStr, hunksOrCb) {
  var index = 0, m, p, hunk,
      hunksOrCbIsFun = (typeof hunksOrCb === 'function'),
      buf = '';

  while ((m = startRe.exec(content))) {
    if (   endStr === HUNK_JS_END
        && content.substring(m.index, startRe.lastIndex).indexOf('src=') !== -1)
    {
      p = content.indexOf(endStr, startRe.lastIndex);
      if (p === -1) throw new Error('unable to find terminator ('+endStr+')');
      p = p+endStr.length;
      buf += content.substring(index, p);
      index = p;
      continue;
    }

    buf += content.substring(index, m.index); index = m.index;

    p = content.indexOf(endStr, startRe.lastIndex);
    if (p === -1) throw new Error('unable to find terminator ('+endStr+')');

    //sys.debug(' --> ['+m.index+'-'+startRe.lastIndex+')  ['+p+'-'+p+endStr.length+')');
    hunk = content.substring(startRe.lastIndex, p);
    if (hunk.trim().length) {
      if (hunksOrCbIsFun) hunksOrCb(hunk);
      else hunksOrCb.push(hunk);
    }

    index = p+endStr.length;
  }
  buf += content.substr(index);
  return buf;
}

function fwriteall(fd, data, cb) {
  fs.write(fd, data, -1, 'binary', function (writeErr, written) {
    if (writeErr) {
      fs.close(fd, function(){ if (cb) cb(writeErr); });
    } else {
      if (written === data.length) {
        if (cb) cb(); // do not close fd
      } else {
        fwriteall(fd, data.slice(written), cb);
      }
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
mixin(Product.prototype, statable);
mixin(Product.prototype, {
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

  _write: function(header, footer, callback) {
    var self = this,
        flags = process.O_CREAT | process.O_TRUNC | process.O_WRONLY;
    fs.open(this.filename, flags, 0666, function (err, fd) {
      if (err) {
        if (err.message) err.message += " "+sys.inspect(self.filename);
        if (callback) callback(err);
        return;
      }
      var queue = new util.CallQueue(self, false, function(err){
        fs.close(fd, function(){ callback(err); });
      });
      // sort modules
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
      // queue writes
      if (header && header.length !== 0)
        queue.push(function(cl){ fwriteall(fd, header, cl); });
      self.sources.forEach(function(source){
        // index.html is taken care of by a separate mechanism
        // "external" files are not included as they are used in other ways
        var isIndexHtml = (self.type === 'html' && source.name === 'index');
        if (!isIndexHtml && !source.isExternal) {
          queue.push(function(cl){ source.write(fd, cl); });
        }
      });
      if (footer && footer.length !== 0)
        queue.push(function(cl){ fwriteall(fd, footer, cl); });
      // execute
      queue.start();
    });
  },

  output: function(callback) {
    if (!this.builder.force && !this.dirty) {
      this.builder.log('skipping up-to-date '+this.filename, 2);
      if (callback) callback(null, false);
      return;
    }

    // 2nd arg wrote=true
    if (callback) { var _cb=callback; callback=function(err){_cb(err, true);}; }

    this.builder.log('writing '+this.filename, 2);
    var self = this;

    // index.html ?
    if (this.type === 'html') {
      for (var i=0,L=this.sources.length; i<L; i++) {
        var source = this.sources[i];
        if (source.name === 'index') {
          deferred = true;
          source.compile(function(err){
            if (err) { if (callback) callback(err); return; }
            var header, footer, p = source.content.indexOf('</body>');
            if (p !== -1) {
              header = source.content.substr(0, p);
              footer = source.content.substr(p);
            }
            // continue writing all modules in this product
            self._write(header, footer, callback);
          });
          return;
        }
      }
    }

    // continue writing all modules in this product
    this._write(null, null, callback);
  },

  /// String rep
  toString: function() {
    return 'Product('+JSON.stringify(this.filename)+')';
  }
});

// -------------------------------------------------------------------------

const SOURCE_DEMUXABLE_TYPE_RE = /^x?html?$/i;
const SOURCE_JSOPT_UNTANGLED_RE = /(?:^|[\r\n])\s*\/\/\s*oui:untangled/igm;
const SOURCE_JSOPT_UNOPTIMIZED_RE = /(?:^|[\r\n])\s*\/\/\s*oui:unoptimized/igm;
const SOURCE_JSOPT_NOLINT_RE = /(?:^|[\r\n])\s*\/\/\s*oui:nolint/igm;
const SOURCE_HTMLOPT_UNTANGLED_RE = /<\!--[\r\n\s]*oui:untangled[\s\r\n]*-->/igm;

function Source(builder, filename, relname, content) {
  this.builder  = builder;
  this.filename = filename;
  this.relname  = relname;
  this.content  = content;
  this.type     = this.inputType = path.extname(filename).substr(1).toLowerCase();
  if (this.inputType === 'sass' || this.inputType === 'less') this.type = 'css'; // todo: DRY
  this.products = []; // all products which are build using this source
  if (filename)
    this.compiled = filename.lastIndexOf('.min.js') === filename.length-7;
}
mixin(Source.prototype, statable);
mixin(Source.prototype, {
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
    return this._name ||
      (this._name = this.relname
        .replace(/(?:\.min|)\.[^\.]+$/g, '')
        .replace(/\/+/g,'.')
        .replace(/\.index$/, '')
      );
  },

  get domname() {
    return this.name.replace(/\./g, '-');
  },

  // Indicates if the source is "external" and should not be included in product output.
  get isExternal() {
    // LESS and SASS files starting with "_" are included by other files.
    const includableTypes = ['less', 'sass'];
    return (includableTypes.indexOf(this.inputType) !== -1 && this.name.charAt(0) === '_');
  },

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
            source.type = source.inputType = type;
            if (source.inputType === 'sass' || source.inputType === 'less')
              source.type = 'css'; // todo: DRY
            source.stats = self.stats;
            sources.push(source);
            self.builder.log('extracted '+source+' from '+self, 2);
          }
      content = extract_hunks(content, HUNK_CSS_START, HUNK_CSS_END,function(h){
        addsource('css', h);
      });
      if (self.name !== 'index') {
        content = extract_hunks(content, HUNK_JS_START, HUNK_JS_END,function(h){
          addsource('js', h);
        });
      }
      content = extract_hunks(content, HUNK_SASS_START, HUNK_SASS_END,function(h){
        addsource('sass', h);
      });
      self.content = content;
      if (callback) callback();
    });
  },

  loadContent: function (store, callback) {
    if (this.content) {
      if (callback) callback(null, this.content);
      return;
    }
    var self = this;
    fs.readFile(this.filename, 'binary', function(err, content) {
      if (err) {
        if (callback) callback(err);
      }
      else {
        if (store) self.content = content;
        callback(null, content);
      }
    });
  },

  write: function(fd, callback) {
    this.loadContent(false, function(err, content){
      if (!err) fwriteall(fd, content, callback);
      else if (callback) callback(err);
    });
  },

  /**
   * Compile the source, if needed.
   */
  compile: function(callback) {
    const COMPILERS = {
      'js': this._compileJS,
      'html': this._compileHTML,
      'css': this._compileCSS, 'less': this._compileCSS,
      'sass': this._compileSASS,
    };
    var compiler = COMPILERS[this.inputType];

    if (!compiler) return callback && callback();

    // skip compilation of "*.min.js" ("compiled" files)
    if (this.compiled || this.filename.lastIndexOf('.min.js') === this.filename.length-7) {
      this.builder.log('not compiling '+this+' (already compiled)', 2);
      if (callback) callback();
      this.compiled = true;
      return;
    }

    // skip compilation if not dirty
    if (!this.builder.force && !this.dirty) {
      this.builder.log('not compiling '+this+' (not dirty)', 2);
      if (callback) callback();
      return;
    }

    this.builder.log('compiling '+this, 2);
    this.compiled = true;
    var self = this;
    this.loadContent(true, function(err){
      if (!err) {
        compiler.call(self, callback);
      } else if (callback) {
        callback(err);
      }
    });
  },

  _compileSASS: function(callback) {
    var self = this, sassopt = {
      content: this.content,
      file: this.filename,
    };
    sass.render(sassopt, function(err, css){
      if (!err) {
        self.content = css;
        self._compileCSS(callback);
      } else if (callback) {
        callback('SASS: '+err.message);
      }
    });
  },

  _compileCSS: function(callback) {
    this.content = this.content.replace(/#this/g, '#'+this.domname);
    // LESS
    var self = this,
        lessParser = new less.Parser({ paths: [path.dirname(this.filename)] });
    lessParser.parse(this.content, this.filename, function (err, tree) {
      if (!err) {
        try {
          self.content = tree.toCSS();
        } catch (e) {
          err = e;
          self.builder.log(e.stack, 2);
        }
      }
      if (err && err.message) {
        var file = err.filename || self.filename, line = err.lineno || '?';
        if (line === '?') {
          var m = /on line (\d+)/.exec(err.message);
          if (m) line = parseInt(m[1]);
        }
        err = 'lessc: ('+file+':'+line+') '+err.message;
        //sys.error('err => '+sys.inspect(err));
      }
      return callback && callback(err);
    });
  },

  _compileHTML: function(callback) {
    // oui:untangled
    var tangle, cl = this.content.length;
    if (this.name === 'index') {
      tangle = false;
    } else {
      this.content = this.content.replace(SOURCE_HTMLOPT_UNTANGLED_RE, '');
      tangle = cl === this.content.length;
    }

    if (tangle) {
      this.content = '<module id='+JSON.stringify(this.domname)+'>\n    '+
        this.content.replace(/^[\r\n\s]+/, '').replace(/[\r\n]/gm, '\n    ').replace(/[\r\n\s]*$/, '\n')+
        '  </module>\n';
    }

    if (callback) callback();
  },

  _compileJS: function(callback) {
    // Tangle (disable with "oui:untangled")
    var cl = this.content.length;
    this.content = this.content.replace(SOURCE_JSOPT_UNTANGLED_RE, '');
    if (cl === this.content.length) {
      this.content = '__defm('+JSON.stringify(this.name)+
        ', function(exports, __name, __html, __parent){'+
        this.content.replace(/[\r\n][\t ]*$/,'\n')+
        '});/*'+this.name+'*/\n';
    }
    
    // Lint (disable with "oui:nolint")
    // Only makes sense when we have a callback.
    if (callback) {
      var cl = this.content.length;
      this.content = this.content.replace(SOURCE_JSOPT_NOLINT_RE, '');
      if (cl === this.content.length) {
        var problems = this._lintJS();
        if (problems) {
          // Build jslint report and pass it on to <callback>
          sys.log(this.filename);
          var errors = problems.errors;
          //sys.debug(sys.inspect(errors, true, 10));
          var msg = ['[jslint] '+errors.length+' errors in '+
            cli.style(this.filename, 'yellow')+':'];
          errors.forEach(function(e){
            // format reason
            var reason = e.raw.replace(/\{([^{}]*)\}/g, function (a, b) {
              var r = e[b];
              if (typeof r === 'string' || typeof r === 'number')
                return cli.style(r, 'cyan');
              return a;
            });
            // Get line context
            var numLineContext = 2,
                start = Math.max(0, e.line-1-numLineContext),
                linesBefore = problems.lines.slice(start, start+numLineContext),
                linesAfter = problems.lines.slice(e.line, e.line+numLineContext);
            // oui-specific: remove __defm if first
            if (linesBefore.length) {
              linesBefore[0] = linesBefore[0].replace(
                /^__defm\(".+",\s*function\([^\)]+\)\s*\{\s*/, '');
            }
            // Build message
            msg.push(
            cli.style(
              ' '+reason+' at offset '+e.character.toString()+
              ' on '+cli.style('line '+e.line.toString(), 'yellow')+':'
            , 'bg:black'));
            msg.push(cli.style('  '+linesBefore.join('\n  '), 'grey'));
            msg.push('  '+e.evidence);
            msg.push(cli.style('  '+linesAfter.join('\n  '), 'grey'));
          });
        
          var err = new Error('jslint');
          err.file = this.filename;
          err.stack = msg.join('\n');
          return callback(err);
        }
      }
    }

    // Optimize (disable with "oui:unoptimized")
    if (this.builder.optimize > 0) {
      var cl = this.content.length;
      this.content = this.content.replace(SOURCE_JSOPT_UNOPTIMIZED_RE, '');
      if (cl === this.content.length) {
        var preSize = this.content.length;
        this.content = jsmin.jsmin('', this.content, this.builder.optimize);
        this.builder.log('optimized '+this+' -- '+
          Math.round((1.0-(parseFloat(this.content.length)/preSize))*100.0)+
          '% ('+(preSize-this.content.length)+' B) smaller', 2);
      }
    }

    if (callback) callback();
  },
  
  _lintJS: function() {
    var options = {
      browser: true, css: true, devel: true, evil: true, forin: true,
      fragment: true, laxbreak: true, newcap: true, on: true, eqeqeq: true,
      //plusplus: false,
      //passfail: true, // stop on first error
      predef: ['oui', '__defm']
    };
    var lines = this.content.split(/\n/);
    if (jslint.JSLINT(lines, options))
      return;
    var data = jslint.JSLINT.data();
    data.lines = lines;
    return data;
  },

  /// String rep
  toString: function() {
    return 'Source('+this.inputType+'('+this.type+'), '+sys.inspect(this.name)+')';
  }
});

// -------------------------------------------------------------------------

const BUILDER_DEFAULT_SRCFILTER = /^[^\.].*\.(?:js|css|sass|less|x?html?)$/i;

function Builder(srcDirs) {
  process.EventEmitter.call(this);
  this.srcDirs = Array.isArray(srcDirs) || [];
  this.srcFilter = BUILDER_DEFAULT_SRCFILTER;
  this.productsDir = 'build';
  this.productsName = 'index';
  this.sources = [];  // [Source, ..]
  this.products = {}; // {type: Product, ..}
  this.logLevel = 1; // 0: only errors, 1: info and warnings, 2: debug
  this.force = false; // ignore timestamps
}
sys.inherits(Builder, process.EventEmitter);

mixin(Builder.prototype, {
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
    this.log('--> Collecting', 2);
    var self = this, eve;//, didAddStdlib = false;
    eve = fs.find({
      dirnames: this.srcDirs,
      filter: this.srcFilter,
      unbuffered: true,
    }, callback);
    eve.addListener('file', function(relpath, abspath, ctx){
      var source;
      /*if (!didAddStdlib && self.stdlib && self.stdlibJSPath) {
        source = new Source(self, self.stdlibJSPath, '');
        self.sources.push(source);
        source.stat(ctx.cl.handle());
        didAddStdlib = true;
      }*/
      self.log('collect '+relpath, 2);
      source = new Source(self, abspath, relpath);
      self.sources.push(source);
      source.stat(ctx.cl.handle());
    });
  },

  demux: function(callback) {
    this.log('--> Demuxing', 2);
    var self = this;
    this.forEachSource(function(source, cl){
      source.demux(self.sources, cl);
    }, callback);
  },

  statProducts: function(callback) {
    this.log('--> Stating products', 2);
    this.setupProducts();
    this.forEachProduct(function(product, cl){
      product.stat(cl);
    }, callback);
  },

  compile: function(callback) {
    this.log('--> Compiling', 2);
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
    var self = this;
    this.log('--> Writing products to '+this.productsDir, 2);
    var rcb = new util.RCB(callback);
    rcb.open();
    this.forEachProduct(function(product, cl){
      product.output(function(err, wrote){
        if (wrote) self.log('> '+product.filename, 1);
        cl(err);
      });
    }, rcb);
    rcb.close();
  },

  all: function(callback) {
    var queue = new util.CallQueue(this, false, callback);
    queue.push([
      this.collectSources,
      function(cl){ this.emit('collect'); cl(); },
      this.demux,
      function(cl){ this.log('Sources: '+this.sources.join('\n'), 2); cl(); },
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
