var path = require('path'),
    fs = require('fs');

var less = {
    version: [2, 0, 0],
    Parser: require('./less/parser').Parser,
    import: require('./less/parser').import,
    importer: require('./less/parser').importer,
    tree: require('./less/tree')
};

['color',    'directive', 'operation',  'dimension',
 'keyword',  'variable',  'ruleset',    'element',
 'selector', 'quoted',    'expression', 'rule',
 'call',     'url',       'alpha',      'import',
 'mixin',    'comment'
].forEach(function (n) { require('./less/tree/'+n); });

less.Parser.importer = function (file, paths, callback) {
    var pathname;
    paths.unshift('.');

    for (var i = 0; i < paths.length; i++) {
        try {
            pathname = path.join(paths[i], file);
            fs.statSync(pathname);
            break;
        } catch (e) {
            pathname = null;
        }
    }

    if (!pathname)
      return callback && callback(new Error("file '" + file + "' not found.\n"));

    fs.stat(pathname, function (e, stats) {
        if (e) return callback && callback(e);
        fs.open(pathname, process.O_RDONLY, stats.mode, function (e, fd) {
            if (e) return callback && callback(e);
            fs.read(fd, stats.size, 0, "utf8", function (e, data) {
                if (e) return callback && callback(e);
                new(less.Parser)({
                    paths: [path.dirname(pathname)]
                }).parse(data, pathname, function (e, root) {
                    if (e) callback && callback(e);
                    else callback(null, root);
                });
            });
        });
    });
}

require('./less/functions');

for (var k in less) { exports[k] = less[k] }
