exports.version = '0.1.0';
require('./std-additions');
exports.server = require('./server');
// node: do not include builder as it in turn imports less.js which will mess up Array.prototype.

// oui.debug RW
exports.__defineSetter__('debug', function(v){
  exports.server.debug = exports._debug = v;
});
exports.__defineGetter__('debug', function(){
  return exports._debug;
});
