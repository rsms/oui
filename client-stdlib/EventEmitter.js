function EventEmitter () {}
mix(EventEmitter, function(P){
	P.addListener = function(type, once, listener) {
		if (typeof once === 'function') {
			listener = once;
			once = false;
		}
		if (once)
			$(this).once(type, listener);
		else
			$(this).bind(type, listener);
		return this;
	}
	
	P.on = function(type, once, listener) {
		return this.addListener(type, once, listener);
	}
	
	P.removeListener = function(type, listener) {
		$(this).unbind(type, listener);
		return this;
	}
	
	P.emit = function(type /*[, arg[, ..]]*/) {
		var args = [];
		for (var i=1;i<arguments.length;i++)
			args.push(arguments[i]);
		return this.emitv(type, args);
	}
	
	P.emitv = function(type, args) {
		$(this).triggerHandler(type, args);
		return this;
	}
	
	// both emits an event and calls any functions on bound
	// objects with the same name as <type>
	P.trigger = function(type /*[, arg[, ..]]*/) {
		var metaargs = [];
		for (var i=1;i<arguments.length;i++)
			metaargs.push(arguments[i]);
		$(this).trigger(type, metaargs);
		return this;
	}
});
