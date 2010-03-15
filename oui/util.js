var sys = require('sys');

// Recursive closure
function RCB(depth, callback) {
  if (typeof depth === 'function') {
    callback = depth;
    depth = 0;
  }
  else if (typeof depth !== 'number') {
    depth = 0;
  }
  
  this.depth = depth;
  this.callback = callback;
  var self = this;
  
  // close (decr)
  this.close = function(err) {
    //sys.debug('close('+err+')  '+self.depth)
    if (err) self.depth = 0; else self.depth--;
    if (self.depth === 0) {
      self.depth = -1;
      if (self.callback)
        self.callback.apply(self, Array.prototype.slice.call(arguments));
    }
    return self;
  }
  
  this.open = function(){
    //sys.debug('open()  '+self.depth)
    self.depth++;
    return self;
  }
  
  // produce a callback (which must be called)
  this.handle = function(cb2){
    //sys.debug('open()  '+self.depth)
    self.depth++;
    if (cb2) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        cb2.apply(self, args);
        return self.close.apply(self, args);
      }
    }
    else {
      return self.close;
    }
  };
}
exports.RCB = RCB;
sys.inherits(exports.RCB, process.EventEmitter);
