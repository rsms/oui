/* Global */

// Empty function
window.EMPTYFUNC = function(){}
var module = window;
window.APP_VERSION = "{#APP_VERSION#}";

// OUI_DEBUG can be set from location.hash if not set already
if (window.OUI_DEBUG === undefined && window.location.hash.indexOf('OUI_DEBUG') !== -1)
	window.OUI_DEBUG = true;

/** The console interface */
if (window.console === undefined || !window.OUI_DEBUG) {
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
 * Helper used by the module loader
 */
function __setmodule(name/*, root*/) {
	var root = window;
	if (arguments.length > 1)
		root = arguments[1];
	var v = name.split('.'), parent = root;
	for (var i=0;i<v.length;i++) {
		var n = name[i];
		if (typeof parent[n] !== 'object')
			parent[n] = {};
		parent[n].__parent = parent;
		parent = parent[n];
	}
	root.module = parent;
	root.module.name = name;
	return root.module;
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

/** URL encode */
function urlesc(s) {
	return encodeURIComponent(String(s));
}

/** HTML encode */
(function(){
	var re0 = /&/g,
	    re1 = /</g,
	    re2 = />/g,
	    re3 = /"/g,
	    re4 = /'/g,
	    recrlf1 = /[\n\r]/g,
	    recrlf2 = /[\n\r]{2,}/g;
	module.htmlesc = function(s, nl2br) {
		// <>&'"
		// &#60;&#62;&#38;&#39;&#34;
		s = String(s).replace(re0, '&#38;').
			replace(re1, '&#60;').replace(re2, '&#62;').
			replace(re3, '&#34;').replace(re4, '&#39;');
		if (nl2br)
			return s.replace(recrlf2, '<br><br>').replace(recrlf1, '<br>');
		return s;
	}
})();
