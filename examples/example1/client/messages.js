oui.app.on('start', function(ev){
  // Add header
  var header = fragment('header');
  $('body').append(header);

  // Enable creation form
  var createForm = header.find('form');
  createForm.submit(function(ev){
    var message = {}, fieldsToClearOnSuccess = [];
    ['title', 'message'].forEach(function(k){
      var field = createForm.find(':input[name='+k+']')[0];
      if (field) {
        message[k] = field.value;
        fieldsToClearOnSuccess.push(field);
      }
    });
    console.log('posting message', JSON.stringify(message));
    oui.http.POST('/messages', {message:message}, function(err, rsp) {
      if (err) return console.error(err);
      fieldsToClearOnSuccess.forEach(function(field){
        field.value = '';
      });
      reloadMessages();
    });
    return false;
  });

  // Setup messages
  var messageList = fragment('list', {}/*, function(){
    // this is run each time the fragment is rendered (i.e. on update())
    this.find('a[href$=/delete]').click(function(ev){
      removeMessage((/\/(\d+)\/delete$/.exec(this.href))[1]);
      return false;
    });
  }*/);
  $('body').append(messageList);
  function reloadMessages(callback) {
    oui.http.GET('/messages', function(err, rsp) {
      var messages = (rsp && rsp.data) ? rsp.data : [];
      if (callback) callback(err, messages);
      if (err) return console.error(err);
      messages.sort(function(a,b){ return a.id > b.id ? -1 : 1; }); // id desc
      messageList.context.messages = messages;
      messageList.update();
      messageList.find('a[href$=/delete]').click(function(ev){
        removeMessage((/\/(\d+)\/delete$/.exec(this.href))[1]);
        return false;
      });
    });
  }

  // Remove a message
  function removeMessage(id) {
    oui.http.GET('/messages/'+id+'/delete', function(err, rsp) {
      if (err) return console.error(err);
      console.log('removed message', id);
      reloadMessages();
    });
  }

  // Load messages
  reloadMessages(function(){
    var $reloadButton = $('<input type="button" value="Reload">');
    $('body').append(
      $reloadButton.click(function(){
        $reloadButton.attr('disabled', 'disabled');
        reloadMessages(function(){ $reloadButton.removeAttr('disabled'); });
      })
    );
  });
});