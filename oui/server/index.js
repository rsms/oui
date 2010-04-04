var http = require('http'),
    sys = require('sys'),
    fs = require('fs'),
    url = require("url"),
    path = require('path'),
    Routes = require('./routes').Routes,
    oui = require('../'),
    sessions = require('./session'),
    handlers = exports.handlers = require('./handlers');

require('./http-patches/request');
require('./http-patches/response');

// Enable debug mode (verbose async output to stdout)
exports.debug = false;

function requestCompleteHandler(req, res) {
  try {
    // only proceed if the response have not yet started
    if (res.started)
      return;

    // load POST payload, if buffered
    if (req.content) {
      if (req.contentType === 'application/x-www-form-urlencoded')
        req.addURIEncodedDataToParams(req.content)
      else if (req.contentType === 'application/json')
        req.addJSONDataToParams(req.content)
    }

    // did the response start already?
    if (res.started)
      return;

    // let route handler act on req and res, possibly returning body struct
    var body = req.route.handler.apply(server, [req.params, req, res])

    // did the handler start the response or take over responsibility?
    if (body === undefined || res.started)
      return;

    // format response object
    if (body && body.constructor !== String)
      body = res.format(body)

    // send and mark as finished
    req.sendResponse(body)
  }
  catch(exc) {
    return res.sendError(exc)
  }
}


function requestHandler(req, res) {
  if (this.debug) {
    var dateStarted = (new Date()).getTime()
    res.addListener('end', function(){
      var timespent = ((new Date()).getTime() - dateStarted);
      process.nextTick(function(){
        var r = req,
        s = '[oui] --> '+r.method+' '+r.path+' (real time spent: '+timespent+' ms)'+
          ' HTTP/'+r.httpVersionMajor+'.'+r.httpVersionMinor+' '+res.status;
        for (var i=0,t; t = res.headers[i];i++) s += '\n  '+t[0]+': '+t[1];
        sys.log(s);
      });
    })
  } else if (this.verbose) {
    // Log a Common Logfile Format entry to stdout
    // remotehost rfc931 authuser [date] "request" status bytes
    res.addListener('end', function(){ process.nextTick(function(){
      sys.puts([
        req.connection.remoteAddress,
        '-', // remote logname of the user // TODO
        '-', // authed username // TODO
        '['+(new Date()).toUTCString()+']',
        '"'+req.method+' '+req.path+' HTTP/'+
        req.httpVersionMajor+'.'+req.httpVersionMinor+'"',
        res.status,
        res.contentLength
      ].join(' '));
    })});
  }
  req.response = res
  res.request = req

  req.prepare()
  res.prepare()

  // Register res.close to be called when/if the client disconnects
  var onClientDisconnect;
  if (this.debug) {
    onClientDisconnect = function(){
      sys.log('[oui] '+req.connection.remoteAddress+':'+
        req.connection.remotePort+' disconnected during response construction');
      if (!res.finished) res.close();
    };
  } else {
    onClientDisconnect = function(){ if (!res.finished) res.close(); };
  }
  req.connection.addListener('end', onClientDisconnect);
  // Make sure the listener does not linger after the response is complete
  res.addListener('end', function(){
    req.connection.removeListener('end', onClientDisconnect);
  });

  // log request
  if (this.debug) {
    // next tick because of a weird bug in node http where reading headers seems
    // to mess with the response buffer.
    // TODO: create test case and submit this bug to ryan
    process.nextTick(function(){
      var s = '[oui] <-- '+req.method+' '+req.path;
      for (var k in req.headers) s += '\n  '+k+': '+req.headers[k];
      sys.log(s);
    });
  }

  try {
    // solve route
    if (!req.solveRoute())
      return res.sendError(404, req.path+' not found');

    // parse the request (process header, cookies, register body buffer collectors, etc)
    if (!req.parse())
      return;

    // take action when request is completely received
    req.addListener('end', function(){ requestCompleteHandler(req, res) });
  }
  catch(exc) {
    return res.sendError(exc)
  }
}

// ----------------------------------------------------------------------------

