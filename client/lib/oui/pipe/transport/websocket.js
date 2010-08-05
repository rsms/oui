// WebSocket -- http://dev.w3.org/html5/websockets/

exports.isUseable = function(){
  return oui.capabilities.webSocket;
};

exports.Transport = function(options) {
  exports.parent.Transport.call(this, options);
};

oui.mixin(exports.Transport.prototype, exports.parent.Transport.prototype, {

  connect: function(backend, callback) {
    var self = this;
    if (typeof backend === 'function') {
      callback = backend;
      backend = undefined;
    } else {
      this.lastBackend = backend;
    }
    if (this.socket) {
      var rs = this.socket.readyState;
      if (rs === WebSocket.OPEN) {
        if (callback) callback();
        return false;
      }
      else if (rs === WebSocket.CONNECTING) {
        if (callback) this._addConnectCallback(callback);
        return false;
      }
      else if (rs === WebSocket.CLOSING) {
        // Delay connect until properly closed
        $(this.socket).one('close', function(ev) {
          self.connect.apply(self, Array.prototype.slice(arguments));
        });
        return false;
      }
      // else it's CLOSED and we can crete a new connection
    }
    this.socket = new WebSocket(this._mkURL());
    this.socket.onopen = function(ev){ self.emit('open'); };
    this.socket.onmessage = function(ev){ self._handleMessage(ev.data); };
    this.socket.onerror = function(ev, err){ self.emit.apply(self, 'error', err); };
    this.socket.onclose = function(ev){ self.emit('close', ev.wasClean); };
    if (callback) this._addConnectCallback(callback);
    return true;
  },

  send: function(data){
    var sentOrQueued = this.socket.send(this._formatMessage(data));
    return sentOrQueued;
  },

  disconnect: function(callback){
    if (this.socket && this.socket.readyState === WebSocket.CLOSED)
      return callback && callback();
    this.socket.close();
    if (callback) this.on('close', true, function(){ callback(); });
  },

  _mkURL: function() {
    var backend = this.backend();
    return (backend.secure ? 'wss' : 'ws')+
      '://' + backend.host + ':' + backend.port + (backend.path || '')+
      this.options.path+ '/' + encodeURIComponent(this.options.channel)+
      '/websocket';
  },

  _addConnectCallback: function(callback) {
    var self = this;
    var onopen = function(){ cleanup(); callback(); };
    var onerr = function(ev, err){
      cleanup(); callback(err || new Error('unspecified WebSocket error'));
    };
    // some browsers do not emit error, but instead a close w/o any error info
    var onclose = function(ev){
      cleanup();
      var e = new Error('unspecified WebSocket connection error');
      e.event = ev;
      callback(e);
      self.emit('error', e);
    };
    var socketq = $(this.socket);
    var cleanup = function() {
      socketq.unbind('open',onopen).unbind('error',onerr).unbind('close',onclose);
    };
    socketq.one('open', onopen).one('error', onerr).one('close', onclose);
  }
});
