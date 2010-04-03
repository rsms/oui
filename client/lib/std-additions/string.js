
String.prototype.repeat = function(times) {
  var v = [], i=0;
  for (; i < times; v.push(this), ++i) {}
  return v.join('');
};

var TRIM_RE = /^\s\s*/;

String.prototype.trim = function() {
  var	str = this.replace(TRIM_RE, ''),
      ws = /\s/,
      i = str.length;
  while (ws.test(str.charAt(--i))){}
  return str.slice(0, i + 1);
};

