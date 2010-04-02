var ui = exports;
/**
 * Singleton modal (doh!) dialog.
 *
 * Requires two elements to be present in the document:
 *
 *  <modal>
 *    <* class="message"></*>
 *    <* class="description">*</*>
 *    <* class="details"></*>
 *    <input type="button">
 *  </modal>
 *
 *  <modal-overlay>*</modal-overlay>
 */
ui.modalOverlay = {
  show: function() {
    $('modal-overlay').fillScreen().fadeIn(50);
  },
  hide: function() {
    $('modal-overlay').fadeOut(50);
  }
};

ui.modal = {
  prepare: function(options) {
    var ctx = {
      element: undefined,
      message: undefined,
      description: undefined,
      defaultButton: undefined,
      cancelButton: undefined,
      useOverlay: false,
      showCallback: undefined
    };
    if (typeof options === 'object')
      ctx = $.extend(ctx, options);
    if (!ctx.element)
      throw new Error('"modal" argument must be a valid element object');

    ctx.element = $(ctx.element);
    if (ctx.defaultButton === undefined)
      ctx.defaultButton = ctx.element.find('input[type=submit]');
    if (ctx.cancelButton === undefined)
      ctx.cancelButton = ctx.element.find('input[type=button]');
    ctx.promise = new oui.Promise(ctx);

    if (ctx.message)
      ctx.element.find('.message').text(ctx.message);

    if (ctx.description)
      ctx.element.find('.description').html(oui.htmlesc(ctx.description, true) || '');

    if (ctx.defaultButton)
      ctx.defaultButton.click(function(){ ctx.promise.emitSuccess(ctx.defaultButton); });
    if (ctx.cancelButton)
      ctx.cancelButton.click(function(){ ctx.promise.emitError(ctx.cancelButton); });

    ctx.promise.addCallback(function(){
      ui.modal.hide(ctx);
    }).addErrback(function(){
      ui.modal.hide(ctx);
    });

    return ctx;
  },
  show: function(ctx) {
    ctx.element.centerOnScreen();
    if (ctx.useOverlay)
      ui.modalOverlay.show();

    ctx.element.fadeIn(200, function(){
      if (typeof ctx.showCallback === 'function')
        ctx.showCallback(ctx);
    });

    return ctx.promise;
  },
  hide: function(ctx, cb) {
    if (ctx.useOverlay)
      ui.modalOverlay.hide();
    ctx.element.fadeOut(200, typeof cb === 'function' ? cb : undefined);
  },
  hideBasedOnPromise: function(promise, success) {
    if (promise) {
      if (success)
        promise.emitSuccess();
      else
        promise.emitError();
    }
  }
};

ui.alert = {
  currentPromise: null,
  show: function(message, description, details, showCallback) {
    if (ui.alert.currentPromise)
      return ui.alert.currentPromise;
    var modal = $('modal.alert');
    var detailsHtml = '';
    if (typeof details === 'object') {
      // shallow
      for (var k in details) {
        var v = details[k];
        if ($.isArray(v)) {
          v = v.join(', ');
        }
        else if (typeof v === 'object') {
          var kv = [];
          for (var k2 in v)
            kv.push($.toJSON(k2) + ': '+v);
          v = String(v.constructor || 'Object')+'{'+kv.join(', ')+'}';
        }
        detailsHtml += '<li><strong>'+oui.htmlesc(k)+':</strong> '+
          '<tt>' + oui.htmlesc(String(v)) + '</tt></li>';
      }
      var q = modal.find('.details').show();
      q.find('ul').remove();
      q.append('<ul>'+detailsHtml+'</ul>');
    }
    else {
      modal.find('.details').hide();
    }

    var ctx = ui.modal.prepare({
      element: modal,
      message: message,
      description: description,
      useOverlay: true,
      showCallback: function(ctx){
        ctx.defaultButton.each(function(){ this.focus(); });
      }
    });

    ctx.promise.addCallback(function(){
      ui.alert.currentPromise = null;
    });
    ui.alert.currentPromise = ctx.promise;
    return ui.modal.show(ctx);
  },

  hide: function(success) {
    return ui.modal.hideBasedOnPromise(ui.alert.currentPromise, success);
  }
};

ui.signInPane = {
  currentPromise: null,
  visible: function(){
    return ui.signInPane.currentPromise ? true : false;
  },
  show: function(message, description) {
    if (ui.signInPane.currentPromise)
      return ui.signInPane.currentPromise;
    var modal = ui.modal.prepare({
      element: $('modal.sign-in'),
      message: message,
      description: description,
      defaultButton: false,
      showCallback: function(modal){
        modal.element.find('input[name=username]').each(function(){ this.focus(); });
      }
    });
    // Emit success instead of submitting form
    var form = modal.element.find('form');
    form.submit(function(){
      modal.promise.emitSuccess(this);
      return false;
    });

    ui.signInPane.currentPromise = modal.promise;
    modal.promise.addCallback(function(){
      ui.signInPane.currentPromise = null;
    });
    return ui.modal.show(modal);
  },
  hide: function(success) {
    return ui.modal.hideBasedOnPromise(ui.signInPane.currentPromise, success);
  }
};
