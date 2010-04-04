/*
  User protocol.
*/

function User(username){
  // A passhash member which is used during authentication and is expected to be
  // the result of BASE16( SHA1( username ":" password ) )
  // Read-only
  this.passhash;

  // A sessionRepresentation member which value is associated with a transient
  // session. Need to be a true value, since the authed test is as follows:
  //   AUTHED = session.user ? true : false
  // were `session.user` is the value of sessionRepresentation.
  // Read-only
  this.sessionRepresentation = {username:username};

  // A authedRepresentation member which value is passed to authorized clients.
  // This object should contain as much information as possible, except from
  // passhash and such sensitive data.
  // Read-only
  this.authedRepresentation = {username:username, email:"foo@bar.com"};

  // Members can be properties instead if you need to perform any processing.
}

// The find method (on the User object itself) is used to find a user by
// username.
// If a user can not be found, undefined should be passed to the callback.
User.find = function(username, callback) {
  callback();
}

/*
  Optional prototype function "checkAuthResponse" can be used to implement
  custom authentication schemes or mechanisms.

  If this method is not implemented, the default mechanism is used:
    authenticated = ( SHA1_HMAC( nonce, passhash ) == response )

  This method should return true (the "true" constant) if the provided data
  authenticates the user, and return any false value to indicate the
  authentication attempt failed. This strictness reduces the chance of
  unintentional authentication.

  Note that this function will not be called automatically if a cutsom
  "handleAuthRequest" prototype function is implemented and takes
  responsibility.
*/
User.prototype.checkAuthResponse = function(nonce, response) {
  //return hash.sha1_hmac(nonce, this.passhash) === response;
}


/*
  Optional prototype function "handleAuthRequest" can be used to implement
  fully custom authentication request and response handling.

  It is a regular http request handler, with the exception of two things:

    a) It can not return a data structure to be sent as a resonse -- it should
       instead return a true value if the function took over responsibility of
       handling the request, or a false value which will cause the default,
       built-in handler to be used.

    b) The current users session will be passed as a 4th argument and can be
       used to keep state between requests.

  It is important to know how oui tests if a session is authenticated -- it does
  so by checking true value of `session.data.user`:

    authenticated = session.data.user ? true : false;

  This means that a custom implementation must set `session.data.user` to a true
  value (preferably value of user.sessionRepresentation) upon successful
  authentication.

  Clients might also expect the value of user.authedRepresentation to be
  returned as the body of the response upon success (however, this is not
  required by oui itself as nothing relies on this).

  Return true if taking over responsibility, otherwise return a false value.
*/
User.prototype.handleAuthRequest = function(params, req, res, session) {
}


/*
  Optional prototype function "handleAuthSuccessResponse" can be used to
  implement custom response handling after a user has been successfully
  authenticated.
  
  For instance, you might want to modify the session, perform some kind of
  logging or update the user itself.
  
  If implemented and returning a true value, this function takes over
  responsibility of sending the response `res` -- failing to do so might cause
  indefinitely hanging clients. Your implementation can call `finalize` to send
  and close the response in order to let the default behaviour occur.
  
  - params -- contains the parameters in the original request.
  - req -- the original request.
  - res -- the to be-finalized response.
  - session -- the current users session.
  - finalize -- finalization callback, takes an optional error argument.
  
  If your implementation returns true and you perform some kind of custom
  response sending, you shall _not_ call `finalize`.
  
  Remember that if you implemented User.prototype.handleAuthRequest and a call
  returned true, this method (User.prototype.handleAuthSuccessResponse) will not
  be called upon automatically -- it will be entirely up to
  User.prototype.handleAuthRequest to handle the whole transaction.
  
  If a true value is returned, this function takes over responsibility for
  completing the response. If a false value is returned, oui will take care of
  finalizing the response.
*/
User.prototype.handleAuthSuccessResponse = function(params, req, res, session, finalize) {
}

// The user described above can be used as a dummy user.
exports.DummyUser = User;
