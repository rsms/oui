/*jslint browser: true, devel: true, laxbreak: true */
var http = {};

http.Response = function(xhr, request, data) {
	this.xhr = xhr;
	this.request = request;
	this.data = data;
};

http.Request = function(method, url) {
	this.method = method || 'GET';
	this.url = url || '';
	this.contentType = 'application/json'; // x-www-form-urlencoded
};

mix(http.Request, EventEmitter, function(P){
	P.send = function(data, responseHandler, options) {
		// args
		if (typeof data === 'function') {
			responseHandler = data;
			data = undefined;
		}
		if (typeof responseHandler === 'object')
			options = responseHandler;
		
		// default options
		var self = this;
		var opts = {
			type: this.method,
			url: this.url,
			data: data
		};
		
		// add custom options
		if (typeof options === 'object')
			opts = $.extend(opts, options);
		else
			options = false;
		
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
		if (http._HAVE_XHR_ONERROR === undefined) {
			var xhr = jQuery.ajaxSettings.xhr();
			http._HAVE_XHR_ONERROR = false;
			for (var k in xhr) {
				if (k == 'onerror') {
					http._HAVE_XHR_ONERROR = true;
					break;
				}
			}
			delete xhr;
		}
		
		// if the client supports xhr.onerror, add event emitter
		if (http._HAVE_XHR_ONERROR) {
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
			var res = new http.Response(xhr, self, data);
			if (typeof responseHandler === 'function')
				responseHandler(res);
			if (options && typeof options.success === 'function')
				options.success(xhr, textStatus);
			self.emit('response', res);
		};
		opts.error = function(xhr, textStatus, error) {
			var res = new http.Response(xhr, self);
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
	};
});

http.request = function(method, url) {
	return new http.Request(method, url);
};

var _promisedRequest = function(method, url, params, options) {
	var req = http.request(method, url);
	var promise = new Promise(req);
	req.addListener('error', function(ev, exc, res){ promise.emitError(exc, res); });
	req.send(params, function(res){ promise.emitSuccess(res); }, options);
	return promise;
};

http.GET = function(url, params, options) {
	return _promisedRequest('GET', url, params, options);
};

http.POST = function(url, params, options) {
	return _promisedRequest('POST', url, params, options);
};
