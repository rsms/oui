
String.prototype.repeat = function(times) {
  var v = [], i=0;
  for (; i < times; v.push(this), i++);
  return v.join('');
}

String.prototype.fillLeft = function(length, padstr) {
  if (this.length >= length) return this;
  return String(padstr || " ").repeat(length-this.length) + this;
}

String.prototype.fillRight = function(length, padstr) {
  if (this.length >= length) return this;
  return this + String(padstr || " ").repeat(length-this.length);
}

String.prototype.linewrap = function(prefix, linewidth, lineglue) {
  if (typeof prefix === 'number') prefix = ' '.repeat(prefix);
  else if (!prefix) prefix = '';
  if (!linewidth) linewidth = 79;
  if (!lineglue) lineglue = '\n';
  var value = this.trimRight();
  if (prefix.length + value.length <= linewidth)
    return value;
  var mlen = linewidth-prefix.length, buf = [], offs = 0, p;
  while (offs < value.length) {
    p = value.length-offs > mlen ? value.lastIndexOf(' ', offs+mlen) : -1;
    if (p === -1) {
      // todo: force-split very long strings
      buf.push(value.substr(offs));
      break;
    }
    buf.push(value.substring(offs, p));
    offs = p+1; // +1 for " "
  }
  return buf.join(lineglue+prefix);
}
