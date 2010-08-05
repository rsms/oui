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


// ----------------------------------------------------------------------------
// A port of nodejs sys.inspect

// note: __proto__ is written as [protoKey] to "fool" jslint which is kind of
//      broken in the way that accessing __proto__ is considered a hard error.
var protoKey = '__proto__';

function isArray (ar) {
  return ar instanceof Array
      || Array.isArray(ar)
      || (ar && ar !== Object.prototype && isArray(ar[protoKey]));
}

function isRegExp (re) {
  if (re instanceof RegExp) return true;
  var s = ""+re;
  return typeof(re) === "function" // duck-type for context-switching evalcx case
      && re.constructor.name === "RegExp"
      && re.compile
      && re.test
      && re.exec
      && s.charAt(0) === "/"
      && s.substr(-1) === "/";
}

function isDate (d) {
  if (d instanceof Date) return true;
  if (typeof d !== "object") return false;
  var properties = Date.prototype && Object.getOwnPropertyNames(Date.prototype);
  var proto = d[protoKey] && Object.getOwnPropertyNames(d[protoKey]);
  return JSON.stringify(proto) === JSON.stringify(properties);
}

/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} value The object to print out
 * @param {Boolean} showHidden Flag that shows hidden (not enumerable)
 * properties of objects.
 */
exports.inspect = function (obj, showHidden, depth) {
  var seen = [];
  var format = function(value, recurseTimes) {
    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it
    if (value && typeof value.inspect === 'function' &&
        // Filter out the sys module, it's inspect function is special
        value !== exports &&
        // Also filter out any prototype objects using the circular check.
        !(value.constructor && value.constructor.prototype === value)) {
      return value.inspect(recurseTimes);
    }

    // Primitive types cannot have properties
    switch (typeof value) {
      case 'undefined': return 'undefined';
      case 'string':    return JSON.stringify(value).replace(/'/g, "\\'")
                                                    .replace(/\\"/g, '"')
                                                    .replace(/(^"|"$)/g, "'");
      case 'number':    return '' + value;
      case 'boolean':   return '' + value;
    }
    // For some reason typeof null is "object", so special case here.
    if (value === null) {
      return 'null';
    }

    // Look up the keys of the object.
    var keys, visible_keys = Object.keys(value);
    if (showHidden) {
      keys = Object.getOwnPropertyNames(value).map(String);
    } else {
      keys = visible_keys;
    }

    // Functions without properties can be shortcutted.
    if (typeof value === 'function' && keys.length === 0) {
      if (isRegExp(value)) {
        return '' + value;
      } else {
        return '[Function]';
      }
    }

    // Dates without properties can be shortcutted
    if (isDate(value) && keys.length === 0) {
      return value.toUTCString();
    }

    var base, type, braces;
    // Determine the object type
    if (isArray(value)) {
      type = 'Array';
      braces = ["[", "]"];
    } else {
      type = 'Object';
      braces = ["{", "}"];
    }

    // Make functions say that they are functions
    if (typeof value === 'function') {
      base = (isRegExp(value)) ? ' ' + value : ' [Function]';
    } else {
      base = "";
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + value.toUTCString();
    }

    seen.push(value);

    if (keys.length === 0) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return '' + value;
      } else {
        return "[Object]";
      }
    }

    output = keys.map(function (key) {
      var name, str;
      if (value.__lookupGetter__) {
        if (value.__lookupGetter__(key)) {
          if (value.__lookupSetter__(key)) {
            str = "[Getter/Setter]";
          } else {
            str = "[Getter]";
          }
        } else {
          if (value.__lookupSetter__(key)) {
            str = "[Setter]";
          }
        }
      }
      if (visible_keys.indexOf(key) === -1) {
        name = "[" + key + "]";
      }
      if (!str) {
        if (seen.indexOf(value[key]) === -1) {
          if ( recurseTimes === null) {
            str = format(value[key]);
          } else {
            str = format(value[key], recurseTimes - 1);
          }
          if (str.indexOf('\n') > -1) {
            if (isArray(value)) {
              str = str.split('\n').map(function(line) {
                return '  ' + line;
              }).join('\n').substr(2);
            } else {
              str = '\n' + str.split('\n').map(function(line) {
                return '   ' + line;
              }).join('\n');
            }
          }
        } else {
          str = '[Circular]';
        }
      }
      if (typeof name === 'undefined') {
        if (type === 'Array' && key.match(/^\d+$/)) {
          return str;
        }
        name = JSON.stringify('' + key);
        if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
          name = name.substr(1, name.length-2);
        } else {
          name = name.replace(/'/g, "\\'")
                     .replace(/\\"/g, '"')
                     .replace(/(^"|"$)/g, "'");
        }
      }

      return name + ": " + str;
    });

    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if( cur.indexOf('\n') >= 0 ) {
        numLinesEst++;
      }
      return prev + cur.length + 1;
    },0);

    if (length > 50) {
      output = braces[0]
             + (base === '' ? '' : base + '\n ')
             + ' '
             + output.join('\n, ')
             + (numLinesEst > 1 ? '\n' : ' ')
             + braces[1]
             ;
    } else {
      output = braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
    }

    return output;
  };
  return format(obj, (typeof depth === 'undefined' ? 2 : depth));
};
