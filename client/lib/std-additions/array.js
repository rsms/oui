if (typeof Array.isArray !== 'function') {
  Array.isArray = function(obj) { return toString.call(obj) === "[object Array]"; };
}
