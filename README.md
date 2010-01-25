# oui

A small web service toolkit for node.js

Developed as part of the new [Dropular](http://dropular.net/) website.

## Example

Here's a complete (although somewhat minimal) app:

	require('oui').start(8080)
	GET('/hello', function(params, req, res){
		return {
			message: 'hello to you too',
			you_sent_me: params
		}
	})

## Authors

- Rasmus Andersson <http://hunch.se/>

### Credit

- Inspired by [picard](http://github.com/dantebronto/picard), created by [Kellen Presley](http://bloglikepattern.com/)
- Inspired by [smisk](http://github.com/rsms/smisk)
- Code brewed with love, music and coffee.

## License

MIT (see the LICENSE file for details)
