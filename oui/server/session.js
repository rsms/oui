var sys = require("sys");
var hash = require('../hash');

function Session(sid, expires) {
  process.EventEmitter.call(this);
  this.id = sid;
  this.expires = expires;
  this.data = {};
}

sys.inherits(Session, process.EventEmitter);
exports.Session = Session;


function MemoryStore(ttl){
  process.EventEmitter.call(this);
  var options = options || {};
  this.ttl = ttl || 86400;
  this.sessions = {};
};

sys.inherits(MemoryStore, process.EventEmitter);

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

MemoryStore.prototype.findOrCreate = function(sid) {
  var session = this.find(sid);
  if (!session) session = this.create();
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

MemoryStore.prototype.create = function(sid) {
  var session;
  if (!sid) {
    do {
      sid = this.mksid();
    } while (this.sessions[sid]);
  }
  else {
    session = this.sessions[sid]
    if (session) return session;
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

exports.MemoryStore = MemoryStore;
