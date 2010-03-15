/**
 * WebSocket-compatible interface to a comet hub.
 *
 * Events:
 * 
 *  open(Event, XMLHttpRequest)
 *    When the connection has been opened. The XMLHttpRequest argument represents the
 *    "polling" xhr.
 *
 *  message(Event, Object data, XMLHttpRequest)
 *    When a message is received.
 *
 *  error(Event, "recv"|"send", XMLHttpRequest, Exception)
 *    When a communication error occurs on XMLHttpRequest. If first argument is "send",
 *    the error occured from a send() operation. Otherwise while receiving data.
 *
 *  timeout(Event)
 *    When a polling event timed out. This is not an error and is immediately followed
 *    by a reconnect.
 *
 *  close(Event)
 *    When the connection has been closed.
 * 
 *  status(Event, int queued, int lastPublishInterval, int subscribers)
 *    Comet server status, (possibly) reported after each successful send() operation.
 * 
 */


/*
TODO

Try different techniques:

	1. first: try websocket
	2. second: try XHR (might be XSS and it might fail in the current UA)
	3. third and last: resort to JSONP

Cometps:

	- Need to implement WebSocket proto
	- Need to assure regular XHR works as expected (is it even implemented?)

*/


CometSubscriber = function(url) {
	this.url = url;
	
	this.subscribed = false;
	this.pollDelay = 10;
	this.pollTimeout = 3600000; // set to 0 for no timeout
	this.pollMinTimespent = 500;
	
	// http://dev.w3.org/html5/websockets/#the-websocket-interface
	var self = this;
	setTimeout(function(){ self.poll(); }, 1);
}

mix(CometSubscriber, EventEmitter, function(P){
	
	P.poll = function() {
		this.subscribed = true;
		var self = this;
		var dateStarted = new Date();
		console.log('GET '+this.url);
		jQuery.ajax({
			url: this.url,
			type: 'GET',
			dataType: 'jsonp',
			jsonp: 'jsonp',
			beforeSend: function(xhr, y) {
				console.log('send', xhr, y);
				this._xhr = xhr;
			},
			error: function(xhr, textStatus, exc) {
				console.log('error:', textStatus, xhr, exc);
				if (textStatus == 'timeout') {
					self.emit('timeout');
				}
				else {
					self.backoffPoll();
					self.emit('error', [xhr, textStatus, exc]);
				}
			},
			success: function(data, textStatus) {
				if (this._xhr !== undefined && this._xhr.status < 600 && this._xhr.status >= 400) {
					self.backoffPoll();
					self.emit('error', [this._xhr, textStatus]);
				}
				else {
					self.pollDelay = 10; // reset
					self.emit('message', [data, this._xhr]);
				}
			},
			complete: function(xhr, textStatus) {
				// abort if no longer subscribed
				if (!self.subscribed)
					return;
				
				// schedule next poll
				var now = new Date();
				var timespent = now.getTime() - dateStarted.getTime();
				delay = 10;
				if (timespent < self.pollMinTimespent)
					delay = self.pollMinTimespent-timespent;
				if (delay < self.pollDelay)
					delay = self.pollDelay;
				setTimeout(function(){ self.poll(); }, delay);
			}
		});
	}
	
	// --------------
	// Non-WebSocket methods:
	
	P.backoffPoll = function() {
		if (this.pollDelay < this.pollMinTimespent)
			this.pollDelay = this.pollMinTimespent;
		this.pollDelay *= 1.1;
		//console.log('backed off pollDelay to '+this.pollDelay);
	}
	
	
	// --------------
	// Private methods:
	
	P._open = function() {
		if (this.subscribed)
			return;
		this.subscribed = true;
		this._haveEmittedOpenEvent = false;
		// intially 200ms to avoid browser ui quirks:
		var self = this;
		setTimeout(function(){ self._poll(); }, 200);
	}
	
	P._updateLastMessageDate = function(r) {
		try {
			var lastmods = r.getResponseHeader('Last-Modified');
			if (typeof lastmods === 'string') {
				console.log('Last-Modified: '+lastmods);
				this.lastMessageDate = new Date(lastmods);
				this.lastMessageDate.setTime(this.lastMessageDate.getTime()+1000); // +1s
			}
		}
		catch (e) {
			console.log('warning: failed to read/parse Last-Modified', e);
		}
	}
	
	P._poll = function() {
		if (!this.subscribed)
			return;
		console.log('GET '+this.subURL);
		var _dateRequestSent = new Date();
		var self = this;
		if (self.readyState === CometSubscriber.CLOSED)
			self.readyState = CometSubscriber.CONNECTING;
		$.ajax({
			type: "GET",
			url: this.subURL,
			dataType: "json",
			timeout: this.pollTimeout,
			beforeSend: function(r) {
				// todo: save in cookie or similar, so when reloading the page, we dont get repeated messages
				if (self.lastMessageDate) {
					console.log('set: If-Modified-Since: '+self.lastMessageDate.toUTCString());
					r.setRequestHeader('If-Modified-Since', self.lastMessageDate.toUTCString());
				}
				self._activeRequestsAdd(r);
				if (self.readyState !== CometSubscriber.OPEN) {
					self.readyState = CometSubscriber.OPEN;
					self.emit('open', [r]);
				}
				this.r = r;
			},
			success: function(rsp, textStatus){
				try {
					if (this.r.status < 600 && this.r.status >= 400) {
						// error-type of response
						self.backoffPoll();
						console.log('Warning: '+this.r.status, this.r.responseText);
						self.emit('error', ['recv', this.r, exc]);
					}
					else {
						// update lastMessageDate
						self._updateLastMessageDate(this.r);
						self.pollDelay = 10; // reset
						self.emit('message', [rsp, this.r]);
					}
				}
				catch (exc) {
					console.log('error in CometSubscriber._poll -- jquery.ajax:success:', exc);
					self.emit('error', ['recv', this.r, exc]);
				}
			},
			error: function(r, textStatus, exc) {
				if (textStatus == 'timeout') {
					self.emit('timeout');
				}
				else {
					self._updateLastMessageDate(this.r);
					console.log('message request failed '+textStatus
						+ (typeof exc != 'undefined' ? ' '+exc : ''));
					self.backoffPoll();
					self.emit('error', ['recv', r, exc]);
				}
			},
			complete: function(r, textStatus) {
				self._activeRequestsRemove(r);
				
				// abort if no longer subscribed
				if (!self.subscribed)
					return;
				
				// schedule next poll
				var now = new Date();
				var timespent = now.getTime() - _dateRequestSent.getTime();
				delay = 10;
				if (timespent < self.minPollInterval)
					delay = self.minPollInterval-timespent;
				if (delay < self.pollDelay)
					delay = self.pollDelay;
				setTimeout(function(){ self._poll(); }, delay); // avoid blowing js stack
			}
		});
	}
	
	P._activeRequestsAdd = function(r) {
		this._activeRequests.push(r);
	}
	
	P._activeRequestsRemove = function(r) {
		var v = [];
		for (var k in this._activeRequests) {
			this._activeRequests.push(r);
			if (r != this._activeRequests[k])
				v.push(this._activeRequests[k]);
		}
		this._activeRequests = v;
		if (!this.subscribed && this._activeRequests.length === 0 && self.readyState !== CometSubscriber.CLOSED) {
			this.readyState = CometSubscriber.CLOSED;
			this.emit('close');
		}
	}

});
