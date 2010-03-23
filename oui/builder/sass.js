// wraps the `sass` CLI
var sys = require('sys');

exports.available = undefined;
exports.render = function(options, callback) {
  var args = [];
  if (typeof options !== 'object') options = {file:String(options)};
  if (exports.available !== undefined && !exports.available) {
    if (callback) {
      if (options.strict) callback(new Error('The "sass" program can not be found in PATH'));
      else callback();
    }
    return;
  }
  args.push(options.file);
  args = args.map(function(arg){ return "'"+String(arg).replace(/\'/g,"\\'")+"'"; });
  args = args.join(' ');
  sys.exec("sass "+args, function (err, stdout, stderr) {
    if (exports.available === undefined) exports.available = true;
    if (err) {
      const CMD_FAILED = 'Command failed:';
      var p, msg = err.message;
      if (msg.indexOf('sass: command not found') !== -1) {
        exports.available = false;
        if (callback && !options.strict) return callback();
      } else {
        if ((p = msg.indexOf(CMD_FAILED)) !== -1) {
          //var line = / on line (\d+)/.exec(msg);
          //if (line) line = parseInt(line[1]);
          msg = '('+options.file+')\n'+msg.substr(p+CMD_FAILED.length).trim();
          msg = msg.replace(/\n/gm, '\n  ').trim();
        }
        err = new Error(msg);
      }
      if (callback) callback(err);
    } else {
      callback(null, stdout);
    }
  });
}
