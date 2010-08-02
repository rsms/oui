# Example 1

This is a simple introductory example which uses no authentication nor sessions, but do expose a server API as well as a client. It's a service that stores messages which can be any JSON object.

You start the server like this:

    node server.js --debug

*The `--debug` argument will cause the server to print information about what it's doing.*

## Server API

A good way to explore and play with Oui server APIs is to use [cURL](http://curl.haxx.se/). See further down for a sample cURL session.

All server code in this example lives in `server.js`.
    

### GET /messages -> {id:message, ..}

Retrieve all messages. Returns a map `id => message`.

### POST message -> /messages -> {id:int}

Add a new message. Returns the new message id.

### GET /messages/:id -> {id:int, message:object}

Retrieve a specific message with id `:id`. Returns a message.

### PUT|POST message -> /messages/:id -> {message:object}

Assign a message to the id `:id`. Returns any message previously assigned to `:id`.

### DELETE /messages/:id -> {message:object}

Remove a message with id `:id`. Returns the message which was deleted.

### POST /messages/:id/delete -> {message:object}

Like `DELETE /messages/:id -> message` but implemented as POST to support old browsers (which are unable to send DELETE requests).


## Sample cURL session

    $ curl localhost:8080/messages
    {}
    $ curl -d '{"message":{"title":"Hello"}}' \
      -H 'content-type: application/json' localhost:8080/messages
    {"id":1}
    $ curl localhost:8080/messages
    {"1":{"title":"Hello"}}
    $ curl -d '{"message":{"title":"Hej", "language":"sv"}}' \
      -H 'content-type: application/json' localhost:8080/messages
    {"id":2}
    $ curl localhost:8080/messages
    {"1":{"title":"Hello"},"2":{"title":"Hej","language":"sv"}}
    $ curl -X DELETE localhost:8080/messages/1
    {"message":{"title":"Hello"}}
    $ curl localhost:8080/messages
    {"2":{"title":"Hej","language":"es"}}
    $ curl -X PUT -d '{"message":{"title":"Hola", "language":"es"}}' \
      -H 'content-type: application/json' localhost:8080/messages/2
    {"message":{"title":"Hej","language":"sv_SE"}}
    $ curl localhost:8080/messages
    {"2":{"title":"Hola","language":"es"}}
