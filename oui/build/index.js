
	app.addListener('start', function(){
		// when user changes, update the UI
		app.session.on('userchange', function(){
			// top-right corner "Hi, username"
			var userInfo = $('header .user-info');
			var self = this;
			if (!this.user) {
				// not logged in
				var template = $('shelf .user-info.signed-out').clone();
				template.find('a.signin').click(function(){
					if (ui.signInPane.visible()) {
						ui.signInPane.hide();
					}
					else {
						ui.signInPane.show().addCallback(function(){
							var username = this.element.find('input[name=username]').get(0).value;
							var password = this.element.find('input[name=password]').get(0).value;
							app.session.signIn(username, password);
						});
					}
					return false;
				});
				template.find('a.register').click(function(){
					console.warn('TODO: show registration form');
					return false;
				});
				userInfo.replaceWith(template);
			}
			else {
				// logged in
				var template = $('shelf .user-info.signed-in').clone();
				var usera = template.find('a.user');
				usera.attr('href', '#users/'+self.user.username).text(self.user.username);
				usera.click(function(){
					console.warn('TODO: show profile for user '+self.user.username);
				});
				template.find('a.signout').click(function(){
					app.session.signOut();
					return false;
				});
				userInfo.replaceWith(template);
			}
		});
	});
