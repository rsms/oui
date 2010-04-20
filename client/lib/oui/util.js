
/**
 * Takes a module name or path and returns its canonical representation.
 */
exports.canonicalizeModuleName = function(path) {
  return path
    .replace(/(?:\.min|)\.[^\.]+$/g, '') // foo/bar-baz-.min.js => foo/bar-baz-
    .replace(/\/+/g,'.') // foo/bar-baz- => foo.bar-baz-
    .replace(/-+/g,'_') // foo.bar-baz- => foo.bar_baz_
    .replace(/\.index$/, '') // * removes ".index"
    .replace(/^[_\.\-]|[_\.\-]$/g,'') // foo.bar_baz_ => foo.bar_baz
    .replace(/_+(\w)/g, function(str, m1){ // foo.bar_baz => foo.barBaz
      return m1.toUpperCase();
    });
};