/**
 * Create a new OUI server.
 *
 * Server properties:
 *
 *   verbose = bool
 *      If true, send limited logging to stdout. Basically, just print a line
 *      each time a request is received containing the method and the path
 *      requested. Uses asynchronous I/O (in contrast to .debug). True by default.
 *
 *   debug = bool
 *      If true, send excessive logging to stderr through sys.log. This should
 *      NOT BE ENABLED for production sites as it introduces a more or less
 *      considerable performance penalty. By default, a new server instance's
 *      debug property has the same value as the module-wide property of the
 *      same name.
 *
 *   allowedOrigin = <RegExp>
 *      Allow origins for cross-site requests (CORS)
 *      Example of allowing specific domains, including localhost:
 *      .allowedOrigin = /^https?:\/\/(?:(?:.+\.|)(?:yourdomain|otherdomain)
 *      \.[^\.]+|localhost|.+\.local)$/
 *
 *   documentRoot = <String>
 *      Document root for serving static files.
 *
 *   indexFilenames = <Array of <String>s>
 *      File to look for when requesting a directory.
 *
 *   bufferableRequestTypes = <Array of <String>s>
 *      List of MIME types which denote "bufferable" request content payloads,
 *      that is; if a request is received with content and the value of a
 *      content-type header equals one of the strings in this list, the content
 *      entity of the request will be automatically read into a buffer. This
 *      buffer (a String) is later accessible from request.content.
 *
 *   maxRequestBodySize = int
 *      When oui handled reading of request content entities, this limits the
 *      number of bytes which will be read. Important to keep this to a relatively
 *      low number to prevent DoS attacks.
 *
 *   userPrototype = Object
 *      User type. See `user.js` for details.
 *
 */
exports.createServer = function() {
  var server = http.createServer(requestHandler);

  // Inherit debug property from module-wide property
  server.debug = exports.debug;

  // URL routing
  server.routes = new Routes();
  server.on = function(methods, path, priority, handler) {
    methods = Array.isArray(methods) ? methods : [methods];
    for (var i=0,L=methods.length;i<L;i++) {
      var method = methods[i];
      this.routes[method](path, priority, handler);
    }
    return this;
  };

  // Sessions
  server.sessions = new sessions.MemoryStore();

  // Server name returned in responses. Please do not change this.
  server.name = 'oui/'+oui.version+' node/'+process.version;

  // Allow any origin by default
  server.allowedOrigin = /./;

  // File to look for when requesting a directory
  server.indexFilenames = ['index.html'];

  // List of request content types we will buffer before parsing
  server.bufferableRequestTypes = [
    'application/x-www-form-urlencoded',
    'application/json',
  ];

  // Limit the size of a request body
  server.maxRequestBodySize = 1024*1024*2; // 2 MB

  // Standard handlers
  server.enableStandardHandlers = function(sessionPrefix) {
    if (!this.authSecret)
      throw new Error('authSecret is not set');
    sessionPrefix = sessionPrefix || '/session';
    this.on('GET', sessionPrefix+'/establish', handlers.session.establish);
    this.on('GET', sessionPrefix+'/sign-in', handlers.session.GET_signIn);
    this.on('POST', sessionPrefix+'/sign-in', handlers.session.POST_signIn);
    this.on('GET', sessionPrefix+'/sign-out', handlers.session.signOut);
    // Serve static files
    this.on('GET', /^.+/, 0, handlers.static);
    // Pass any OPTIONS request to allow CORS lookup
    this.on('OPTIONS', /^.*/ , 0, handlers.noop)
  }

  return server;
}

/** Start a server listening on [port[, addr]] */
exports.start = function(options) {
  var opt = {
    port: 80,
    // addr
    // sock
    // any other property is assigned to the server object
  };
  if (typeof options==='object') mixin(opt, options);
  server = exports.createServer();
  const skipKeys = {port:1, addr:1, verbose:1};
  Object.keys(opt).forEach(function(k){ if (!skipKeys[k]) server[k] = opt[k]; });
  server.verbose = (opt.verbose === undefined || opt.verbose || server.debug);
  if (opt.addr.match(/^\*|0\.0\.0\.0|$/)) opt.addr = undefined;
  if (opt.sock)
    server.listen(opt.sock);
  else
    server.listen(parseInt(opt.port), opt.addr);
  server.verbose && sys.log('['+module.id+'] listening on '+
    (opt.addr || '0.0.0.0')+':'+opt.port);
  return server;
}
