// oui:untangled
/**
 * Oui client standard library.
 */
window.oui = {};
window.APP_VERSION = "{#APP_VERSION#}"; // todo: move to oui.app

// sophisticated client?
if (   typeof Object.getOwnPropertyNames === 'function' 
    && typeof Object.getOwnPropertyDescriptor === 'function'
    && typeof [].forEach === 'function')
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
        });
      }
    }
    return target;
  };
}

// Define a module
window.__defineModule = function(name, root, fun) {
  if (arguments.length === 2) {
    fun = root;
    root = window.oui;
  }
  var module = {}, namep = name.split('.'), 
      curr = root, n, i = 0, L = namep.length-1;
  for ( ; i<L; i++) {
    n = namep[i];
    if (curr[n] === undefined)
      curr[n] = {};
    curr = curr[n];
  }
  fun.call(module, module, name);
  if (cs !== cs2) {
    var mname = namep[i];
    if (curr[mname] !== undefined) {
      var t = typeof curr[mname];
      if (t === 'object' || t === 'function') {
        window.oui.mixin(curr[mname], module);
      } else {
        for (var k in module) {
          console.warn('tried to overwrite module "'+name+'"');
          break;
        }
      }
      // else do nothing, don't overwrite
      // todo: maybe emot some kind of warning?
    } else {
      curr[namep[i]] = module;
    }
  }
};

// oui module
__defineModule('oui', window, function(exports, __name){

var EMPTYFUNC = function(){};

// OUI_DEBUG can be set from location.hash if not set already
if (exports.debug === undefined && window.location.hash.indexOf('OUI_DEBUG') !== -1)
	exports.debug = true;

/** The console interface */
if (window.console === undefined || !exports.debug) {
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
}

/**
 * Helper for building "classes".
 *
 *   T(function ctor, [function mixin, ..] [function modifier])
 *
 * Example:
 *
 *   function Animal(yearsOld){
 *     this.yearsOld = yearsOld || 4;
 *   }
 *   mix(Animal, function(P){
 *     P.daysOld = function() {
 *       return this.yearsAged * 365;
 *     }
 *   });
 *
 *   function Monkey(name, yearsOld){
 *     this.name = name;
 *     this.yearsOld = yearsOld;
 *   }
 *   mix(Monkey, Animal, Mammal, function(P){
 *     P.sayHello = function() {
 *       alert("Hello, my name is "+this.name+" and I'm "+this.daysOld()+" days old.");
 *     }
 *   });
 *   var m = new Monkey();
 */
function mix(ctor) {
	if (arguments.length < 2)
		throw 'too few arguments';
	var mixins = [];
	var modifier = undefined;
	
	if (arguments.length > 2) {
		var i = 1;
		for (;i<arguments.length-1;i++)
			mixins.push(arguments[i]);
		modifier = arguments[i];
	}
	else { // exactly 2 arguments
		modifier = arguments[1];
	}
	
	if (modifier && modifier.constructor !== EMPTYFUNC.constructor) {
		// last argument is not an anonymous function, so it's probably a mix-in.
		mixins.push(modifier);
		modifier = null;
	}
	
	for (var k in mixins) {
		var tempCtor = function(){};
		tempCtor.prototype = mixins[k].prototype;
		ctor.super_ = mixins[k];
		ctor.prototype = new tempCtor();
		ctor.prototype.constructor = ctor;
	}
	
	if (modifier)
		modifier(ctor.prototype);
}

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
}


exports.EventEmitter = function() {};
exports.mixin(exports.EventEmitter.prototype, {
	addListener: function(type, once, listener) {
		if (typeof once === 'function') {
			listener = once;
			once = false;
		}
		if (once)
			$(this).once(type, listener);
		else
			$(this).bind(type, listener);
		return this;
	},
	
	on: function(type, once, listener) {
		return this.addListener(type, once, listener);
	},
	
	removeListener: function(type, listener) {
		$(this).unbind(type, listener);
		return this;
	},
	
	emit: function(type /*[, arg[, ..]]*/) {
		var args = [];
		for (var i=1;i<arguments.length;i++)
			args.push(arguments[i]);
		return this.emitv(type, args);
	},
	
	emitv: function(type, args) {
		$(this).triggerHandler(type, args);
		return this;
	},
	
	// both emits an event and calls any functions on bound
	// objects with the same name as <type>
	trigger: function(type /*[, arg[, ..]]*/) {
		var metaargs = [];
		for (var i=1;i<arguments.length;i++)
			metaargs.push(arguments[i]);
		$(this).trigger(type, metaargs);
		return this;
	}
});


});