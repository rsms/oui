var sys = require('sys');

function dbgstack() {
  return (new Error()).stack.split(/\n/).slice(3).join('\n').trim();
}

// Recursive closure
function RCB(depth, callback) {
  if (typeof depth === 'function') {
    callback = depth;
    depth = 0;
  }
  else if (typeof depth !== 'number') {
    depth = 0;
  }

  //this.debug = true;
  this.depth = depth;
  this.callback = callback;
  var self = this;

  // close (decr)
  this.close = function(err) {
    if (err) self.depth = 0; else self.depth--;
    if(self.debug) sys.debug('close('+err+')  '+self.depth+' '+dbgstack())
    if (self.depth === 0) {
      self.depth = -1;
      if (self.callback)
        self.callback.apply(self, Array.prototype.slice.call(arguments));
    }
    return self;
  }

  this.open = function(){
    self.depth++;
    if(self.debug) sys.debug('open()  '+self.depth+' '+dbgstack())
    return self;
  }

  // produce a callback (which must be called)
  this.handle = function(cb2){
    self.depth++;
    if(self.debug) sys.debug('handle()  '+self.depth+' '+dbgstack())
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

// -----------------------------------------------------------------------------
// Sequential execution

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
  //this.fired = false;
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

CallQueue.prototype.unshift = function(callable) {
  if (this.error)
    throw new Error(this+' is closed because of a previous error');
  this.queue.unshift(callable);
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

// -----------------------------------------------------------------------------
// Input sanitation

exports.urlRegExp = /\b(([\w-]+:\/\/?|www[.])[^\s()<>]+(?:\([\w\d]+\)|([^[:punct:]\s]|\/)))/;
exports.emailRegExp = /^[^@]+@[^@]+\.[^@]+$/;

exports.sanitizeInput = function (params, dst, accepts) {
  var k, e, type, def, value, ok, dstbuf = {};
  for (k in accepts) { def = accepts[k];
    // not set?
    if (!(k in params) || (value = params[k]) === undefined) {
      // required and missing?
      if (def.required) {
        return ((e = new Error('missing parameter "'+k+'"'))
            && (e.statusCode = 400) && e);
      }
      // it's optional, so lets simply skip it
      continue;
    }
    // retrieve value
    value = params[k];
    type = typeof value;
    // check type
    if (def.type) {
      if (def.type === 'array') {
        ok = Array.isArray(value);
      } else if (def.type === 'url') {
        ok = String(value).match(exports.urlRegExp);
      } else if (def.type === 'email') {
        ok = String(value).match(exports.emailRegExp);
      } else if (def.type.substr(0,3) === 'int') {
        if ((ok = (type === 'number')))
          value = Math.round(value);
      } else if ((ok = (def.type === type)) && (def.type === 'number')) {
        ok = !isNaN(value);
      }
      if (!ok) {
        return ((e = new Error('bad type of parameter "'+k+'" -- expected '+def.type))
            && (e.statusCode = 400) && e);
      }
    }
    // trim strings
    if (type === 'string') {
      value = value.trim();
    }
    // empty string?
    if (def.empty !== undefined && !def.empty && type !== 'number') {
      ok = true;
      if (type === 'string') {
        ok = (value.length !== 0);
      } else if (type === 'object') {
        ok = (Array.isArray(value) ? value.length : Object.keys(value).length) !== 0;
      }
      if (!ok) {
        return ((e = new Error('empty parameter "'+k+'"'))
            && (e.statusCode = 400) && e);
      }
    }
    // check regexp match
    if (def.match && !String(value).match(def.match)) {
      return ((e = new Error('bad format of argument "'+k+'" -- expected '+def.match))
          && (e.statusCode = 400) && e);
    }
    // post-filter
    if (typeof def.filter === 'function') {
      value = def.filter(value);
    }
    // accepted
    dstbuf[k] = value;
  }
  // all ok -- apply dstbuf to dst
  for (k in dstbuf) dst[k] = dstbuf[k];
  // return a false value to indicate there was no error
  return null;
}
