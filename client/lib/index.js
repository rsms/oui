// oui:untangled
/**
 * Oui client standard library.
 */
window.oui = {};
if (window.OUI_DEBUG) window.oui.debug = true;
window.APP_VERSION = "{#APP_VERSION#}"; // todo: move to oui.app

// sophisticated client?
if (   typeof Object.getOwnPropertyNames === 'function'
    && typeof Object.getOwnPropertyDescriptor === 'function'
    && typeof Array.prototype.forEach === 'function')
{
  window.oui.mixin = function(target) {
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
}
else {
  window.oui.mixin = function(target) {
    var i = 1, length = arguments.length, source, value;
    for ( ; i < length; i++ ) {
      // Only deal with defined values
      if ( (source = arguments[i]) !== undefined ) {
        for (var k in source) {
          value = source[k];
          if (target !== value)
            target[k] = value;
        }
      }
    }
    return target;
  };
}

// Define a module
window.__defm = function(name, root, html, fun) {
  if (arguments.length === 2) {
    fun = root;
    root = window;
  }
  else if (arguments.length === 3) {
    fun = html;
    html = null;
  }

  if (!html) {
    html = function(query){
      if (!html._jQuery) {
        html._jQuery = jQuery('#'+name.replace(/\./g, '-'));
      }
      return query ? html._jQuery.find(query).clone() : html._jQuery;
    };
  }

  var module = {$html: html},
      namep = name.split('.'),
      curr = root, n, i = 0, L = namep.length-1;

  for ( ; i<L; i++) {
    n = namep[i];
    if (curr[n] === undefined)
      curr[n] = {};
    curr = curr[n];
  }

  // this, exports, __name, __html, __parent
  fun.call(module, module, name, html, curr);

  var mname = namep[i], parent = curr[mname];
  if (parent !== undefined) {
    var t = typeof parent;
    if (t === 'object' || t === 'function') {
      window.oui.mixin(parent, module);
    } else {
      for (var k in module) {
        console.warn('tried to overwrite module "'+name+'"');
        break;
      }
    }
  } else {
    curr[mname] = module;
  }
};

// oui module
__defm('oui', window, function(exports, __name, __html){

var EMPTYFUNC = function(){};

/** The console interface */
if (window.console === undefined || !window.oui.debug) {
  window.console = {
    log:EMPTYFUNC,
    warn:EMPTYFUNC,
    error:EMPTYFUNC,
    group:EMPTYFUNC,
    groupEnd:EMPTYFUNC,
    assert:EMPTYFUNC
  };
}
else {
  if (console.log===undefined)console.log=EMPTYFUNC;
  if (console.warn===undefined)console.warn=EMPTYFUNC;
  if (console.error===undefined)console.error=EMPTYFUNC;
  if (console.group===undefined)console.group=EMPTYFUNC;
  if (console.groupEnd===undefined)console.groupEnd=EMPTYFUNC;
  if (console.assert===undefined)console.assert=EMPTYFUNC;
  if (Object.prototype.__defineGetter__) {
    window.OUI_HELP = {
      sections: {
        0: // intro
          "Welcome to OUI",
        Examples:
          "  Sending a GET query through session:\n"+
          "    oui.app.session.get('some/method', function(err, result, resp) {\n"+
          "      console.log(err, result, resp); });\n"
      },
      displayFunc: function () {
        if (window.OUI_HELP.sections) {
          var title, haveTitle;
          for (title in window.OUI_HELP.sections) {
            haveTitle = String(title).match(/[^0-9]/);
            if (haveTitle)
              console.group(title);
            console.log(window.OUI_HELP.sections[title]);
            if (haveTitle)
              console.groupEnd();
          }
        }
        return window.oui;
      }
    };
    window.__defineGetter__("help", window.OUI_HELP.displayFunc);
  }
}

/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be revritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 * @param {object} prototypeMixin Optional object to mix in with the prototype.
 *
 * Returns the prototype of ctor.
 */
window.oui.inherits = function (ctor, superCtor, prototypeMixin) {
  var tempCtor = function(){};
  tempCtor.prototype = superCtor.prototype;
  ctor.super_ = superCtor;
  ctor.prototype = new tempCtor();
  ctor.prototype.constructor = ctor;
  if (prototypeMixin)
    window.oui.mixin(ctor.prototype, prototypeMixin);
  return ctor.prototype;
};


// URL encode
exports.urlesc = function(s) { return encodeURIComponent(String(s)); };

// HTML encode
var re0 = /&/g, re1 = /</g, re2 = />/g, re3 = /"/g, re4 = /'/g,
    recrlf1 = /[\n\r]/g, recrlf2 = /[\n\r]{2,}/g;
exports.htmlesc = function(s, nl2br) {
  // <>&'"
  // &#60;&#62;&#38;&#39;&#34;
  s = String(s).replace(re0, '&#38;').
    replace(re1, '&#60;').replace(re2, '&#62;').
    replace(re3, '&#34;').replace(re4, '&#39;');
  if (nl2br)
    return s.replace(recrlf2, '<br><br>').replace(recrlf1, '<br>');
  return s;
};


exports.EventEmitter = function() {
};
window.oui.mixin(exports.EventEmitter.prototype, {
  addListener: function(type, once, listener) {
    if (typeof once === 'function') {
      listener = once;
      once = false;
    }
    if (once) {
      $(this.eventTarget || this).one(type, listener);
    } else {
      $(this.eventTarget || this).bind(type, listener);
    }
    return this;
  },

  on: function(type, once, listener) {
    return this.addListener(type, once, listener);
  },

  removeListener: function(type, listener) {
    $(this.eventTarget || this).unbind(type, listener);
    return this;
  },

  emit: function(type /*[, arg[, ..]]*/) {
    var args = [];
    for (var i=1;i<arguments.length;i++)
      args.push(arguments[i]);
    return this.emitv(type, args);
  },

  emitv: function(type, args) {
    $(this.eventTarget || this).triggerHandler(type, args);
    return this;
  },

  // both emits an event and calls any functions on bound
  // objects with the same name as <type>
  trigger: function(type /*[, arg[, ..]]*/) {
    var metaargs = [];
    for (var i=1;i<arguments.length;i++)
      metaargs.push(arguments[i]);
    $(this.eventTarget || this).trigger(type, metaargs);
    return this;
  }
});

// capabilities
exports.capabilities = {
  cors: (window.XMLHttpRequest &&
    ((new XMLHttpRequest()).withCredentials !== undefined || window.XDomainRequest)),
  webSocket: window.WebSocket && !window.WebSocket.__initialize
};


});
