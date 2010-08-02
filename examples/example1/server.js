var fs = require('fs'),
    path = require('path'),
    oui = require('../../oui');

// Start a server
var server = oui.server.start({
  port: 8080,
  documentRoot: path.dirname(fs.realpathSync(__filename)) + '/public',
  authSecret: 'you should change this in a real app',
});

// In this example we store our messages in memory. In a real world app you
// would probably save these persistently.
var messages = {
  map: {},
  nextId: 1,
  add: function(message) {
    var id = messages.nextId++;
    messages.map[id] = message;
    return id;
  }
};

// read all messages
server.GET('/messages', {onlyKeys:'boolean'}, function(params, req, res){
  if (params.onlyKeys) {
    return Object.keys(messages.map);
  } else {
    return messages.map;
  }
});

// add a message
server.POST('/messages', {message:{required:true}}, function(params, req, res) {
  return {id: messages.add(params.message)};
});

// get a specific message
server.GET('/messages/:id', {id:'int'}, function(params, req, res) {
  // retrieve message
  var message = messages.map[params.id];
  // if message was not found, send a 404
  if (!message)
    return res.send(404, 'wtf');
  // send the message and it's id to the client
  return {id: params.id, message: message};
});

// update a specific message (also allow POST so old web browser can use this)
server.handle(['PUT', 'POST'], '/messages/:id', {
  id: 'int',
  message: {required: true}
}, function(params, req, res) {
  var message = messages.map[params.id];
  messages.map[params.id] = params.message;
  // send the previous message to the client
  return {message: message};
});

// remove a specific message
function removeHandler(params, req, res) {
  var message = messages.map[params.id];
  if (!message)
    return res.send(404);
  messages.map[params.id] = undefined;
  // send the old message to the client
  return {message: message};
}
var argspec = {id:{type:'int'}};
// DELETE is the "correct" way...
server.DELETE('/messages/:id', argspec, removeHandler);
// ...but old browsers only support GET and POST
server.POST('/messages/:id/delete', argspec, removeHandler);
