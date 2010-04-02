// Available transports, ordered: better -> worse
exports.preferred = ['websocket', 'server_events', 'flashsocket', 'htmlfile',
                     'xhr_multipart', 'xhr_polling'];

// Base proto
exports.Transport = function(options) {
  this.options = {
    // Defaults
    path: oui.pipe.basePath,
    format: 'json'

    // Required:
    // channel: string

    // Over-riding oui.backend:
    // host: string,
    // port: int,
    // secure: bool
  };
  if (typeof options === 'object') {
    oui.mixin(this.options, options);
  } else if (typeof options === 'string') {
    this.options.channel = options;
  } else { 
    throw new Error('missing channel in options');
  }
};
oui.mixin(exports.Transport.prototype, oui.EventEmitter.prototype, {
  // Opens the connection. Returns false if already connected, otherwise true.
  connect: function(backend, callback) {
    /* stub */
    if (typeof backend === 'function') {
      callback = backend;
      backend = undefined;
    } else {
      this.lastBackend = backend;
    }
  },

  // Returns true if data was sent or queued, otherwise false is returned (if
  // the socket is closed or is closing).
  send: function(data) { /* stub */ },

  // Disconnect
  disconnect: function(callback) { /* stub */ },

  // Backend used for new connections
  backend: function() {
    if (this.options.host) {
      this.lastBackend = {
        host: this.options.host,
        port: this.options.port || 80,
        secure: this.options.secure
      };
    }
    return this.lastBackend;
  },

  // Format a message before sending it, encoding to options.format if needed.
  _formatMessage: function(data) {
    if (this.options.format && this.options.format === 'json' && typeof data !== 'string')
      data = JSON.stringify(data);
    return data;
  },

  // Parse and emit an incoming message, decoding if needed.
  _handleMessage: function(data) {
    if (this.options.format && this.options.format === 'json') {
      if (data.length) {
        try {
          this.emit('message', JSON.parse(data));
        } catch (e) {
          this.emit('error', e);
        }
      } else {
        this.emit('message', {});
      }
    } else {
      return this.emit('message', data);
    }
  }
});

// Selects and returns the most appropriate transport for the current host.
exports.best = function() {
  if (exports._best) return exports._best;
  for (var i=0, k; (k = exports.preferred[i]); i++){
    var transport = exports[k];
    if (transport && transport.Transport && transport.isUseable())
      return (exports._best = transport.Transport);
      // future: to save memory, we _could_ delete all but the best transport.
  }
};
