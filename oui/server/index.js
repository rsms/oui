var http = require('http'),
    sys = require('sys'),
    fs = require('fs'),
    url = require("url"),
    path = require('path'),
    Routes = require('./routes').Routes,
    oui = require('../index'),
    sessions = require('./session'),
    handlers = exports.handlers = require('./handlers');

oui.util = require('../util');
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
      if (req.contentType === 'application/x-www-form-urlencoded') {
        req.addURIEncodedDataToParams(req.content);
      } else if (req.contentType === 'application/json') {
        req.addJSONDataToParams(req.content);
      }
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
    res.on('end', function(){
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
    res.on('end', function(){ process.nextTick(function(){
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

  // Register res.end to be called when/if the client disconnects
  var onClientDisconnect;
  if (this.debug) {
    onClientDisconnect = function(){
      sys.log('[oui] '+req.connection.remoteAddress+':'+
        req.connection.remotePort+' disconnected during response construction');
      if (!res.finished) res.end();
    };
  } else {
    onClientDisconnect = function(){ if (!res.finished) res.end(); };
  }
  req.connection.on('end', onClientDisconnect);
  // Make sure the listener does not linger after the response is complete
  res.on('end', function(){
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

    // first, pause reading of data since req.parse might abort the request or
    // delay the process
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.paused = true;
      req.pause();
    }

    // todo: investigate what happens if the response is send before req.resume
    //       is called, or if req.resume is never called.

    // parse the request (process header, cookies, start body buffer collectors, etc)
    req.parse(function(err){
      if (err) return res.sendError(err);
      // resume reading of body if the underlying socket was paused
      if (req.paused) {
        req.on('end', function(){ requestCompleteHandler(req, res) });
        req.resume();
      } else {
        // the request did not include a body
        requestCompleteHandler(req, res);
      }
    });
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
 *      \.[^\.]+|localhost|.+\.local)(?::[0-9]*|)$/
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
  // Setup handler filters, like parameter sanitation
  function setupHandlerFilters(args) {
    var paramSpec = args[args.length-2];
    var handler = args[args.length-1];
    if (args.length < 3 || typeof paramSpec !== 'object') {
      // no param specs
      return handler;
    }
    var filteredHandler = function(params, req, res) {
      var sanitizedParams = {};
      var err = oui.util.sanitizeInput(params, sanitizedParams, paramSpec);
      if (err) {
        return res.sendError(err);
      } else {
        return handler(sanitizedParams, req, res);
      }
    }
    return filteredHandler;
  }
  // One handler per GET, POST, etc
  Routes.METHODS.forEach(function(method){
    server.__proto__[method] = function(path, priority, paramSpec, handler) {
      if (this.pathPrefix && typeof path === 'string') {
        path = this.pathPrefix + '/' + path.replace(/^\/+/, '');
      }
      handler = setupHandlerFilters(arguments);
      if (typeof priority !== 'number') {
        priority = undefined;
      }
      this.routes[method](path, priority, handler);
      return this;
    }
  });
  // Set a handler for multiple <methods>
  server.__proto__.handle = function(methods/*, ..forwarded */) {
    methods = Array.isArray(methods) ? methods : [methods];
    for (var i=0,method; method = methods[i++];) {
      this[method].apply(this, Array.prototype.slice.call(arguments, 1));
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
  
  server.pathPrefix = '/';

  // List of request content types we will buffer before parsing
  server.bufferableRequestTypes = [
    'application/x-www-form-urlencoded',
    'application/json',
  ];

  // Limit the size of a request body
  server.maxRequestBodySize = 1024*1024*2; // 2 MB

  // Standard handlers
  server.__proto__.enableSessionHandlers = function(sessionPrefix) {
    if (!this.authSecret)
      throw new Error('server.authSecret is not set');
    if (!sessionPrefix) {
      sessionPrefix = '/session';
    } else {
      sessionPrefix = '/'+sessionPrefix.replace(/^\/+|\/+$/, '');
    }
    this.GET(sessionPrefix+'/establish', 99, handlers.session.establish);
    this.GET(sessionPrefix+'/sign-in', 99, handlers.session.GET_signIn);
    this.POST(sessionPrefix+'/sign-in', 99, handlers.session.POST_signIn);
    this.GET(sessionPrefix+'/sign-out', 99, handlers.session.signOut);
  }
  server.__proto__.enableBasicHandlers = function() {
    // Serve static files (priority 0/low)
    this.GET(/^.+/, 0, handlers.static);
    // Pass any OPTIONS request to allow CORS lookup (priority 0/low)
    this.OPTIONS(/^.*/ , 0, handlers.noop);
  }
  server.__proto__.enableStandardHandlers = function(sessionPrefix) {
    this.enableSessionHandlers(sessionPrefix);
    this.enableBasicHandlers();
  }

  return server;
}

// processCommandLineOptions([options[, args[, onusage]]]) -> restArgs
exports.processCommandLineOptions = function(options, args, onusage) {
  if (!args || !Array.isArray(args)) {
    args = process.argv.slice(2);
  }
  if (typeof options !== 'object') {
    options = {};
  }
  function usage() {
    var msg = 'usage: '+process.argv.slice(0,2).join(' ')+' [options]\n'+
      'options:\n'+
      '  -a, --addr <addr>    Address to bind to. Defaults to '+
        (options.addr || '0.0.0.0')+'.\n'+
      '  -p, --port <port>    Port to bind to. Defaults to '+
        (options.port || 80)+'.\n'+
      '  -s, --socket <path>  bind to UNIX socket.\n'+
      '  -v, --verbose        Enable basic logging to stdout.\n'+
      '  -d, --debug          Enable debug logging to stdout.\n'+
      '  -h, --help           Display usage and exit 3.';
    if (typeof onusage === 'function') {
      onusage(msg, options);
    } else {
      sys.error(msg);
      process.exit(3);
    }
  }
  if (args.indexOf('-h') !== -1 || args.indexOf('--help') !== -1) {
    usage();
  }
  var i, arg;
  for (i=0; arg = args[i]; i++) {
    switch (arg) {
      case '-a':
      case '--addr':
        options.addr = args[++i];
        break;
      case '-p':
      case '--port':
        options.port = args[++i];
        break;
      case '-s':
      case '--socket':
        options.sock = args[++i];
        break;
      case '-v':
      case '--verbose':
        options.verbose = true;
        break
      case '-d':
      case '--debug':
        options.verbose = true;
        options.debug = true;
        break
      default:
        if (arg[0] === '-') {
          sys.error(process.argv[1]+': unknown option '+arg);
          usage();
        }
    }
  }
  return args.slice(i);
}

/**
 * Start a server.
 */
exports.start = function(options) {
  var opt = {
    port: 80,
    commandLineParsing: true,
    basicHandlers: true,
    sessionHandlers: true,
    // addr, sock ..
    // any other property is assigned to the server object
  };
  if (typeof options === 'object') {
    mixin(opt, options);
  }
  // Unless command line parsing is disabled, parse options
  if (opt.commandLineParsing) {
    oui.server.processCommandLineOptions(opt, null,
      opt.onCommandLineParseError // optional callback(message, options)
    );
  }
  // Create a new server instance
  server = exports.createServer();
  // transfer options to server instance, except from options in this list.
  // we need to do this before anything else on the server instance.
  const skipopts = [
    'port', 'addr',
    'sock',
    'commandLineParsing',
    'onCommandLineParseError',
    'basicHandlers',
    'sessionHandlers',
  ];
  Object.keys(opt).forEach(function(k){
    if (skipopts.indexOf(k) === -1) server[k] = opt[k];
  });
  // trim trailing slashes from pathPrefix
  server.pathPrefix = server.pathPrefix.replace(/\/+$/, '');
  // Enable standard handlers
  if (opt.sessionHandlers)
    server.enableSessionHandlers(sessionPrefix);
  if (opt.basicHandlers)
    server.enableBasicHandlers();
  // listen
  if (opt.sock) {
    // bind to UNIX socket
    server.listen(opt.sock);
    server.verbose && sys.log('['+module.id+'] listening on '+opt.sock);
  } else {
    // bind to TCP address
    if (!opt.addr || opt.addr.match(/^\*|0\.0\.0\.0|$/)) {
      opt.addr = undefined;
    }
    server.listen(parseInt(opt.port), opt.addr);
    server.verbose && sys.log('['+module.id+'] listening on '+
      (opt.addr || '0.0.0.0')+':'+opt.port);
  }
  // if debug mode, print routes on 2nd next tick
  if (server.debug) {
    process.nextTick(function(){
      process.nextTick(function(){
        sys.log('[oui] routes =>\n  '+
                String(server.routes).replace(/\n/g, '\n  ').trim());
      });
    });
  }
  // return server instance
  return server;
}
