/*jslint browser: true, devel: true, laxbreak: true */

exports.Response = function(xhr, request, data) {
	this.xhr = xhr;
	this.request = request;
	this.data = data;
};

exports.Request = function(method, url) {
	this.method = method || 'GET';
	this.url = url || '';
	this.contentType = 'application/json'; // x-www-form-urlencoded
};

oui.mixin(exports.Request, oui.EventEmitter, {
	send: function(data, options, responseHandler) {
		// args
		if (typeof data === 'function') { responseHandler = data; data = undefined; }
		else if (typeof options === 'function') { responseHandler = options; options = undefined; }
		
		// default options
		var self = this;
		var opts = {
			type: this.method,
			url: this.url,
			data: data
		};
		
		// add custom options
		if (typeof options === 'object') opts = $.extend(opts, options);
		else options = false;
		
		// content-type
		if ((opts.type === 'POST' || opts.type === 'PUT') && !opts.contentType && this.contentType)
			opts.contentType = this.contentType;
		
		// empty undefined items
		if (typeof opts.data === 'object') {
			jQuery.each(opts.data, function(k, v) {
				if (v === undefined)
					opts.data[k] = '';
			});
		}
		
		// todo: remove this now?
		// _HAVE_XHR_ONERROR set?
		if (exports._HAVE_XHR_ONERROR === undefined) {
			var xhr = jQuery.ajaxSettings.xhr();
			exports._HAVE_XHR_ONERROR = false;
			for (var k in xhr) {
				if (k == 'onerror') {
					exports._HAVE_XHR_ONERROR = true;
					break;
				}
			}
			delete xhr;
		}
		
		// if the client supports xhr.onerror, add event emitter
		if (exports._HAVE_XHR_ONERROR) {
			opts.xhr = function() {
				var xhr = jQuery.ajaxSettings.xhr();
				xhr.onerror = function(ev, xhr) {
					opts.error(xhr, 'error', 'connectionerror');
				};
				return xhr;
			};
		}
		
		// set handlers here to avoid options to over-write them
		opts.beforeSend = function(xhr){
			if (options && typeof options.beforeSend === 'function')
				options.beforeSend(xhr);
			self.emit('send');
		};
		opts.success = function(data, textStatus, xhr) {
			if (xhr.status === 0) {
				// error occured. the error callback will be called right after this
				return;
			}
			var res = new exports.Response(xhr, self, data);
			if (typeof responseHandler === 'function')
				responseHandler(res);
			if (options && typeof options.success === 'function')
				options.success(xhr, textStatus);
			self.emit('response', res);
		};
		opts.error = function(xhr, textStatus, error) {
			var res = new exports.Response(xhr, self);
			if (xhr && xhr.responseText && xhr.responseText.length) {
				try {
					res.data = $.secureEvalJSON(xhr.responseText);
				} catch(e){}
			}
			if (options && typeof options.error === 'function')
				options.error(xhr, textStatus, error, res);
			self.emit('error', error || textStatus, res);
		};
		opts.complete = function(xhr, textStatus){
			if (options && typeof options.complete === 'function')
				options.complete(xhr, textStatus);
			self.emit('complete');
		};
		
		// set expected response dataType from contentType
		/*if (opts.dataType === undefined) {
			if (opts.contentType.toLowerCase() == 'application/json')
				opts.dataType = 'json';
			else if (opts.contentType.toLowerCase() == 'text/javascript')
				opts.dataType = 'jsonp';
		}*/
		
		// add data
		var meth = opts.type.toUpperCase();
		if (opts.data && (meth === 'POST' || meth === 'PUT'))
			opts.data = $.toJSON(data);
		
		// send
		this.xhr = $.ajax(opts);
		
		return this;
	}
});

exports.request = function(method, url, params, options, callback) {
  if (typeof params === 'function') { callback = params; params = undefined; }
  else if (typeof options === 'function') { callback = options; options = undefined; }
	var req = new exports.Request(method, url);
	if (callback) {
	  req.addListener('error', function(ev, exc, res){
	    callback(exc); callback = null;
	  });
  }
	req.send(params, options, function(ev, exc, res){
    callback(null, res); callback = null;
  });
	return req;
};

exports.GET = function(url, params, options, callback) {
	return exports.request('GET', url, params, options, callback);
};

exports.POST = function(url, params, options, callback) {
	return exports.request('POST', url, params, options, callback);
};
