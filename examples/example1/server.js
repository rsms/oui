oui = require('./oui')
oui.start(8080)

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
		params: params
	}
}))

// Serve static files
GET(/^.+/, oui.staticFileHandler)
