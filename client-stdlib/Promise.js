function Promise(context){
	this.context = context;
	this.result = null;
	var self = this;
	this.on('success', function(){
		self.result = 'success';
		self.resultArgs = [];
		for (var i=0;i<arguments.length;i++)
			self.resultArgs.push(arguments[i]);
	});
	this.on('error', function(){
		self.result = 'error';
		self.resultArgs = [];
		for (var i=0;i<arguments.length;i++)
			self.resultArgs.push(arguments[i]);
	});
}

mix(Promise, EventEmitter, function(P){
	P.addCallback = function(listener) {
		var self = this;
		this.on('success', function(){
			return listener.apply(self.context || self, arguments);
		});
		if (this.result === 'success')
			listener.apply(this.context || this, this.resultArgs);
		return this;
	}
	P.addErrback = function(listener) {
		this.on('error', function(){
			return listener.apply(self.context || self, arguments);
		});
		if (this.result === 'error')
			listener.apply(this.context || this, this.resultArgs);
		return this;
	}

	P.emitSuccess = function() {
		var args = [];
		for (var i=0;i<arguments.length;i++)
			args.push(arguments[i]);
		return this.emitv('success', args);
	}	
	P.emitError = function() {
		var args = [];
		for (var i=0;i<arguments.length;i++)
			args.push(arguments[i]);
		return this.emitv('error', args);
	}
});
