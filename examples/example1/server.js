var fs = require('fs'),
    path = require('path'),
    oui = require('oui');

// Start a server
var server = oui.server.start({
  port: 8080,
  documentRoot: path.join(path.dirname(fs.realpathSync(__filename)), 'public'),
  allowedOrigin: /^https?:\/\/(?:(?:.+\.|)(?:dropular|hunch)\.[^\.]+|localhost|.+\.local)(?::[0-9]*|)$/,
});

// Enable standard functionality (static file handling, sessions, etc).
server.enableStandardHandlers();

// A custom request handler saying hello
server.on('GET', '/hello', function(){
	return 'Hello to you too sir';
});
