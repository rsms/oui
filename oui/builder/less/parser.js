var less = exports || {}, tree = require('./tree');
//
// less.js - parser
//
//    A relatively straight-forward recursive-descent parser.
//    There is no tokenization/lexing stage, the input is parsed
//    in one sweep.
//
//    To make the parser fast enough to run in the browser, several
//    optimization had to be made:
//
//    - Instead of the more commonly used technique of slicing the
//      input string on every match, we use global regexps (/g),
//      and move the `lastIndex` pointer on match, foregoing `slice()`
//      completely. This gives us a 3x speed-up.
//
//    - Matching on a huge input is often cause of slowdowns,
//      especially with the /g flag. The solution to that is to
//      chunkify the input: we split it by /\n\n/, just to be on
//      the safe side. The chunks are stored in the `chunks` var,
//      `j` holds the current chunk index, and `current` holds
//      the index of the current chunk in relation to `input`.
//      This gives us an almost 4x speed-up.
//
//    - In many cases, we don't need to match individual tokens;
//      for example, if a value doesn't hold any variables, operations
//      or dynamic references, the parser can effectively 'skip' it,
//      treating it as a literal.
//      An example would be '1px solid #000' - which evaluates to itself,
//      we don't need to know what the individual components are.
//      The drawback, of course is that you don't get the benefits of
//      syntax-checking on the CSS. This gives us a 50% speed-up in the parser,
//      and a smaller speed-up in the code-gen.
//
//
//    Token matching is done with the `$` function, which either takes
//    a terminal string or regexp, or a non-terminal function to call.
//    It also takes care of moving all the indices forwards.
//
//
less.Parser = function Parser(env) {
    var input,       // LeSS input string
        i,           // current index in `input`
        j,           // current chunk
        chunks,      // chunkified input
        current,     // index of current chunk, in `input`
        inputLength,
        parser;

    var import = {
        paths: env && env.paths || [],
        finish: function () {},
        stack: [],
        push: function (path, callback) {
            var that = this;
            var stack = this.stack;
            stack.push(path);

            less.Parser.importer(path, this.paths, function (err, root) {
                if (err) return callback && callback(err);
                callback(err, root);
                stack.splice(stack.indexOf(path), 1)
                if (stack.length === 0) {
                    that.finish();
                }
            });
        }
    };

    //
    // Parse from a token, regexp or string, and move forward if match
    //
    function $(tok) {
        var match, args, length, c, index, endIndex;

        //
        // Non-terminal
        //
        if (tok instanceof Function) {
            return tok.call(parser.parsers);
        //
        // Terminal
        //
        //     Either match a single character in the input,
        //     or match a regexp in the current chunk (chunk[j]).
        //
        } else if (typeof(tok) === 'string') {
            match = input[i] === tok ? tok : null;
            length = 1;

        //  1. We move to the next chunk, if necessary.
        //  2. Set the `lastIndex` to be relative
        //     to the current chunk, and try to match in it.
        //  3. Make sure we matched at `index`. Because we use
        //     the /g flag, the match could be anywhere in the
        //     chunk. We have to make sure it's at our previous
        //     index, which we stored in [2].
        //
        } else {
            if (i >= current + chunks[j].length &&
                j < chunks.length - 1) { // 1.
                current += chunks[j++].length;
            }
            tok.lastIndex = index =  i - current; // 2.
            match = tok.exec(chunks[j]);

            if (match) {
                length = match[0].length;
                if (tok.lastIndex - length !== index) { return } // 3.
            }
        }

        // The match is confirmed, add the match length to `i`,
        // and consume any extra white-space characters (' ' || '\n')
        // which come after that. The reason for this is that LeSS's
        // grammar is mostly white-space insensitive.
        //
        if (match) {
            i += length;
            endIndex = current + chunks[j].length;

            while (i <= endIndex) {
                c = input.charCodeAt(i);
                if (! (c === 32 || c === 10 || c === 9)) { break }
                i++;
            }
            return match.length === 1 ? match[0] : match;
        }
    }

    // Same as $(), but don't change the state of the parser,
    // just return the match.
    function peek(tok) {
        var match;

        if (typeof(tok) === 'string') {
            return input[i] === tok;
        } else {
            tok.lastIndex = i;

            if ((match = tok.exec(input)) &&
               (tok.lastIndex - match[0].length === i)) {
                return match;
            }
        }
    }


    // The optimization level dictates the thoroughness of the parser,
    // the lower the number, the less nodes it will create in the tree.
    // This could matter for debugging, or if you want to access
    // the individual nodes in the tree.
    this.optimization = 2;

    this.env = env || {};

    //
    // The Parser
    //
    return parser = {

        import: import,
        //
        // Parse an input string into an abstract syntax tree,
        // call `callback` when done.
        //
        parse: function (str, filename, callback) {
          try {
            var root, start, end, zone, line, buff = [], c, error = null;

            i = j = current = 0;
            chunks = [];
            input = str.replace(/\r\n/g, '\n');
            inputLength = input.length;

            // Split the input into chunks,
            // Either delimited by /\n\n/ or
            // delmited by '\n}' (see rationale above),
            // depending on the level of optimization.
            if (this.optimization > 0) {
                if (this.optimization > 2) {
                    input = input.replace(/\/\*(?:[^*]|\*+[^\/*])*\*+\//g, '');
                    chunks = input.split(/^(?=\n)/mg);
                } else {
                    for (var k = 0; k < input.length; k++) {
                        if ((c = input.charAt(k)) === '}' && input.charCodeAt(k - 1) === 10) {
                            chunks.push(buff.concat('}').join(''));
                            buff = [];
                        } else {
                            buff.push(c);
                        }
                    }
                    chunks.push(buff.join(''));
                }
            } else {
                chunks = [input];
            }


            // Start with the primary rule.
            // The whole syntax tree is held under a Ruleset node,
            // with the `root` property set to true, so no `{}` are
            // output. The callback is called when the input is parsed.
            try {
              root = new tree.Ruleset([], $(this.parsers.primary));
              root.root = true;
            } catch (err) {
              // the if below will take care of errors
            }

            // If `i` is smaller than the `input.length - 1`,
            // it means the parser wasn't able to parse the whole
            // string, so we've got a parsing error.
            //
            // We try to extract a \n delimited string,
            // showing the line where the parse error occured.
            // We split it up into two parts (the part which parsed,
            // and the part which didn't), so we can color them differently.
            if (i < input.length - 1) {
                start = (function () {
                    for (var n = i; n > 0; n--) {
                        if (input[n] === '\n') { break }
                    }
                    return n;
                })() + 1;
                line = (input.slice(0, i).match(/\n/g) || "").length + 1;
                end = input.slice(i).indexOf('\n') + i;
                zone = stylize(input.slice(start, i), 'green') +
                       stylize(stylize(input[i], 'inverse') +
                       input.slice(i + 1, end), 'yellow') + '\033[0m';

                error = new Error("Parse error:\n" + zone);
                error.lineno = line;
                error.filename = filename;
            }

            if (import.stack.length > 0) {
                import.finish = function () { callback(error, root) };
            } else {
                callback(error, root);
            }
          }
          catch (e) {
            require('sys').debug('MOSET HOPPAR')
            callback(e);
          }
        },

        //
        // Here in, the parsing rules/functions
        //
        // The basic structure of the syntax tree generated is as follows:
        //
        //   Ruleset ->  Rule -> Value -> Expression -> Entity
        //
        // Here's some LESS code:
        //
        //    .class {
        //      color: #fff;
        //      border: 1px solid #000;
        //      width: @w + 4px;
        //      > .child {...}
        //    }
        //
        // And here's what the parse tree might look like:
        //
        //     Ruleset (Selector '.class', [
        //         Rule ("color",  Value ([Expression [Color #fff]]))
        //         Rule ("border", Value ([Expression [Dimension 1px][Keyword "solid"][Color #000]]))
        //         Rule ("width",  Value ([Expression [Operation "+" [Variable "@w"][Dimension 4px]]]))
        //         Ruleset (Selector [Element '>', '.child'], [...])
        //     ])
        //
        //  In general, most rules will try to parse a token with the `$()` function, and if the return
        //  value is truly, will return a new node, of the relevant type. Sometimes, we need to check
        //  first, before parsing, that's when we use `peek()`.
        //
        parsers: {
            //
            // The `primary` rule is the *entry* and *exit* point of the parser.
            // The rules here can appear at any level of the parse tree.
            //
            // The recursive nature of the grammar is an interplay between the `block`
            // rule, which represents `{ ... }`, the `ruleset` rule, and this `primary` rule,
            // as represented by this simplified grammar:
            //
            //     primary  →  (ruleset | rule)+
            //     ruleset  →  selector+ block
            //     block    →  '{' primary '}'
            //
            // Only at one point is the primary rule not called from the
            // block rule: at the root level.
            //
            primary: function () {
                var node, root = [];

                while (node = $(this.mixin.definition) || $(this.ruleset) || $(this.rule) ||
                              $(this.mixin.call)       || $(this.comment) ||
                              $(/[\n\s]+/g)            || $(this.directive)) {
                    root.push(node);
                }
                return root;
            },

            // We create a Comment node for CSS comments `/* */`,
            // but keep the LeSS comments `//` silent, by just skipping
            // over them.
            comment: function () {
                var comment;

                if (input[i] !== '/') return;

                if (comment = $(/\/\*(?:[^*]|\*+[^\/*])*\*+\/\n?/g)) {
                    return new(tree.Comment)(comment);
                } else {
                    return $(/\/\/.*/g);
                }
            },

            //
            // Entities are tokens which can be found inside an Expression
            //
            entities: {
                //
                // A string, which supports escaping " and '
                //
                //     "milky way" 'he\'s the one!'
                //
                quoted: function () {
                    var str;
                    if (input[i] !== '"' && input[i] !== "'") return;

                    if (str = $(/"((?:[^"\\\r\n]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)'/g)) {
                        return new(tree.Quoted)(str[0], str[1] || str[2]);
                    }
                },

                //
                // A catch-all word, such as:
                //
                //     black border-collapse
                //
                keyword: function () {
                    var k;
                    if (k = $(/[A-Za-z-]+/g)) { return new(tree.Keyword)(k) }
                },

                //
                // A function call
                //
                //     rgb(255, 0, 255)
                //
                // We also try to catch IE's `alpha()`, but let the `alpha` parser
                // deal with the details.
                //
                // The arguments are parsed with the `entities.arguments` parser.
                //
                call: function () {
                    var name, args;

                    if (! (name = $(/([a-zA-Z0-9_-]+)\(/g))) return;

                    if (name[1].toLowerCase() === 'alpha') { return $(this.alpha) }

                    args = $(this.entities.arguments);

                    if (! $(')')) return;

                    if (name) { return new(tree.Call)(name[1], args) }
                },
                arguments: function () {
                    var args = [], arg;

                    while (arg = $(this.expression)) {
                        args.push(arg);
                        if (! $(',')) { break }
                    }
                    return args;
                },
                literal: function () {
                    return $(this.entities.dimension) ||
                           $(this.entities.color) ||
                           $(this.entities.quoted);
                },

                //
                // Parse url() tokens
                //
                // We use a specific rule for urls, because they don't really behave like
                // standard function calls. The difference is that the argument doesn't have
                // to be enclosed within a string, so it can't be parsed as an Expression.
                //
                url: function () {
                    var value;

                    if (input[i] !== 'u' || !$(/url\(/g)) return;
                    value = $(this.entities.quoted) || $(/[-a-zA-Z0-9_%@$\/.&=:;#+?]+/g);
                    if (! $(')')) throw new(Error)("missing closing ) for url()");

                    return new(tree.URL)(value);
                },

                //
                // A Variable entity, such as `@fink`, in
                //
                //     width: @fink + 2px
                //
                // We use a different parser for variable definitions,
                // see `parsers.variable`.
                //
                variable: function () {
                    var name;

                    if (input[i] === '@' && (name = $(/@[a-zA-Z0-9_-]+/g))) {
                        return new(tree.Variable)(name);
                    }
                },

                //
                // A Hexadecimal color
                //
                //     #4F3C2F
                //
                // `rgb` and `hsl` colors are parsed through the `entities.call` parser.
                //
                color: function () {
                    var rgb;

                    if (input[i] === '#' && (rgb = $(/#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})/g))) {
                        return new(tree.Color)(rgb[1]);
                    }
                },

                //
                // A Dimension, that is, a number and a unit
                //
                //     0.5em 95%
                //
                dimension: function () {
                    var value, c = input.charCodeAt(i);
                    if ((c > 57 || c < 45) || c === 47) return;

                    if (value = $(/(-?[0-9]*\.?[0-9]+)(px|%|em|pc|ex|in|deg|s|ms|pt|cm|mm)?/g)) {
                        return new(tree.Dimension)(value[1], value[2]);
                    }
                }
            },

            //
            // The variable part of a variable definition. Used in the `rule` parser
            //
            //     @fink:
            //
            variable: function () {
                var name;

                if (input[i] === '@' && (name = $(/(@[a-zA-Z0-9_-]+)\s*:/g))) { return name[1] }
            },

            //
            // A font size/line-height shorthand
            //
            //     small/12px
            //
            // We need to peek first, or we'll match on keywords and dimensions
            //
            shorthand: function () {
                var a, b;

                if (! peek(/[@\w.-]+\/[@\w.-]+/g)) return;

                if ((a = $(this.entity)) && $('/') && (b = $(this.entity))) {
                    return new(tree.Shorthand)(a, b);
                }
            },

            //
            // Mixins
            //
            mixin: {
                //
                // A Mixin call, with an optional argument list
                //
                //     #mixins > .square(#fff);
                //     .rounded(4px, black);
                //     .button;
                //
                // The `while` loop is there because mixins can be
                // namespaced, but we only support the child and descendant
                // selector for now.
                //
                call: function () {
                    var elements = [], e, c, args;

                    while (e = $(/[#.]?[a-zA-Z0-9_-]+/g)) {
                        elements.push(new(tree.Element)(c, e));
                        c = $('>');
                    }
                    $('(') && (args = $(this.entities.arguments)) && $(')');

                    if (elements.length > 0 && ($(';') || peek('}'))) {
                        return new(tree.mixin.Call)(elements, args);
                    }
                },

                //
                // A Mixin definition, with a list of parameters
                //
                //     .rounded (@radius: 2px, @color) {
                //        ...
                //     }
                //
                // Until we have a finer grained state-machine, we have to
                // do a look-ahead, to make sure we don't have a mixin call.
                // See the `rule` function for more information.
                //
                // We start by matching `.rounded (`, and then proceed on to
                // the argument list, which has optional default values.
                // We store the parameters in `params`, with a `value` key,
                // if there is a value, such as in the case of `@radius`.
                //
                // Once we've got our params list, and a closing `)`, we parse
                // the `{...}` block.
                //
                definition: function () {
                    var name, params = [], match, ruleset, param, value;

                    if (input[i] !== '.' || peek(/[^{]*(;|})/g)) return;

                    if (match = $(/([#.][a-zA-Z0-9_-]+)\s*\(/g)) {
                        name = match[1];

                        while (param = $(/@[\w-]+/g)) {
                            if ($(':')) {
                                if (value = $(this.expression)) {
                                    params.push({ name: param, value: value });
                                } else {
                                    throw new(Error)("Expected value");
                                }
                            } else {
                                params.push({ name: param });
                            }
                            if (! $(',')) { break }
                        }
                        if (! $(')')) throw new(Error)("Expected )");

                        ruleset = $(this.block);

                        if (ruleset) {
                            return new(tree.mixin.Definition)(name, params, ruleset);
                        }
                    }
                }
            },

            //
            // Entities are the smallest recognized token,
            // and can be found inside a rule's value.
            //
            entity: function () {
                return $(this.entities.literal) || $(this.entities.variable) || $(this.entities.url) ||
                       $(this.entities.call)    || $(this.entities.keyword);
            },

            //
            // A Rule terminator. Note that we use `peek()` to check for '}',
            // because the `block` rule will be expecting it, but we still need to make sure
            // it's there, if ';' was ommitted.
            //
            end: function () {
                return $(';') || peek('}');
            },

            //
            // IE's alpha function
            //
            //     alpha(opacity=88)
            //
            alpha: function () {
                var value;

                if (! $(/opacity=/gi)) return;
                if (value = $(/[0-9]+/g) || $(this.entities.variable)) {
                    if (! $(')')) throw new(Error)("missing closing ) for alpha()");
                    return new(tree.Alpha)(value);
                }
            },

            //
            // A Selector Element
            //
            //     div
            //     + h1
            //     #socks
            //     input[type="text"]
            //
            // Elements are the building blocks for Selectors,
            // they are made out of a `Combinator` (see combinator rule),
            // and an element name, such as a tag a class, or `*`.
            //
            element: function () {
                var e, t;

                c = $(this.combinator);
                e = $(/[.#:]?[a-zA-Z0-9_-]+/g) || $('*') || $(this.attribute) || $(/\([^)@]+\)/g);

                if (e) { return new(tree.Element)(c, e) }
            },

            //
            // Combinators combine elements together, in a Selector.
            //
            // Because our parser isn't white-space sensitive, special care
            // has to be taken, when parsing the descendant combinator, ` `,
            // as it's an empty space. We have to check the previous character
            // in the input, to see if it's a ` ` character. More info on how
            // we deal with this in *combinator.js*.
            //
            combinator: function () {
                var match;
                if (match = $(/[+>~]/g) || $('&') || $(/::/g)) {
                    return new(tree.Combinator)(match);
                } else {
                    return new(tree.Combinator)(input[i - 1] === " " ? " " : null);
                }
            },

            //
            // A CSS Selector
            //
            //     .class > div + h1
            //     li a:hover
            //
            // Selectors are made out of one or more Elements, see above.
            //
            selector: function () {
                var sel, e, elements = [], match;

                while (e = $(this.element)) { elements.push(e) }

                if (elements.length > 0) { return new(tree.Selector)(elements) }
            },
            tag: function () {
                return $(/[a-zA-Z][a-zA-Z-]*[0-9]?/g) || $('*');
            },
            attribute: function () {
                var attr = '', key, val, op;

                if (! $('[')) return;

                if (key = $(/[a-z]+/g) || $(this.entities.quoted)) {
                    if ((op = $(/[|~*$^]?=/g)) &&
                        (val = $(this.entities.quoted) || $(/[\w-]+/g))) {
                        attr = [key, op, val.toCSS ? val.toCSS() : val].join('');
                    } else { attr = key }
                }

                if (! $(']')) return;

                if (attr) { return "[" + attr + "]" }
            },

            //
            // The `block` rule is used by `ruleset` and `mixin.definition`.
            // It's a wrapper around the `primary` rule, with added `{}`.
            //
            block: function () {
                var content;

                if ($('{') && (content = $(this.primary)) && $('}')) {
                    return content;
                }
            },

            //
            // div, .class, body > p {...}
            //
            ruleset: function () {
                var selectors = [], s, rules, match;

                if (peek(/[^{]+[@;}]/g)) return;

                if (match = peek(/([a-z.#: _-]+)[\s\n]*\{/g)) {
                    i += match[0].length - 1;
                    selectors = [new(tree.Selector)([new(tree.Element)(null, match[1])])];
                } else {
                    while (s = $(this.selector)) {
                        selectors.push(s);
                        if (! $(',')) { break }
                    }
                    if (s) $(this.comment);
                }

                rules = $(this.block);

                if (selectors.length > 0 && rules) {
                    return new(tree.Ruleset)(selectors, rules);
                }
            },
            rule: function () {
                var value;

                if (name = $(this.property) || $(this.variable)) {
                    if ((name[0] != '@') && (match = peek(/([^@+\/*(;{}-]*);/g))) {
                        i += match[0].length - 1;
                        value = match[1];
                    } else if (name === "font") {
                        value = $(this.font);
                    } else {
                        value = $(this.value);
                    }

                    if ($(this.end)) {
                        return new(tree.Rule)(name, value);
                    }
                }
            },

            //
            // An @import directive
            //
            //     @import "lib";
            //
            // Depending on our environemnt, importing is done differently:
            // In the browser, it's an XHR request, in Node, it would be a
            // file-system operation. The function used for importing is
            // stored in `import`, which we pass to the Import constructor.
            //
            import: function () {
                var path;
                if ($(/@import\s+/g) &&
                    (path = $(this.entities.quoted) || $(this.entities.url)) &&
                    $(';')) {
                    return new(tree.Import)(path, import);
                }
            },

            //
            // A CSS Directive
            //
            //     @charset "utf-8";
            //
            directive: function () {
                var name, value, rules, types;

                if (input[i] !== '@') return;

                if (value = $(this.import)) {
                    return value;
                } else if (name = $(/@media|@page/g)) {
                    types = $(/[a-z:, ]+/g).trim();
                    if (rules = $(this.block)) {
                        return new(tree.Directive)(name + " " + types, rules);
                    }
                } else if (name = $(/@[-a-z]+/g)) {
                    if (name === '@font-face') {
                        if (rules = $(this.block)) {
                            return new(tree.Directive)(name, rules);
                        }
                    } else if ((value = $(this.entity)) && $(';')) {
                        return new(tree.Directive)(name, value);
                    }
                }
            },
            font: function () {
                var value = [], expression = [], weight, shorthand, font, e;

                while (e = $(this.shorthand) || $(this.entity)) {
                    expression.push(e);
                }
                value.push(new(tree.Expression)(expression));

                if ($(',')) {
                    while (e = $(this.expression)) {
                        value.push(e);
                        if (! $(',')) { break }
                    }
                }
                return new(tree.Value)(value, $(this.important));
            },

            //
            // A Value is a comma-delimited list of Expressions
            //
            //     font-family: Baskerville, Georgia, serif;
            //
            // In a Rule, a Value represents everything after the `:`,
            // and before the `;`.
            //
            value: function () {
                var e, expressions = [], important;

                while (e = $(this.expression)) {
                    expressions.push(e);
                    if (! $(',')) { break }
                }
                important = $(this.important);

                if (expressions.length > 0) {
                    return new(tree.Value)(expressions, important);
                }
            },
            important: function () {
                return $(/!\s*important/g);
            },
            sub: function () {
                var e;

                if ($('(') && (e = $(this.expression)) && $(')')) {
                    return e;
                }
            },
            multiplication: function () {
                var m, a, op;
                if (m = $(this.operand)) {
                    if ((op = $(/[\/*]/g)) && (a = $(this.multiplication))) {
                        return new(tree.Operation)(op, [m, a]);
                    } else {
                        return m;
                    }
                }
            },
            addition: function () {
                var m, a, op;
                if (m = $(this.multiplication)) {
                    if ((op = $(/[-+]\s+/g) || (input[i - 1] != ' ' && $(/[-+]/g))) &&
                        (a = $(this.addition))) {
                        return new(tree.Operation)(op, [m, a]);
                    } else {
                        return m;
                    }
                }
            },

            //
            // An operand is anything that can be part of an operation,
            // such as a Color, or a Variable
            //
            operand: function () {
                return $(this.sub) || $(this.entities.dimension) ||
                       $(this.entities.color) || $(this.entities.variable);
            },

            //
            // Expressions either represent mathematical operations,
            // or white-space delimited Entities.
            //
            //     1px solid black
            //     @var * 2
            //
            expression: function () {
                var e, delim, entities = [], d;

                while (e = $(this.addition) || $(this.entity)) {
                    entities.push(e);
                }
                if (entities.length > 0) {
                    return new(tree.Expression)(entities);
                }
            },
            property: function () {
                var name;

                if (name = $(/(\*?-?[-a-z]+)\s*:/g)) {
                    return name[1];
                }
            }
        }
    };
};

less.Parser.importer = null;

// Stylize a string
function stylize(str, style) {
    var styles = {
        'bold'      : [1,  22],
        'inverse'   : [7,  27],
        'underline' : [4,  24],
        'yellow'    : ['1;33', 39],
        'green'     : ['1;32', 39],
        'red'       : ['1;31', 39]
    };
    return '\033[' + styles[style][0] + 'm' + str +
           '\033[' + styles[style][1] + 'm';
}

