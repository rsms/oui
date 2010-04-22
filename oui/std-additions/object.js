// NOTE: this file is used by both the server and client library, thus it need
//       to work in web browsers.

// Define a frozen constant on <obj>.
// - obj.name += 3 will fail
// - obj.name = other will fail
// - delete obj.name will fail
// However, only simple types (strings, numbers, language constants) will be
// truly immutable. Complex types (arrays, objects) will still be mutable.
if (typeof Object.defineConstant !== 'function') {
  if (typeof Object.defineProperty === 'function') {
    Object.defineConstant = function (obj, name, value, enumerable, deep) {
      Object.defineProperty(obj, name, {
        value: value,
        writable: false,
        enumerable: enumerable !== undefined ? (!!enumerable) : true,
        configurable: false
      });
    };
  } else {
    // better than nothing I guess...
    Object.defineConstant = function (obj, name, value, enumerable, deep) {
      obj[name] = value;
    };
  }
}

if (typeof Object.keys !== 'function') {
  Object.keys = function(obj){
    var keys = [];
    for (var k in obj) keys.push(k);
    return keys;
  };
}

if (typeof Object.deepEquals !== 'function') {
  var isArguments = function (object) {
    return Object.prototype.toString.call(object) === '[object Arguments]';
  };
  var pSlice = Array.prototype.slice;
  
  Object.deepEquals = function(a, b) {
    // Borrowed from http://github.com/ry/node/blob/v0.1.91/lib/assert.js
    // Originally from narwhal.js (http://narwhaljs.org)
    //
    // Copyright (c) 2009 Thomas Robinson <280north.com>
    //
    // Permission is hereby granted, free of charge, to any person obtaining a copy
    // of this software and associated documentation files (the 'Software'), to
    // deal in the Software without restriction, including without limitation the
    // rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
    // sell copies of the Software, and to permit persons to whom the Software is
    // furnished to do so, subject to the following conditions:
    //
    // The above copyright notice and this permission notice shall be included in
    // all copies or substantial portions of the Software.
    //
    // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    // IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    // FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    // AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
    // ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
    // WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
    
    // 7.1. All identical values are equivalent, as determined by ===.
    if (a === b) {
      return true;

    // 7.2. If the b value is a Date object, the a value is
    // equivalent if it is also a Date object that refers to the same time.
    } else if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();

    // 7.3. Other pairs that do not both pass typeof value == "object",
    // equivalence is determined by ==.
    } else if (typeof a !== 'object' && typeof b !== 'object') {
      return a === b;

    // 7.4. For all other Object pairs, including Array objects, equivalence is
    // determined by having the same number of owned properties (as verified
    // with Object.prototype.hasOwnProperty.call), the same set of keys
    // (although not necessarily the same order), equivalent values for every
    // corresponding key, and an identical "prototype" property. Note: this
    // accounts for both named and indexed properties on Arrays.
    } else {
      if (a === undefined || a === null || b === undefined || b === null)
        return false;
      // an identical "prototype" property.
      if (a.prototype !== b.prototype) return false;
      //~~~I've managed to break Object.keys through screwy arguments passing.
      //   Converting to array solves the problem.
      if (isArguments(a)) {
        if (!isArguments(b))
          return false;
        return Object.deepEquals(pSlice.call(a), pSlice.call(b));
      }
      var ka, kb, key, i;
      try {
        ka = Object.keys(a);
        kb = Object.keys(b);
      } catch (e) {
        // happens when one is a string literal and the other isn't
        return false;
      }
      // having the same number of owned properties (keys incorporates hasOwnProperty)
      if (ka.length !== kb.length)
        return false;
      //the same set of keys (although not necessarily the same order),
      ka.sort();
      kb.sort();
      //~~~cheap key test
      for (i = ka.length - 1; i >= 0; --i) {
        if (ka[i] !== kb[i])
          return false;
      }
      //equivalent values for every corresponding key, and
      //~~~possibly expensive deep test
      for (i = ka.length - 1; i >= 0; --i) {
        key = ka[i];
        if (!Object.deepEquals(a[key], b[key]))
          return false;
      }
      return true;
    }
  };
}

