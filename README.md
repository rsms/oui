# oui

Oui is a kit and framework for building larger websites, in the same fashion as networked and distributed desktop applications.

- All code is modern JavaScript -- [Node.js](http://nodejs.org/) for the server and in the browser at the client side.
- The user interface is completely handled client-side
- Client-server communication is REST-ful and exchange structured data (JSON)
- All JavaScript, HTML and CSS is namespaced (derived from file structure)

Normally this is how rich HTML clients are designed:

<img src="http://farm5.static.flickr.com/4094/4864279501_3db3e57d06_o.png">

This quickly gets messy with large sites and you often end up splitting up content into multiple actual requests simply because there's no better way to structure your source.

Now, Oui takes another approach by letting you structure your content regarding to *modules* rather than *technology*:

<img src="http://farm5.static.flickr.com/4082/4864279573_305cc9499d_o.png">

As soon as any content is modified, an active processor and compiler automatically updates the three final index files -- web browsers get what they want (few requests, optimized structure, etc) and you can structure your work in a logical way (by logical units/modules rather than scattered around in large files).

## Features

The server keeps no persistent state, thus allowing for scalability:

- If a server instance dies, nothing can break since there is no finalization process nor any state which can break.
- Secure session support
  - Sessions are transient but buffered in memory for each server instance.
  - Persistent session data is created and updated by user-defined hooks.
  - Authentication tokens cached in sessions and can be wrapped in user-defined
    types (prototypes).
- Multi-site support
  - Clients connect to different server instances (e.g. host1.server.com:81, host4.server.com:80, etc)
  - Which server instance to connect to is chosen by random (with some weightening) for "new" clients
  - Clients "stick with" a server instance as long as the server does not reply with a 5xx response (in which case the client selects a new server using round-robin).
  - When a server instance fails (crashes) the client will automatically connect to a new backend and re-send the request (which caused the detection of a faulty server).
    - Requests should be transactional and such design is supported by the oui server.
- Built-in authentication
  - Challenge-response with intermediate, cacheable representation
  - User-defineable hooks (both on the server and the client side)
  - Support for custom authentication schemes (e.g. plain text, oath, etc)
  - Sensible defaults (ready out-of-the-box), requiring virtually no programming effort, get you started quickly


Initially developed as part of the 2010 version of [dropular.net](http://dropular.net/).

## Authors

- Rasmus Andersson <http://hunch.se/>

## License

MIT (see the LICENSE file for details)
