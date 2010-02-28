var sys = require('sys');

function CallQueue(context, autostart, callback) {
  if (typeof autostart === 'function') {
    callback = autostart;
    autostart = undefined;
  }
  this.queue = [];
  this.autostart = autostart === undefined ? true : autostart;
  this.context = context || this;
  this.callback = callback;
  this.callbackArgs = [];
  this.stopped = true;
  this.fired = false;
  var self = this;
  this.closure = function(err, queueopt){
    // queueopt is an object in order to guard from ambigous input
    if (queueopt && Array.isArray(queueopt.args))
      self.callbackArgs = queueopt.args;
    if (err) {
      self.error = err;
      self.stopped = true;
      self.queue = [];
      if (self.callback && !self.fired) {
        self.callback.apply(self, [err].concat(self.callbackArgs));
        self.fired = true;
      }
    }
    else {
      if (queueopt && queueopt.unroll) {
        // will cause self.performNext to call callback, finalizing the queue
        self.stopped = true;
        self.queue = [];
      }
      else {
        self.queue.shift(); // dequeue finalized
      }
      self.performNext();
    }
  }
}
exports.CallQueue = CallQueue;

CallQueue.prototype.toString = function() {
  return 'CallQueue('+
    'stopped='+sys.inspect(this.stopped)+
    ',context='+String(this.context).substr(0,25)+
    ',queue.length='+this.queue.length+
    ')';
}

CallQueue.prototype.start = function(callback) {
  this.stopped = false;
  if (callback && this.callback !== callback) {
    if (this.callback) this.callback();
    this.callback = callback;
  }
  this.performNext();
  return this;
}

CallQueue.prototype.stop = function() {
  this.stopped = true;
}

CallQueue.prototype.pushPrioritized = function(callable) {
  if (this.error)
    throw new Error(this+' is closed because of a previous error');
  if (this.stopped)
    this.queue.unshift(callable);
  else
    this.queue.splice(1,0,[callable]);
  if (this.queue.length === 1 && this.autostart && this.stopped)
    this.start();
}

CallQueue.prototype.push = function(callable) {
  if (Array.isArray(callable)) {
    var self = this;
    callable.forEach(function(item){ self.push(item); });
    return;
  }
  if (this.error)
    throw new Error(this+' is closed because of a previous error');
  this.queue.push(callable);
  if (this.queue.length === 1 && this.autostart && this.stopped)
    this.start();
}

CallQueue.prototype.performNext = function() {
  if (!this.autostart) this.autostart = true; // if more are push() ed
  var callable = this.queue[0];
  if (callable && !this.stopped) {
    callable.call(this.context, this.closure);
  }
  else {
    // queue is empty or this.stopped
    if (this.callback && !this.fired) {
      this.callback.apply(this, [undefined].concat(this.callbackArgs));
      this.fired = true;
    }
    this.autostart = false;
  }
}
