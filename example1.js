require('./oui').start(8080)

GET('/hello', function(){
	return 'Hello to you too sir'
})

// Expose this handler for two different HTTP methods
POST('/echo/:message', GET('/echo/:message', function(params, req, res){
	require('sys').puts('message from cookie: '+req.cookie('message')) // read a cookie
	req.cookie('message', params.message) // set a cookie
	// returning complex objects automatically sends JSON (subject to change)
	return {
		key: 'some value',
		params_in: params
	}
}))

// Send a static file, possibly at the OS kernel level
GET('/sendfile', function(params, req, res) {
	res.sendFile('/change/this/to/real/path/to/a/file.jpg', 'image/jpeg')
	return false
})