if (typeof Object.merge3 !== 'function') {
  /*
   * 3-way merge.
   *
   * Returns a structure like this:
   *
   *   { merged:
   *      { age: 13
   *      , name: 'rsms'
   *      , sex: 'm'
   *      , following: [ 'abc', 'ooo', 'xyz' ]
   *      , modified: 12345679
   *      , aliases: { abc: 'Abc', aab: 'Aab', def: 'Def' }
   *      , location: 'sto'
   *      }
   *   , added: { a: {}, b: {} }
   *   , updated:
   *      { a: {}
   *      , b:
   *         { age: 13
   *         , following: [ 'abc', 'ooo' ]
   *         , aliases: { abc: 'Abc', aab: 'Aab' }
   *         }
   *      }
   *   }
   */
  Object.merge3 = function(o, a, b, objOrShallow) {
    var r, k, v, ov, bv, inR,
      isArray = Array.isArray(a),
      hasConflicts, conflicts = {},
      newInA = {}, newInB = {},
      updatedInA = {}, updatedInB = {},
      keyUnion = {},
      deep = true;
  
    if (typeof objOrShallow !== 'object') {
      r = isArray ? [] : {};
      deep = !objOrShallow;
    } else {
      r = objOrShallow;
    }
  
    for (k in b) {
      if (isArray && isNaN((k = parseInt(k)))) continue;
      v = b[k];
      r[k] = v;
      if (!(k in o)) {
        newInB[k] = v;
      } else if (!Object.deepEquals(v, o[k])) {
        updatedInB[k] = v;
      }
    }
  
    for (k in a) {
      if (isArray && isNaN((k = parseInt(k)))) continue;
      v = a[k];
      ov = o[k];
      inR = (k in r);
      if (!inR) {
        r[k] = v;
      } else if (r[k] !== v) {
        bv = b[k];
        if (deep && typeof v === 'object' && typeof bv === 'object') {
          bv = Object.merge3((k in o && typeof ov === 'object') ? ov : {}, v, bv);
          r[k] = bv.merged;
          if (bv.conflicts) {
            conflicts[k] = {conflicts:bv.conflicts};
            hasConflicts = true;
          }
        } else if (!Object.deepEquals(r[k], v)) {
          // if 
          if (Object.deepEquals(bv, ov)) {
            // Pick A as B has not changed from O
            r[k] = v;
          } else if (!Object.deepEquals(v, ov)) {
            // A, O and B are different
            if (k in o)
              conflicts[k] = {a:v, o:ov, b:bv};
            else
              conflicts[k] = {a:v, b:bv};
            hasConflicts = true;
          } // else Pick B (already done) as A has not changed from O
        }
      }
    
      if (k in o) {
        if (!Object.deepEquals(v, ov)) {
          if (typeof v === 'object' && !Array.isArray(v)) {
            if (Object.keys(v).length === 0) {
              if (Object.keys(r[k]).length === 0)
                updatedInA[k] = v;
            } else {
              updatedInA[k] = v;
            }
          } else {
            updatedInA[k] = v;
          }
        }
      } else {
        newInA[k] = v;
      }
    }
  
    r = { merged:r };
    
    if (hasConflicts)
      r.conflicts = conflicts;
    
    a = b = false;
    for (k in newInA) { a = true; break; }
    for (k in newInB) { b = true; break; }
    if (a || b) {
      r.added = {};
      if (a) r.added.a = newInA;
      if (b) r.added.b = newInB;
    }
    
    a = b = false;
    for (k in updatedInA) { a = true; break; }
    for (k in updatedInB) { b = true; break; }
    if (a || b) {
      r.updated = {};
      if (a) r.updated.a = updatedInA;
      if (b) r.updated.b = updatedInB;
    }
    
    return r;
  };
}
