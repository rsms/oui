
/** Application */
oui.Application = function() {
	this.capabilities = new Capabilities();
	this.automaticallyPresentsErrors = false;
}
oui.mixin(oui.Application.prototype, oui.EventEmitter.prototype, {
	main: function(){
		this.session = new Session(this);
		this.emit('boot');
		var self = this;
		$(function(){
			self.emit('start');
			if (self.session)
				self.session.open();
		});
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
		if (!ui.alert) return;
		var details;
		if (oui.debug) {
			details = (typeof error.data === 'object') ? error.data : {};
			details = $.extend(details, {
				error: error.error,
				origin: error.origin,
				event: error.event
			});
		}
		return ui.alert.show(error.message, error.description, details);
	}
});

oui.app = new oui.Application();
