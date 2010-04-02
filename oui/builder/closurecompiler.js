var url = require('url')
   ,events = require('events')
   ,http = require('http')
   //,sys = require('sys')
   ,querystring = require("querystring")

var formatErrors = exports.formatErrors = function(errors, lineglue) {
  var s = [];
  errors.forEach(function(error) {
    s.push('    '+(error.error || error.warning)+' ('+error.file+':'+error.lineno+':'+error.charno+')');
    if (error.line.length > 80)
      s.push('        '+error.line.substr(0,80)+'...');
    else
      s.push('        '+error.line);
  });
  return s;
}

var formatStats = exports.formatStats = function(stats, lineglue) {
  var s = [];
  /*
    "originalSize": 70,
    "originalGzipSize": 86,
    "compressedSize": 0,
    "compressedGzipSize": 20,
    "compileTime": 1
  */
  s.push('    Original size: '+stats.originalSize+' bytes ('+
    stats.originalGzipSize+' bytes gzipped)');
  s.push('    Compiled size: '+stats.compressedSize+' bytes ('+
    stats.compressedGzipSize+' bytes gzipped)');
  s.push('    Savings:       '+
    Math.round(100.0*(stats.compressedSize/stats.originalSize),2)+'%'+
    ' off the original size ('+
    Math.round(100.0*(stats.compressedGzipSize/stats.originalGzipSize),2)+'%'+
    ' off the gzipped size)');
  return s;
}

function compile(options, handler) {
  var opt = {
    api_url: undefined,          // URL to remote API
    compilation_level: 2,        // [1-3] 1 whitespace, 2 basic, 3 advanced.
    formatting: undefined,       // comma-separated: pretty_print, print_input_delimiter.
    output_file_name: undefined, //
    warning_level: undefined,    // "QUIET" | "DEFAULT" | "VERBOSE"
  };
  if (typeof options === 'object') mixin(opt, options);
  else opt.js_code = options;
  // todo: check for local closurecompiler program
  return compile_remote(opt, handler);
}
exports.compile = compile;

function compile_remote(opt, handler) {
  var promise = new events.Promise(),
      apiurl = url.parse(opt.api_url || 'http://closure-compiler.appspot.com/compile'),
      params =
  {
    compilation_level: 'WHITESPACE_ONLY',
    output_format: 'json',
    output_info: 'compiled_code',
  };
  if (opt.warning_level) params.warning_level = opt.warning_level.toUpperCase();
  if (opt.formatting) params.formatting = opt.formatting;
  if (opt.output_file_name) params.output_file_name = opt.output_file_name;
  if (opt.compilation_level) {
    if (opt.compilation_level == 2) params.compilation_level = 'SIMPLE_OPTIMIZATIONS';
    else if (opt.compilation_level > 2) params.compilation_level = 'ADVANCED_OPTIMIZATIONS';
  }

  if (typeof handler === 'function')
    promise.addCallback(handler);

  if (!Array.isArray(opt.js_code))
    params.js_code = opt.js_code;

  var conn, request, body = querystring.stringify(params);
  body += '&output_info=statistics&output_info=errors&output_info=warnings';

  if (Array.isArray(opt.js_code))
    opt.js_code.forEach(function(s){ body += '&js_code='+querystring.escape(s); });

  conn = http.createClient(apiurl.port ? parseInt(apiurl.port) : 80, apiurl.hostname);
  request = conn.request('POST', apiurl.pathname || '/compile', {
    'Host': apiurl.hostname,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': body.length,
  });
  request.sendBody(body);
  //promise.emitError(err);
  request.finish(function (response) {
    var rsp_body = '';
    response.addListener('body', function (chunk) {
      rsp_body += chunk;
    });
    response.addListener('complete', function() {
      //sys.debug('status => '+response.statusCode);
      var rsp = JSON.parse(rsp_body);
      if (rsp.serverErrors && rsp.serverErrors.length) {
        if (rsp.serverErrors.length === 1)
          promise.emitError(new Error(rsp.serverErrors[0].error, rsp.serverErrors[0].code));
        else
          promise.emitError(new Error(rsp_body));
      }
      else {
        promise.emitSuccess(rsp);
      }
    });
  });

  return promise;
}
