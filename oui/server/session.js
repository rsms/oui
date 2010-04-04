var sys = require("sys"),
    hash = require('../hash'),
    authToken = require("../auth-token");

function Session(sid, expires) {
  process.EventEmitter.call(this);
  this.id = sid;
  this.expires = expires;
  this.data = {};
}

sys.inherits(Session, process.EventEmitter);
exports.Session = Session;

// TODO: move most parts into an abstract base prototype, making other kinds of
//       session backends easier to produce.

function MemoryStore(ttl){
  process.EventEmitter.call(this);
  var options = options || {};
  this.ttl = ttl || 86400;
  this.sessions = {};
};

sys.inherits(MemoryStore, process.EventEmitter);

mixin(MemoryStore.prototype, {
  // FIXME If you change these, you'll currently need to hack the oui client lib.
  sidCookieName: 'sid',
  authTokenCookieName: 'auth_token',
  authUserCookieName: 'auth_user',
  // How long persistent authentication is valid client-side (auth_token etc):
  authTTL: 30*24*60*60, // 30 days
})

MemoryStore.prototype.find = function(sid) {
  if (!sid || typeof sid !== 'string')
    return undefined;
  var session = this.sessions[sid];
  if (session) {
    session.refresh();
    if (!this.cleanupTimer)
      this.cleanup();
  }
  return session;
}

MemoryStore.prototype.findOrCreate = function(sid, req) {
  var session = this.find(sid);
  if (!session) session = this.create(req);
  return session;
}

MemoryStore.prototype.findOrSendError = function(params, req, res, requireUser) {
  // TODO: pick up SID from request headers (Cookie:...)
  var sid = params.sid || req.cookie('sid');
  if (!sid) return res.sendError(400, 'Missing sid in request');
  var session = this.find(sid);
  if (!session) return res.sendError(400, 'Invalid session '+sid);
  if (requireUser && !session.data.user)
    return res.sendError(401, 'Unauthorized');
  return session;
}

MemoryStore.prototype.create = function(sidOrRequest) {
  var session, sid, req;
  if (typeof sidOrRequest === 'object') req = sidOrRequest;
  else if (typeof sidOrRequest === 'string') sid = sidOrRequest;
  if (!sid) {
    do {
      sid = this.mksid();
    } while (this.sessions[sid]);
  }
  else {
    session = this.sessions[sid]
    if (session) {
      if (req && req.session !== session) {
        req.session = session;
        req.cookie(this.sidCookieName, session.id);
      }
      return session;
    }
  }
  var store = this;
  session = new Session(sid);

  session.refresh = function() {
    this.expires = Math.floor((+new Date) + store.ttl*1000);
  }

  session.destroy = function() {
    if (store && store.sessions[this.id] === this) {
      this.emit("destroy");
      store.emit("destroy", this);
      delete store.sessions[this.id];
    }
  }

  session.refresh();
  this.sessions[sid] = session;
  this.emit('create', session);
  if (!this.cleanupTimer)
    this.cleanup();

  if (req && req.session !== session) {
    req.session = session;
    req.cookie(this.sidCookieName, session.id);
  }

  return session;
}

MemoryStore.prototype.mksid = function(){
  var ret = '';
  for (; ret.length < 40;)
    ret += Math.floor(Math.random() * 0x100000000).toString(36);
  ret += ':';
  ret += new Date();
  return hash.sha1(ret, 62);
}

MemoryStore.prototype.cleanup = function(){
  var session, now = Date.now(), next = Infinity;
  for (var sid in this.sessions) {
    if (Object.prototype.hasOwnProperty.call(this.sessions, sid)) {
      session = this.sessions[sid];
      // Using a Max Difference because timers can be delayed by a few milliseconds.
      if (session.expires - now < 100) {
        session.destroy();
      }
      else if (session.expires < next) {
        next = session.expires;
      }
    }
  }
  if (next < Infinity && next >= 0) {
    var self = this;
    this.cleanupTimer = setTimeout(function(){
      self.cleanup.call(self);
    }, next - now);
  }
  else {
    // no more sessions with a limited lifetime
    clearInterval(this.cleanupTimer);
    delete this.cleanupTimer;
  }
};

MemoryStore.prototype.serialize = function() {
  return JSON.stringify(this.sessions);
};
MemoryStore.prototype.deserialize = function(string) {
  this.sessions = JSON.parse(string);
};

// resurrect an authenticated user
MemoryStore.prototype.resurrectAuthedUser = 
function(req, sid, auth_token, auth_user, callback) {
  var self = this,
      server = req.server,
      queued, queueKey = auth_user+":"+auth_token,
      queueEntry = {callback: callback, req: req};
  // As we can be hit by a "thundering herd" of requestes, all containing an
  // auth_token, we need to mux all requests into one, basically queueing them.
  if (!this.authedUserResurrectionsInProgress) {
    this.authedUserResurrectionsInProgress = {};
  } else {
    // enqueue callback if there's already an ongoing lookup
    queued = this.authedUserResurrectionsInProgress[queueKey];
    if (queued) {
      queued.entries.push(queueEntry);
      if (server.debug)
        sys.log('[oui] session/resurrectAuthedUser: queued user '+auth_user);
      return;
    }
  }
  
  // create queue entry
  queued = {entries: [queueEntry]};
  this.authedUserResurrectionsInProgress[queueKey] = queued;
  
  // This function replaces the single callback with cascading callback
  var finalize = function(err, callOnEachRequest){
    var q = self.authedUserResurrectionsInProgress[queueKey];
    if (q) {
      q.entries.forEach(function(entry){
        if (callOnEachRequest)
          callOnEachRequest(entry.req);
        entry.callback(err);
      });
      delete self.authedUserResurrectionsInProgress[queueKey];
    }
  }
  
  // Look up user by auth_user
  server.userPrototype.find(auth_user, function(err, user){
    if (err) return finalize(err);
    var sessions = self, session,
        serverSecret = server.authSecret,
        ttl = sessions.authTTL,
        requestFinalizer;
    if (server.debug) {
      sys.log('[oui] session/resurrectAuthedUser: '+
        'trying user '+auth_user+' from auth_token');
    }
    // If we found a user with username auth_user, validate auth_token
    if ( user
      && user.passhash
      && authToken.validate(serverSecret, user.passhash, auth_token, ttl) )
    {
      // Authenticated user successfully resurrected. Yay.
      
      // todo: consider refreshing the auth_token here. Simply
      //       authToken.generate() and return that as auth_token
      //       (client lib will handle updating).

      session = req.session;

      // We need a session
      if (!session) {
        // It's enough one of the queued requests receive a session id cookie,
        // so let's do it for the first request which was queued (req) and
        // NOT set it in requestFinalizer
        session = sessions.create(req);
      }
      
      // Assign the user to the session, marking the session as authenticated
      session.data.user = user;
      
      if (server.debug) {
        sys.log('[oui] session/resurrectAuthedUser: resurrected user '+
          user.canonicalUsername+' from auth_token.');
      }
      
      // Assign the session to each of the requests
      requestFinalizer = function(req) {
        req.session = session;
      }
    } else {
      // No such user or bad auth -- clear session if any
      if (server.debug) {
        sys.log('[oui] session/resurrectAuthedUser: '+
          'failed to resurrect user '+auth_user+' from auth_token');
      }
      requestFinalizer = function(req) {
        if (req.session) {
          req.session.destroy();
          if (sid)
            req.cookie(sessions.sidCookieName, {expires: Date.distantPast});
        }
      }
    }
    finalize(null, requestFinalizer);
  });
}

exports.MemoryStore = MemoryStore;
