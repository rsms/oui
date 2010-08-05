// oui:untangled
// mustacho.js — Logic-less templates in JavaScript (based on mustache.js)
// See http://mustache.github.com/ for more info.

if (!String.prototype.trim) {
  String.prototype.trim = function() {
    return this.replace(/^(?:\s|\u00A0)+/, '').replace(/(?:\s|\u00A0)+$/, '');
  };
}
if (!Array.isArray) {
  if (jQuery && jQuery.isArray) {
    Array.isArray = jQuery.isArray;
  } else {
    Array.isArray = function(obj) {
      return Object.prototype.toString.call(obj) === "[object Array]";
    };
  }
}
if (!Array.prototype.map) {
  Array.prototype.map = function(fun, ctx) {
    var len = this.length >>> 0, res = new Array(len);
    for (var i = 0; i < len; ++i) {
      if (i in this) {
        res[i] = fun.call(ctx, this[i], i, this);
      }
    }
    return res;
  };
}

(function(exports) {
  exports.implementedPragmas = {"IMPLICIT-ITERATOR": true};
  exports.decodeCurlyBraces =
    navigator && navigator.userAgent.indexOf('Firefox') !== -1;
  function isObject(a) { return a && typeof a === "object"; }
  function Renderer() {}
  exports.Renderer = Renderer;
  Renderer.prototype = {
    otag: "{{",
    ctag: "}}",
    pragmas: {},
    buffer: [],
    context: {},
    partialMaxDepth: 10,

    render: function(template, context, partials, inRecursion) {
      var templateObj;
      if (typeof template === 'object') {
        templateObj = template; // saved since it's used further down
        if (templateObj.preMustachoFilter) {
          template = templateObj.preMustachoFilter.call(templateObj, this,
                                                        context, partials);
        }
      }
      if (typeof template !== 'string')
        template = String(template);
      if (exports.decodeCurlyBraces)
        template = template.replace(/%7[Bb]/g, '{').replace(/%7[Dd]/g, '}');
      // reset buffer & set context
      if (!inRecursion) {
        this.context = context;
        this.buffer = []; // TODO: make this non-lazy
      }

      // fail fast
      if (template.length === 0) {
        if (inRecursion) {
          return template;
        } else {
          this.send(template);
          return;
        }
      }

      var s = this.renderPragmas(template);
      s = this.renderSection(s, context, partials);
      s = this.renderTags(s, context, partials, inRecursion);
      
      if (inRecursion) {
        if (templateObj && templateObj.postMustachoFilter) {
          s = templateObj.postMustachoFilter.call(templateObj, s, this, context,
                                                  partials);
        }
        return s;
      }
    },

    /*
      Sends parsed lines
    */
    send: function(line) {
      this.buffer.push(line);
    },

    /*
      Looks for %PRAGMAS
    */
    renderPragmas: function(template) {
      // no pragmas
      if (!this.includes("%", template)) {
        return template;
      }

      var that = this;
      var regex = new RegExp(this.otag + "%([\\w-]+) ?([\\w]+=[\\w]+)?" +
            this.ctag);
      return template.replace(regex, function(match, pragma, options) {
        if (!exports.implementedPragmas[pragma]) {
          throw new Error(
            "This implementation of mustache doesn't understand the '" +
            pragma + "' pragma");
        }
        that.pragmas[pragma] = {};
        if (options) {
          var opts = options.split("=");
          that.pragmas[pragma][opts[0]] = opts[1];
        }
        return "";
        // ignore unknown pragmas silently
      });
    },

    /*
      Tries to find a partial in the curent scope and render it
    */
    renderPartial: function(name, context, partials) {
      name = name.trim();
      var partial;
      if (!partials || (partial = partials[name]) === undefined) {
        throw new Error("unknown_partial '" + name + "'");
      }
      if (!this.partialMaxDepth)
        throw new Error('max recursion depth for mustacho partials');
      //if (typeof context[name] === "object") {
      //  return this.render(partials[name], context[name], partials, true);
      //};
      --this.partialMaxDepth;
      partial = this.render(partial, context, partials, true);
      ++this.partialMaxDepth;
      return partial;
    },

    /**
     * Renders positive boolean (?), negative boolean (^) and repeating (#)
     * sections.
     */
    renderSection: function(template, context, partials) {
      if (!this.includes("#", template)
          && !this.includes("?", template)
          && !this.includes("^", template)) {
        return template;
      }

      var that = this;
      // CSW - Added "+?" so it finds the tighest bound, not the widest
      var regex = new RegExp(this.otag + "(\\^|\\#|\\?)\\s*(.+)\\s*" + this.ctag +
              "\n*([\\s\\S]+?)" + this.otag + "\\/\\s*\\2\\s*" + this.ctag +
              "[\r\n]?", "mg");

      // for each {{#foo}}{{/foo}} section do...
      return template.replace(regex, function(match, type, name, content) {
        var value = that.find(name, context);
        if (type === "?") { // boolean positive section
          if (!(!value || (Array.isArray(value) && value.length === 0))) {
            return that.render(content, context, partials, true);
          } else {
            return "";
          }
        } else if (type === "^") { // boolean negative section
          if (!value || (Array.isArray(value) && value.length === 0)) {
            return that.render(content, context, partials, true);
          } else {
            return "";
          }
        } else if (type === "#") { // normal section
          if (Array.isArray(value)) { // Enumerable, Let's loop!
            return value.map(function(row) {
              return that.render(content, that.createContext(row),
                partials, true);
            }).join("");
          } else if (isObject(value)) { // Object, Use it as subcontext!
            return that.render(content, that.createContext(value),
              partials, true);
          } else if (typeof value === "function") {
            // higher order section
            return value.call(context, content, function(text) {
              return that.render(text, context, partials, true);
            });
          } else if (value) { // boolean section
            return that.render(content, context, partials, true);
          } else {
            return "";
          }
        }
      });
    },

    /*
      Replace {{foo}} and friends with values from our view
    */
    renderTags: function(template, context, partials, inRecursion) {
      // tit for tat
      var that = this;
      var mkRegex = function() {
        return new RegExp(that.otag +
          "(=|!|>|\\{|%)?([^\\/#\\^\\?](?:.+?|))\\1?" +
          that.ctag + "+", "g");
      };

      var tagReplaceCallback = function(match, operator, name) {
        switch(operator) {
        case "!": // ignore comments
          return "";
        case "=": // set new delimiters, rebuild the replace regexp
          that.setDelimiters(name);
          regex = mkRegex();
          return "";
        case ">": // render partial
          return that.renderPartial(name, context, partials);
        case "{": // the triple mustache is unescaped
          return that.find(name, context);
        default: // escape the value
          return that.escape(that.find(name, context));
        }
      };
      var regex = mkRegex();
      var lines = template.split("\n");
      for(var i = 0; i < lines.length; i++) {
        lines[i] = lines[i].replace(regex, tagReplaceCallback, this);
        if (!inRecursion) {
          this.send(lines[i]);
        }
      }

      if (inRecursion) {
        return lines.join("\n");
      }
    },

    /*
      Replace {\{foo}} with {{foo}} (escaped)
    */
    expandUntouchables: function(template) {
      return template.replace(/\{\\\{(.+?)\}\}/g, '{{$1}}')
        .replace(/\{\\\\\{(.+?)\}\}/g, '{\\{$1}}');
    },

    setDelimiters: function(delimiters) {
      var dels = delimiters.split(" ");
      this.otag = this.escapeRegExp(dels[0]);
      this.ctag = this.escapeRegExp(dels[1]);
    },

    escapeRegExp: function(text) {
      // thank you Simon Willison
      if (!arguments.callee.sRE) {
        var specials = [
          '/', '.', '*', '+', '?', '|',
          '(', ')', '[', ']', '{', '}', '\\'
        ];
        arguments.callee.sRE = new RegExp(
          '(\\' + specials.join('|\\') + ')', 'g'
        );
      }
      return text.replace(arguments.callee.sRE, '\\$1');
    },

    /**
     * Find `name` in current `context`.
     */
    find: function(name, context) {
      name = name.trim();
      var names = name === '.' ? name : name.split('.'),
          value = context, i, parent = context;
      for (i=0;(name = names[i]);++i) {
        parent = value;
        value = value[name];
        if (value === undefined && i === 0) {
          value = this.context[name];
        }
        if ((typeof value !== "object") && 
            (typeof value !== "function" || i === names.length-1)) {
          break;
        }
      }
      if (value === undefined) {
        return "";
      } else if (typeof value === "function") {
        return value.apply(names.length > 1 ? parent : context);
      }
      return value;
    },

    // Utility methods

    /* includes tag */
    includes: function(needle, haystack) {
      return haystack.indexOf(this.otag + needle) !== -1;
    },

    /*
      Does away with nasty characters
    */
    escape: function(s) {
      s = String(s === null ? "" : s);
      s = s.replace(/&(?!\w+;)|["<>\\]/g, function(s) {
        switch(s) {
        case "&": return "&amp;";
        case "\\": return "\\\\";
        case '"': return '\"';
        case "<": return "&lt;";
        case ">": return "&gt;";
        default: return s;
        }
      });
      s = s.replace(/\{\{(.+?)\}\}/g, '{\\{$1}}');
      return s;
    },

    // by @langalex, support for arrays of strings
    createContext: function(_context) {
      if (isObject(_context)) {
        return _context;
      } else {
        var iterator = ".";
        if (this.pragmas["IMPLICIT-ITERATOR"]) {
          iterator = this.pragmas["IMPLICIT-ITERATOR"].iterator;
        }
        var ctx = {};
        ctx[iterator] = _context;
        return ctx;
      }
    }
  };
  
  /**
   * Render a template with a context.
   *
   * render(template[, context[, partials[, sendFun][, 
   *        dontExpandUntouchables]]]) -> string
   */
  function render(template, context, partials, sendFun, dontExpandUntouchables){
    if (typeof sendFun === "boolean") {
      dontExpandUntouchables = sendFun;
      sendFun = null;
    }
    var renderer = new Renderer();
    if (sendFun) {
      renderer.send = sendFun;
    }
    renderer.render(template, context, partials);
    if (!sendFun) {
      var s = renderer.buffer.join("\n");
      if (!dontExpandUntouchables) {
        s = renderer.expandUntouchables(s);
      }
      //s = s.replace(/\{\\\\\{/g, '{\\{');
      return s;
    }
  }
  exports.render = render;

// namespace
})(window.mustacho = {});
