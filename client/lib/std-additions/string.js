if (!String.prototype.repeat) {
  String.prototype.repeat = function(times) {
    var v = [], i=0;
    for (; i < times; v.push(this), ++i) {}
    return v.join('');
  };
}

if (!String.prototype.trim) {
  String.prototype.trim = function() {
    return this.replace(/^(?:\s|\u00A0)+/, '').replace(/(?:\s|\u00A0)+$/, '');
  };
}
