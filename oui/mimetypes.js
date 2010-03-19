var fs = require('fs');

exports.knownfiles = [
	"/etc/mime.types",
	"/etc/apache2/mime.types",              // Apache 2
	"/etc/apache/mime.types",               // Apache 1
	"/etc/httpd/mime.types",                // Mac OS X <=10.5
	"/etc/httpd/conf/mime.types",           // Apache
	"/usr/local/etc/httpd/conf/mime.types",
	"/usr/local/lib/netscape/mime.types",
	"/usr/local/etc/httpd/conf/mime.types", // Apache 1.2
	"/usr/local/etc/mime.types"            // Apache 1.3
];

// a few common types "built-in"
exports.types = {
	 "css" : "text/css"
	,"flv" : "video/x-flv"
	,"gif" : "image/gif"
	,"gz" : "application/x-gzip"
	,"html" : "text/html"
	,"ico" : "image/vnd.microsoft.icon"
	,"jpg" : "image/jpeg"
	,"js" : "application/javascript"
	,"json" : "application/json"
	,"mp4" : "video/mp4"
	,"ogg" : "application/ogg"
	,"pdf" : "application/pdf"
	,"png" : "image/png"
	,"svg" : "image/svg+xml"
	,"tar" : "application/x-tar"
	,"tbz" : "application/x-bzip-compressed-tar"
	,"txt" : "text/plain"
	,"xml" : "application/xml"
	,"yml" : "text/yaml"
	,"zip" : "application/zip"
};

exports.parse = function(data) {
	data.split(/[\r\n]+/).forEach(function(line){
		line = line.trim();
		if (line.charAt(0) === '#') return;
		words = line.split(/\s+/);
		if (words.length < 2) return;
		type = words.shift().toLowerCase();
		words.forEach(function(suffix){ exports.types[suffix.toLowerCase()]=type });
	})
}

function _parseSystemTypes(paths, callback) {
  if (!callback) {
    for (var i=0;i<paths.length;i++) {
      var content;
      try {
        content = fs.readFileSync(paths[i], 'binary');
      } catch (e) {
        if (i === paths.length-1)
          throw new Error('no mime types databases found');
        continue;
      }
      // parse outside of try so errors in parse propagates
      exports.parse(content);
      return paths[i];
    }
    return; // no error if the list <paths> was empty
  }
  // async
	var next = function(){
		var abspath = paths.shift();
		if (!abspath)
			return callback(new Error('no mime types databases found'));
		fs.readFile(abspath, 'binary', function (err, content) {
		  if (err) return next();
			exports.parse(content);
			callback(null, abspath);
		});
	}
	next();
}

/**
 * Look up mime type for a filename extension, or look up
 * list of filename extension for a mime type.
 *
 * Returns a string if <extOrType> is an extension (does not
 * contain a "/"), otherwise a list of strings is returned.
 *
 * For compatibility with path.extname(), a filename extension
 * is allowed to include the "." prefix (which will be stripped).
 *
 * Example:
 *   exports.lookup('yml') => "text/yaml"
 *   exports.lookup('text/yaml', function(err, types){
 *     // types => ["yml", "yaml"]
 *   })
 */
exports.lookup = function(extOrType, callback) {
	// lazy importing of system mime types
	if (exports.knownfiles !== undefined) {
	  var filenames = exports.knownfiles;
	  delete exports.knownfiles;
		if (callback) {
		  // async
		  _parseSystemTypes(filenames, function(err){
		    callback(err, _lookup(extOrType));
		  });
		  return;
	  } else {
	    // sync
	    _parseSystemTypes(filenames);
	    return _lookup(extOrType);
	  }
	}
	var r = _lookup(extOrType);
	return callback ? callback(null, r) : r;
}

function _lookup(extOrType) {
  // look up type based on extension, or extension based on type
	extOrType = extOrType.toLowerCase();
	if (extOrType.indexOf('/') === -1) {
		if (extOrType.charAt(0) === '.')
			extOrType = extOrType.substr(1);
		return exports.types[extOrType];
	} else {
		var exts = [];
		for (var k in exports.types) {
			if (exports.types[k] === extOrType)
				exts.push(k);
		}
		return exts;
	}
}
