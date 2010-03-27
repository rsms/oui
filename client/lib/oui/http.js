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

oui.mixin(exports.Request.prototype, oui.EventEmitter.prototype, {

  // Send the request
	send: function(params, options, callback) {
		// args
		if (typeof params === 'function') { callback = params; params = undefined; }
		else if (typeof options === 'function') { callback = options; options = undefined; }
		var self = this;
		this.method = this.method.toUpperCase();
		
		// default options
		var opts = {
			type: this.method,
			url: this.url,
			context: this
		};
		
		// add custom options
		if (typeof options === 'object') opts = $.extend(opts, options);
		else options = false;
		
		// content-type
		if ((this.method === 'POST' || this.method === 'PUT') && !opts.contentType && this.contentType)
			opts.contentType = this.contentType;
		
		// add all non-undefined items in <params> to <opts.data>
		if (typeof params === 'object') {
		  opts.data = {};
			jQuery.each(params, function(k,v){ if (v !== undefined) opts.data[k] = v; });
		} else {
		  opts.data = params;
		}
		
		// todo: remove this now?
		// _HAVE_XHR_ONERROR set?
		if (exports._HAVE_XHR_ONERROR === undefined) {
			var xhr = jQuery.ajaxSettings.xhr();
			exports._HAVE_XHR_ONERROR = false;
			for (var k in xhr) {
				if (k === 'onerror') {
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
			if (callback)
			  callback(null, res);
			if (options && typeof options.success === 'function')
				options.success(xhr, textStatus);
			self.emit('response', res);
		};
		opts.error = function(xhr, textStatus, error) {
			var res = new exports.Response(xhr, self);
			if (xhr && xhr.responseText && xhr.responseText.length) {
				try {
					res.data = $.secureEvalJSON(xhr.responseText);
					if (res.data.error && res.data.error.stack)
					  console.error('remote error ->', res.data.error.stack.join('\n  '));
				} catch(e){}
			}
			if (callback) {
			  if (!error) {
			    if (res && res.data && res.data.error) {
			      error = new Error('Remote error: '+
			        (res.data.error.message || res.data.error.title));
		      } else {
		        error = new Error('Remote error');
		      }
		    }
			  callback(error, res);
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
		
		// encode data
		if (opts.data && (this.method === 'POST' || this.method === 'PUT') && this.contentType === 'application/json')
			opts.data = $.toJSON(opts.data);
		
		// send
		this.xhr = $.ajax(opts);
		
		return this;
	}
});

exports.request = function(method, url, params, options, callback) {
  if (typeof params === 'function') { callback = params; params = undefined; }
  else if (typeof options === 'function') { callback = options; options = undefined; }
	var req = new exports.Request(method, url);
	req.send(params, options, callback);
	return req;
};

exports.GET = function(url, params, options, callback) {
	return exports.request('GET', url, params, options, callback);
};

exports.POST = function(url, params, data, options, callback) {
	return exports.request('POST', url, params, options, callback);
};
