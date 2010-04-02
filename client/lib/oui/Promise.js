/*

********** DEPRECATED ***********

Please use the callback style instead. Promises will be out-phased from oui.js.

*/
oui.Promise = function(context){
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
};

oui.mixin(oui.Promise.prototype, oui.EventEmitter.prototype, {
  addCallback: function(listener) {
    var self = this;
    this.on('success', function(){
      return listener.apply(self.context || self, arguments);
    });
    if (this.result === 'success')
      listener.apply(this.context || this, this.resultArgs);
    return this;
  },

  addErrback: function(listener) {
    this.on('error', function(){
      return listener.apply(self.context || self, arguments);
    });
    if (this.result === 'error')
      listener.apply(this.context || this, this.resultArgs);
    return this;
  },

  emitSuccess: function() {
    var args = [];
    for (var i=0;i<arguments.length;i++)
      args.push(arguments[i]);
    return this.emitv('success', args);
  },

  emitError: function() {
    var args = [];
    for (var i=0;i<arguments.length;i++)
      args.push(arguments[i]);
    return this.emitv('error', args);
  }
});
