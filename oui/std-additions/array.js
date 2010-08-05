// NOTE: this file is used by both the server and client library, thus it need
//       to work in web browsers.

if (!Array.isArray) {
  if (jQuery && jQuery.isArray) {
    Array.isArray = jQuery.isArray;
  } else {
    Array.isArray = function(obj) {
      return Object.prototype.toString.call(obj) === "[object Array]";
    };
  }
}
if (!Array.prototype.forEach) {
  Array.prototype.forEach =  function(block, ctx) {
    var len = this.length >>> 0;
    for (var i = 0; i < len; ++i) {
      if (i in this) {
        block.call(ctx, this[i], i, this);
      }
    }
  };
}
if (!Array.prototype.map) {
  Array.prototype.map = function(fun, ctx) {
    var len = this.length >>> 0, res = new Array(len);
    for (var i = 0; i < len; ++i) {
      if (i in this) {
        res[i] = fun.call(ctx, this[i], i, this);
      }
    }
    return res;
  };
}
if (!Array.prototype.filter) {
  Array.prototype.filter = function (block, ctx) {
    var values = [];
    for (var i = 0; i < this.length; i++) {
      if (block.call(ctx, this[i])) {
        values.push(this[i]);
      }
    }
    return values;
  };
}
if (!Array.prototype.unshift) {
  Array.prototype.unshift = function() {
    this.reverse();
    var i = arguments.length;
    while (i--) {
      this.push(arguments[i]);
    }
    this.reverse();
    return this.length;
  };
}
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function(value, begin) {
    // no strict flag -- always strict search in this impl.
    var i, L = this.length;
    for (i = +begin || 0; i < L; ++i) {
      if (this[i] === value) return i;
    }
    return -1;
  };
}

/**
 * Return the first true return value from fun which is called for each value.
 * fun is called on this and receives a single argument (current value).
 */
Array.prototype.find = function (fun) {
  for (var i = 0, r; i < this.length; i++)
    if ((r = fun.call(this, this[i]))) return r;
};

/** Return a (possibly new) array which only contains unique values. */
Array.prototype.unique = function() {
  var i, tag, m = {};
  for (i=0; (tag = this[i]); ++i) m[tag] = true;
  m = Object.keys(m);
  return (m.length === this.length) ? this : m;
};

/**
 * Difference between this and other array.
 *
 * Returns a new array with values (or indices if returnIndices) which are not
 * at the same place.
 *
 * Example 1:
 *
 *   oldTags = ['computer', 'car'];
 *   newTags = ['car', 'computer', '80s'];
 *   oldTags.diff(newTags) --> ['80s']
 *
 * Example 2:
 *
 *   A = [1, 2, 3, 4, 5]
 *   B = [1, 2, 6, 4, 5, 6, 7, 8]
 *   B.diff(A)       => [3]          // values
 *   B.diff(A, true) => [2]          // indices
 *   A.diff(B)       => [8, 7, 6, 6] // values
 *   A.diff(B, true) => [7, 6, 5, 2] // indices
 */
Array.prototype.diff = function (other, returnIndices) {
  var d = [], e = -1, h, i, j, k;
  for(i = other.length, k = this.length; i--;){
    for(j = k; j && (h = other[i] !== this[--j]);){}
    // The comparator here will be optimized away by V8
    if (h) (d[++e] = returnIndices ? i : other[i]);
  }
  return d;
};

/**
 * Return a new array which contains the intersection of this and any other
 * array passed as an argument.
 */
Array.prototype.intersect = function() {
  var retArr = [], k1, arr, i, k;
  arr1keys:
  for (k1=0,L=this.length; k1<L; ++k1) {
    arrs:
    for (i=0; i < arguments.length; ++i) {
      arr = arguments[i];
      for (k=0,L=arr.length; k<L; ++k) {
        if (arr[k] === this[k1]) {
          if (i === arguments.length-1)
            retArr[k1] = this[k1];
          // If the innermost loop always leads at least once to an equal value,
          // continue the loop until done
          continue arrs;
        }
      }
      // If it got here, it wasn't found in at least one array, try next value.
      continue arr1keys;
    }
  }
  return retArr;
};
