
/** Application */
exports.Application = function() {
  this.automaticallyPresentsErrors = false;
  // this.session is set when the session module initialized
};
oui.inherits(exports.Application, oui.EventEmitter, {
  main: function(){
    if (this._mainCalled) throw new Error('main has already been invoked');
    this._mainCalled = true;
    this.emit('boot');
    var self = this;
    $(function(){
      if ((self.session && self.session.id) || oui.cookie.get('auth_token')) {
        // re-establish session if we have a saved session id, or auth_token
        self.emit('start', true);
        self.session.establish();
      } else {
        self.emit('start', false);
      }
    });
    return this;
  },

  /**
   * Causes a uniform error object to be emitted for "error".
   * The object looks like this:
   *
   * {
   *   message:      <String>
   *   [description: <String>]
   *   [error:       <Object>]
   *   [origin:      <Object>]
   *   [event:       <Event>]
   *   [data:        <Object>]
   * }
   *
   * [A] means A is optional (i.e. not an array)
   *
   * The <msgOrErrorObject> argument can be an error object or a message string.
   */
  emitError: function(msgOrErrorObject, origin, error, ev, data) {
    var err = (typeof msgOrErrorObject === 'object') ? msgOrErrorObject : {};
    if (error) err.error = error;
    if (origin) err.origin = origin;
    if (ev) err.event = ev;
    if (data) err.data = data;
    if (!err.message)
      err.message = err.error ? String(err.error) : 'Unspecified error';
    console.warn('Error:', err);
    this.emit('error', err);
    if (this.automaticallyPresentsErrors)
      this.presentError(err);
  },

  presentError: function(error) {
    if (!oui.ui.alert) return;
    var details;
    if (oui.debug) {
      details = (typeof error.data === 'object') ? error.data : {};
      details = $.extend(details, {
        error: error.error,
        origin: error.origin,
        event: error.event
      });
    }
    return oui.ui.alert.show(error.message, error.description, details);
  }
});

oui.app = new exports.Application();
