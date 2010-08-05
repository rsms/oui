// oui:untangled
(function(exports) {
  // first, some local helper functions (not exported)

  // Unattached element used by htmlWithSingleRootToJQuery
  var tempElement = document.createElement('span');

  /**
   * Returns a DOM fragment as a jQuery object, given a HTML string.
   *
   * Currently only supports HTML with a root element (i.e. a single outer
   * element).
   */
  function htmlWithSingleRootToJQuery(html) {
    tempElement.innerHTML = html;
    return $(tempElement.firstChild);
  }
  // fallback to slower method for other browsers
  //function htmlWithSingleRootToJQuery(html) {
  //  return $(tempElement).empty().append(html).contents();
  //}
  
  // like htmlWithSingleRootToJQuery, but takes any HTML and is slower
  function htmlToJQuery(html) {
    tempElement.innerHTML = html;
    return $(tempElement).contents();
  }
  
  function jQueryToHTML(q) {
    return $(tempElement).empty().append(q).html();
  }

  // remove comment nodes from a tree
  function removeCommentsR(node){
    var i = 0, nodes = node.childNodes, n;
    while ((n = nodes.item(i++))) {
      switch (n.nodeType) {
        case Node.ELEMENT_NODE:
          removeCommentsR(n);
          break;
        case Node.COMMENT_NODE:
          node.removeChild(n);
          i--;
      }
    }
  }
  function removeComments(jQueryObj) {
    return $(jQueryObj).each(function(i) {
      return removeCommentsR(this);
    });
  }

  // fast text trimming
  function strtrim (str) {
    str = str.replace(/^\s+/, '');
    for (var i = str.length - 1; i >= 0; i--) {
      if (/\S/.test(str.charAt(i))) {
        str = str.substring(0, i + 1);
        break;
      }
    }
    return str;
  }

  /**
   * The global context
   */
  exports.context = {};

  /**
   * Returns a new fragment (as a jQuery object or a HTML string)
   *
   * fragment(id [,context] [,asHTML[, noProcessing]] [,callback]) -> new jQuery
   * - fragment("foo")
   * - fragment("foo", {user:"john"})
   * - fragment("foo", {user:"john"}, function(err, frag) {...})
   * - fragment("foo", {user:"john"}, true, true)
   * - fragment("foo", function(err, frag) {...})
   * - fragment("foo", true)
   * - fragment("foo", true, true)
   *
   * @param id
   *  The id of the fragment template on which to build the fragment upon.
   *
   * @param context
   *  Fragment instance-local context which will extend on the global context.
   *  Later accessible as fragment.context.
   *
   * @param asHTML
   *  A true value results in a HTML string being returned instead of a fragment
   *  jQuery object.
   *
   * @param noProcessing
   *  A true value avoids/skips any processing (e.g. markdown or mustache).
   *
   * @param callback
   *  If passed, this function will be invoked when the fragment is ready.
   *  Useful for fragments which are not embedded but loaded remotely. Must be
   *  the last argument.
   */
  exports.fragment = function(id, context, asHTML, noProcessing, callback) {
    var lastarg = arguments[arguments.length-1];
    if (typeof lastarg === 'function') {
      callback = lastarg;
      if (arguments.length === 4)      noProcessing = null;
      else if (arguments.length === 3) asHTML = null;
      else if (arguments.length === 2) context = null;
    }
    var template = exports.fragment.template.cache[id], frag;
    if (template) {
      frag = template.createFragment(context, asHTML, noProcessing);
      if (callback) callback(null, frag);
    } else if (callback) {
      exports.fragment.template(id, function(err, template) {
        if (!err)
          frag = template.createFragment(context, asHTML, noProcessing);
        callback(err, frag);
      });
    } else {
      throw new Error('fragment template not found "'+id+'"');
    }
    return frag;
  };

  // Type of element which will wrap each fragment when there are multiple
  // children in one fragment
  exports.fragment.tagName = 'frag';
  // Class prefix for new fragments. <frag class="{prefix}{id}">
  exports.fragment.classPrefix = '';
  // Content preprocessors keyed by mime type
  exports.fragment.preprocessors = {};

  // Common regular expressions
  var domnameReservedRE = /[^a-zA-Z0-9_\-]+/g;
  function mkDOMName(title){
    return title.toLowerCase().replace(domnameReservedRE, '-')
      .replace(/\-+/g, '-');
  }

  function typeIsHTML(type) {
    return !type || type === 'text/html';
  }

  // Preprocess text
  function preprocess(text, type) {
    if (!text) return text;
    var pp = exports.fragment.preprocessors[type];
    if (pp) {
      text = pp(text);
    } else if (window.console) {
      console.warn(
        "fragment.js: Don't know how to process content of type '"+type+"'");
    }
    return text;
  }
  
  containsMustachoRE = /\{\{[^\{\}]+\}\}/;
  function textContainsMustacho(text) {
    return !!containsMustachoRE.test(text);
  }

  /**
   * Template prototype constructor
   */
  exports.fragment.Template = function(id, content, type) {
    var p, needMustachoPostHtmlization = false;
    if (typeof id === 'object') {
      if (!(id instanceof jQuery))
        throw new Error('first argument must be a string or a jQuery object');
      content = id;
      id = content.attr(exports.fragment.template.attrName);
      if (id) {
        content.removeAttr(exports.fragment.template.attrName);
        if ((p = id.indexOf(':')) !== -1) {
          type = id.substr(p+1);
          id = id.substr(0, p);
        }
      }
    } else {
      if (typeof content !== 'string')
        throw new Error('second argument must be a string');
      // encode mustache partial statements
      content = content.replace(/\{\{>/g, '{{&gt;');
      content = htmlWithSingleRootToJQuery('<'+exports.fragment.tagName+'>'+
                                           content+
                                           '</'+exports.fragment.tagName+'>');
    }
    this.id = id;
    // make classname
    if (typeof this.id === "string") {
      this.classname = exports.fragment.classPrefix + mkDOMName(this.id);
    }
    // add classname to outer element
    content.addClass(this.classname);
    // convert content to HTML rep
    content = jQueryToHTML(content);
    // check if content contains mustache markup
    this.containsMustacho = textContainsMustacho(content);
    // extra checks for non-html content types
    if (!typeIsHTML(type)) {
      // preprocess if not HTML and no mustache involved
      if (!this.containsMustacho) {
        content = content.replace(/&gt;/g, '>').replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&');
        content = preprocess(content, type);
        type = null;
      } else {
        // still non-html content
        this.type = type;
      }
    } else { // typeIsHTML(type) == true
      // strip comments from HTML
      if (content.indexOf('<!--') !== -1) {
        var q = htmlWithSingleRootToJQuery('<x>'+content+'</x>');
        removeComments(q);
        content = q.html();
      }
      // trim away whitespace
      content = strtrim(content);
    }
    // extract head and tail (wrapper)
    if (strtrim(content).charAt(0) === '<') {
      var startP = content.indexOf('<'), endP;
      if (startP !== -1) {
        endP = content.indexOf('>', startP);
        if (endP) {
          this.head = content.substring(startP, endP+1);
          content = content.substr(endP+1);
          startP = this.head.indexOf(' ');
          if (startP === -1) startP = this.head.indexOf('>');
          this.tail = '</'+this.head.substring(1, startP)+'>';
          startP = content.lastIndexOf(this.tail);
          if (startP !== -1) {
            content = content.substr(0, startP);
          }
        }
      }
    }
    // decode HTML encoded stuff which shouldn't be encoded
    if (this.type) {
      content = content.replace(/&gt;/g, '>').replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
    } else if (this.containsMustacho) {
      content = content.replace(/\{\{&gt;/g, '{{>');
    }
    // keep final content
    this.body = content;
  };
  $.extend(exports.fragment.Template.prototype, {
    // creates a fragment
    createFragment: function(context, asHTML, noProcessing,
                             dontExpandMustachoUntouchables) {
      if (typeof context !== 'object') {
        preMustachoed = noProcessing;
        noProcessing = asHTML;
        asHTML = context;
        context = null;
      }
      var html;
      if (noProcessing) {
        html = this.body;
      } else {
        html = this.processFragment(this.body, context, false,
                                    dontExpandMustachoUntouchables);
      }
      if (this.head) {
        html = this.head + html;
      }
      if (this.tail) {
        html += this.tail;
      }
      if (asHTML) {
        return html;
      }
      var q = htmlToJQuery(html);
      q.context = (typeof context === 'object') ? context : {};
      q.template = this;
      q.update = function() {
        q.html(q.template.processFragment(q.template.body, q.context, false,
                                          dontExpandMustachoUntouchables));
      };
      return q;
    },

    // Process a template with context and return HTML
    processFragment: function(html, context, preMustachoed,
                              dontExpandMustachoUntouchables) {
      if (typeof html !== 'string')
        throw new Error("processFragment: bad input -- typeof html !== 'string'");
      // always run through mustache if available
      if (window.mustacho && !preMustachoed) {
        var ctx = $.extend(true, {_template: this}, exports.context, context);
        var partials = exports.fragment.template.cache;
        html = mustacho.render(html, ctx, partials,
                               dontExpandMustachoUntouchables);
        if (!html) throw new Error('mustache failed');
      }
      // content converter
      if (this.type) {
        html = preprocess(html, this.type);
      }
      if (typeof html !== 'string')
        throw new Error("processFragment: internal inconsistency -- typeof html !== 'string'");
      return html;
    },

    toString: function() {
      var html = this.head ? this.head : '';
      html += this.body;
      if (this.tail) html += this.tail;
      return html;
    },
    
    preMustachoFilter: function(mustacheRenderer, context, partials) {
      if (this.type) {
        // this.type is something if the content is not HTML, in which case we
        // don't want the head or tail
        return this.body;
      } else {
        return this.toString();
      }
    },

    postMustachoFilter: function(text, mustacheRenderer, context, partials) {
      var html = this.processFragment(text, context, /*preMustachoed = */true);
      // Uncomment to add head and tail:
      //if (this.type) html = this.head + html + this.tail;
      return html;
    }
  });

  /**
   * Request a template.
   *
   * fragment.template(id [,callback]) -> Template
   *
   * @param id
   *  Fragment template id
   *
   * @param callback
   *  Invoked when the template is ready. Useful for templates which are not
   *  embedded, but loaded remotely. Must be the last argument.
   */
  exports.fragment.template = function(id, callback) {
    var t = exports.fragment.template.cache[id];
    if (t) {
      if (callback) callback(null, t);
      return t;
    } else if (!callback) {
      throw new Error('fragment template not found "'+id+'"');
    }
    var req = exports.fragment.template.requestQueue[id];
    if (req) {
      req.callbacks.push(callback);
    } else {
      var url = id;
      req = {callbacks:[callback]};
      exports.fragment.template.requestQueue[id] = req;
      $.ajax({
        url: url,
        complete: function (rsp, textStatus, err) {
          if (textStatus === 'success' && rsp.status >= 100 && rsp.status < 400) {
            var t = new exports.fragment.Template(id, rsp.responseText,
              rsp.getResponseHeader('content-type'));
            exports.fragment.template.cache[id] = t;
            for (var i=0;i<req.callbacks.length;++i)
              req.callbacks[i](null, t);
            delete exports.fragment.template.requestQueue[id];
          } else {
            var msg = rsp.status ? rsp.statusText : 'Communication error';
            msg += ' ('+url+')';
            callback(new Error(String(msg)));
          }
        }
      }); // ajax
    }
  };

  // Requests in-flight queued by id
  exports.fragment.template.requestQueue = {};

  // attribute name for embedded fragment templates
  exports.fragment.template.attrName = "fragment";

  // Map which keeps the templates, keyed by fragment template id
  exports.fragment.template.cache = {};

  /**
   * Load all templates found in the document
   */
  exports.fragment.template.loadEmbedded = function() {
    // puts all fragments on the shelf and removes them from the document
    $('body').find('*['+exports.fragment.template.attrName+'*=]').each(function(){
      var t = new exports.fragment.Template($(this).remove());
      if (t.id) exports.fragment.template.cache[t.id] = t;
    });
  };

  // When DOM is ready...
  $(function(){
    // try to detect some common preprocessors
    if (window.Showdown !== undefined
      && typeof Showdown.converter === 'function')
    {
      var mdconverter = new Showdown.converter(),
          md = function(text) { return mdconverter.makeHtml(text); };
      exports.fragment.preprocessors['text/markdown'] =
        exports.fragment.preprocessors['text/x-markdown'] = md;
    }
    // Trigger loading of templates when the DOM is ready
    exports.fragment.template.loadEmbedded();
  });
})(window);
