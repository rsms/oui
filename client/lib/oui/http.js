/*jslint browser: true, devel: true, laxbreak: true */

/**
 * Takes an object (or string) and returns a query string part.
 */
function paramsToQuery(params) {
  var paramsStr;
  if (typeof params === 'object') {
    // sort keys so to always produce the same string given certain input keys
    var keys = Object.keys(params).filter(function(k){
      return params[k] !== undefined;
    }).sort();
    paramsStr = keys.map(function(k){
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    // alt impl:
    /*
    paramsStr = [];
    jQuery.each(params, function(k,v){
      if (v !== undefined) paramsStr.push([k, v]);
    });
    paramsStr.sort(function(a,b) {
      return (a[0].toLowerCase() < b[0].toLowerCase()) ? -1 : 1;
    });
    paramsStr = paramsStr.map(function(a){
      return encodeURIComponent(a[0]) + '=' + encodeURIComponent(a[1]);
    }).join('&');*/
  } else if (typeof params === 'string') {
    paramsStr = params.replace(/^[\?&]+|&+$/, '');
  } else {
    throw new Error('first argument must be an object or a string');
  }
  return paramsStr;
}
exports.paramsToQuery = paramsToQuery;

/**
 * A HTTP response
 */
function Response(xhr, request, data) {
  this.xhr = xhr;
  this.request = request;
  this.data = data;
  this.statusCode = (typeof xhr === 'object') ? xhr.status : 0;
}
exports.Response = Response;

/**
 * A HTTP request
 */
function Request(method, url) {
  this.method = method || 'GET';
  this.url = url || '';
  this.contentType = 'application/json'; // x-www-form-urlencoded
}
exports.Request = Request;

Request.nextId = 0;

// Request.prototype
oui.inherits(exports.Request, oui.EventEmitter, {

  /**
   * Send the request.
   *
   * Invocations for POST and PUT requests:
   *   >> send(params, data, options, callback)
   *   >> send(params, data, callback)
   *   >> send(data, callback)
   *   >> send(callback)
   *
   * Invocations for GET, DELETE, OPTIONS and HEAD requests:
   *   >> send(params, options, callback)
   *   >> send(params, callback)
   *   >> send(callback)
   */
  send: function(params, data, options, callback) {
    var self = this;
    this.method = this.method.toUpperCase();
    var methodIsPOSTorPUT = this.method === 'POST' || this.method === 'PUT';

    // parse arguments
    var i = arguments.length;
    callback = arguments[--i];
    if (arguments.length >= 4) {
      options = arguments[--i];
    }
    if (methodIsPOSTorPUT) {
      data = arguments[--i];
    }
    params = arguments[--i];

    // TODO: validate this.url through a regexp since malformed host/port yields
    //       hard-to-trace errors deep down in xhr mechanisms.

    // default options
    var opts = {
      type: this.method,
      url: String(this.url),
      context: this // we do not rely on this -- safe to change with <options>
    };

    // add custom options
    if (typeof options === 'object') {
      opts = $.extend(opts, options);
    } else {
      options = null;
    }

    // add URL query params
    if (params) {
      var paramsStr = paramsToQuery(params);
      if (paramsStr)
        opts.url += (opts.url.indexOf('?') !== -1 ? '&' : '?') + paramsStr;
    }

    // set data for POST and PUT
    if (methodIsPOSTorPUT) {
      // The empty string if no data, so to set Content-Length, required by
      // HTTP 1.1 even though a POST or PUT without content is a bit weird...
      opts.data = data || "";
      // content-type
      if (!opts.contentType && this.contentType) {
        opts.contentType = this.contentType;
      }
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
      xhr = null;
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
      xhr.withCredentials = true;
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
      console.debug(self+' completed', res);
      if (callback) {
        callback(null, res);
      }
      if (options && typeof options.success === 'function')
        options.success(xhr, textStatus);
      self.emit('response', res);
    };
    opts.error = function(xhr, textStatus, error) {
      var res = new exports.Response(xhr, self);
      if (xhr && xhr.responseText && xhr.responseText.length) {
        try {
          res.data = JSON.parse(xhr.responseText);
        } catch(e){}
      }
      if (res.statusCode !== 0 && res.statusCode < 400) {
        error = undefined;
      } else if (!error) {
        if (typeof res.data === 'object' && typeof res.data.error === 'object'){
          error = new Error('Remote error: '+
            (res.data.error.message || res.data.error.title));
          error.remoteStack = res.data.error.stack;
          if (res.data.error.title) {
            error.type = res.data.error.title;
          }
        } else {
          error = new Error('Remote error');
        }
      }
      // log response
      if (error) {
        if (error.remoteStack) {
          console.error(self+' completed with error', res, 
                        error.remoteStack.join('\n  '));
        } else {
          console.error(self+' completed with error', res, error);
        }
      } else {
        console.debug(self+' completed', res);
      }
      // invoke callbacks
      if (callback) callback(error, res);
      if (options && typeof options.error === 'function')
        options.error(xhr, textStatus, error, res);
      // emit events
      if (error) {
        self.emit('error', error, res);
      } else {
        self.emit('response', res);
      }
    };
    opts.complete = function(xhr, textStatus){
      if (options && typeof options.complete === 'function')
        options.complete(xhr, textStatus);
      self.emit('complete');
      delete self.xhr;
    };

    // encode data
    if (opts.data
        && (methodIsPOSTorPUT) 
        && this.contentType === 'application/json') {
      opts.data = JSON.stringify(opts.data);
    }

    // send
    this.id = Request.nextId++;
    console.debug(this+' sending', opts);
    this.xhr = $.ajax(opts);

    return this;
  },
  
  toString: function(){
    return module.id+'.Request<'+(this.id === undefined ? 'new' : this.id)+
      ' '+this.method+' '+this.url+'>';
  }
});

/**
 * Send a request.
 *
 * When method is POST or PUT:
 *   >> send(method, url, params, data, options, callback)
 *   >> send(method, url, params, data, callback)
 *   >> send(method, url, data, callback)
 *   >> send(method, url, callback)
 *
 * When method is GET, DELETE, OPTIONS or HEAD:
 *   >> send(method, url, params, options, callback)
 *   >> send(method, url, params, callback)
 *   >> send(method, url, callback)
 */
exports.request = function(method, url /*...*/) {
  var req = new exports.Request(method, url);
  req.send.apply(req, Array.prototype.slice.call(arguments, 2));
  return req;
};

/**
 * Send a POST or PUT request.
 *
 * >> METHOD(url, params, options, callback) -> Request
 * >> METHOD(url, params, callback) -> Request
 * >> METHOD(url, callback) -> Request
 */
['GET','OPTIONS','HEAD','DELETE'].forEach(function(method){
  exports[method] = function() {
    return exports.request.apply(exports, [method].concat(
      Array.prototype.slice.call(arguments)));
  };
});

/**
 * Send a POST or PUT request.
 *
 * >> METHOD(url, params, data, options, callback) -> Request
 * >> METHOD(url, params, data, callback) -> Request
 * >> METHOD(url, data, callback) -> Request
 * >> METHOD(url, callback) -> Request
 */
['POST', 'PUT'].forEach(function(method){
  exports[method] = function() {
    return exports.request.apply(exports, [method].concat(
      Array.prototype.slice.call(arguments)));
  };
});
