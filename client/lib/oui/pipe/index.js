var _pipes = {};

// URL base path
exports.basePath = '/pipe';

// Aquire a named pipe.
exports.get = function(id) {
  return _pipes[id] || (_pipes[id] = new Pipe(id));
};

/**
 * A pipe emits the following events:
 *
 *   open     (event)
 *   message  (event, object)
 *   error    (event, error)
 *   close    (event)
 */
var Pipe = exports.pipe = function(id) {
  this.id = id;
  var T = exports.transport.best();
  if (!T) throw new Error('No pipe transports available for the current host system');
  this.transport = new T({ channel: this.id });
  this.transport.on('error', function(ev, err) {
    oui.backend.reportError(err, this.lastBackend);
  });
  // delegate event handling to the transport
  this.eventTarget = this.transport;
};

oui.mixin(Pipe.prototype, oui.EventEmitter.prototype, {

  // Send a message
  send: function(message, callback) {
    var self = this;
    oui.backend.retry($.proxy(self.transport.connect, self.transport), function(err){
      if (err) return callback && callback(err);
      var sentOrQueued = self.transport.send(message);
      if (callback) callback(null, sentOrQueued);
    });
  }

});
