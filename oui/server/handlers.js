var fs = require('fs'),
    sys = require('sys'),
    path = require('path');

// Does nothing
exports.noop = function(){ return false; }

// Takes care of requests for files
exports.static = function(params, req, res) {
	var server = this;
	var notfoundCb = function() {
		server.debug && sys.log('[oui] "'+req.path+'" does not exist');
		res.sendError(404, 'File not found', 'Nothing found at '+req.path, null);
	}
	if (!req.filename) return notfoundCb();
	fs.stat(req.filename, function(err, stats) {
	  if (err) return notfoundCb();
		if (stats.isFile()) {
			res.sendFile(req.filename, null, stats);
		} else if (server.indexFilenames && stats.isDirectory()) {
			server.debug && sys.log(
				'[oui] trying server.indexFilenames for directory '+req.filename);
			var _indexFilenameIndex = 0;
			// todo: cache known paths
			var tryNextIndexFilename = function() {
				var name = server.indexFilenames[_indexFilenameIndex++];
				if (!name) {
					notfoundCb();
					return;
				}
				var filename = path.join(req.filename, name);
				//sys.log('try '+filename);
				fs.stat(filename, function(err, stats2) {
				  if (err || !stats2.isFile()) tryNextIndexFilename();
					else res.sendFile(filename, null, stats2);
				});
			}
			tryNextIndexFilename();
		} else {
			server.debug && sys.log('[oui] "'+req.url.pathname+
			  '" is not a readable file.'+' stats => '+JSON.stringify(stats));
			res.sendError(404, 'Unable to handle file',
				sys.inspect(req.url.pathname)+' is not a readable file');
		}
	});
}

// -----------------------------------------------------------------------------
// Session

var hash = require('../hash');

exports.session = {
  establish: function(params, req, res) {
  	var sessions = req.connection.server.sessions,
  	    session = sessions.findOrCreate(params.sid);
  	return {
  		sid: session.id,
  		user: session.data.user,
  	}
  },

  signIn: function(params, req, res) {
  	// todo: time-limit the auth_nonce
  	// get session
  	var server = req.connection.server,
  	    session = server.sessions.findOrCreate(params.sid);

  	// did respond?
  	var user, success = false, nonce = session.data.auth_nonce
  	if (nonce) {
  		delete session.data.auth_nonce;
  		if (params.auth_response) {
  			server.userPrototype.find(params.username, function(err, user){
  			  if (err) return res.sendError(err);
  				if (!user) {
  					res.sendError(401, 'No such user');
  					return;
  				}
  				// pass_hash     = BASE16( SHA1( user_id ":" password ) )
  				// auth_response = BASE16( SHA1_HMAC( auth_nonce, pass_hash ) )
  				var success = hash.sha1_hmac(nonce, user.pass_hash) == params.auth_response;
  				if (success) {
  					user = user.sessionObject();
  					session.data.user = user;
  					res.sendObject({user: user});
  				}
  				else {
  					res.sendError(401, 'Bad credentials');
  				}
  			});
  			return;
  		}
  	}

  	if (!params.username) {
  		res.sendError(400, 'Missing username parameter');
  		return;
  	}

  	server.userPrototype.find(params.username, function(err, user){
  	  if (err) return res.sendError(err);
  		if (session.data.auth_nonce) // delete previous
  			delete session.data.auth_nonce;
  		if (!user) {
  			res.sendError(401, 'No such user');
  			return;
  		}
  		var nonce = hash.sha1_hmac(server.authNonceHMACKey || '?', ''+(new Date())); // todo
  		session.data.auth_nonce = nonce;
  		res.sendObject({ nonce: nonce,  user: user });
  	});
  },

  signOut: function(params, req, res) {
  	if (!params.sid)
  		return res.sendError(400, 'Missing sid in request');
  	var session = req.connection.server.sessions.find(params.sid);
  	if (session && session.data.user)
  		delete session.data.user;
  	return '';
  }
};
