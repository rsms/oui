var tree = require('../tree'), sys = require('sys');

tree.Expression = function Expression(value) { this.value = value };
tree.Expression.prototype = {
    eval: function (env) {
        if (this.value.length > 1) {
            return new(tree.Expression)(this.value.map(function (e) {
                return e.eval(env);
            }));
        } else {
          var x = this.value[0];
          if (!x || !x.eval)
            throw new Error('Compile error: bad tree: '+sys.inspect(x));
          return x.eval(env);
        }
    },
    toCSS: function (env) {
        var evaled;
        evaled = this.value.map(function (e) {
            if (e.eval) {
                e = e.eval(env);
            }
            return e.toCSS ? e.toCSS(env) : e;
        });
        return evaled.join(' ');
    }
};
