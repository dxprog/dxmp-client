const http = require('http');
const url = require('url');
const exec = require('child_process').exec;
const querystring = require('querystring');
const request = require('request');

const config = {
	ip:'10.0.0.13',
	port:1337, // Port to listen on
	name:'Matt Living Room', // Name of the server. This is what appears in the devices list
	server:{ // Path to DXMP host
		host:'dxmp.us',
		port:80
	}
};

/**
 * Constants
 */
const DEVICE_STATUS_BORN = 0;
const DEVICE_STATUS_LIVE = 1;
const DEVICE_STATUS_DEAD = 2;

var status = 'idle';
var mediaProc = null;

function parseQueryString(qs) {

	var params = [], retVal = {};

	if (typeof qs === 'string') {
		params = qs.split('&');
		for (var i = 0, count = params.length; i < count; i++) {
			var
			bits = params[i].split('='),
			key = bits[0],
			val = bits.length > 1 ? bits[1] : true;
			retVal[key] = val;
		}
	}

	return retVal;

}

function http_get(url) {
	return new Promise((resolve, reject) => {
		console.log(`Making request to ${url}`);
		request(url, (err, res, body) => {
			console.log(url);
			if (err) {
				reject(err);
			} else {
				resolve(body);
			}
		});
	});
}

function api_call(library, method, params = {}) {
	let url = `http://${config.server.host}:${config.server.port}/api/?type=json&method=${library}.${method}`;
	Object.keys(params).forEach((key) => {
		url += `&${key}=${encodeURIComponent(params[key])}`;
	});
	return http_get(url);
}

function contentComplete(error, stdout, stderr) {
	console.log('Media finished');
	status = 'idle';
	mediaProc = null;
}

function contentPlay(id) {

	api_call('content', 'getContent', { id:id }).then((data) => {

		var
			content = JSON.parse(data),
			item = null,
			file = null,
			i = 0,
			count = 0;

		if (content.body.count > 0) {
			item = content.body.content[0];

			console.log('Playing ' + item.type + ' "' + item.title + '"');

			if (status !== 'idle' || null != mediaProc) {
				mediaProc.kill();
				mediaProc = null;
			}

			switch (item.type) {
				case 'song': // 5978
					mediaProc = exec('/usr/bin/omxplayer "http://dxmp.s3.amazonaws.com/songs/' + item.meta.filename + '"');
					status = 'playing';
					mediaProc.on('exit', contentComplete);
					break;
				case 'video': // 5523
					for (i = 0, count = item.meta.files.length; i < count; i++) {
						file = item.meta.files[i];
						if (file.extension === 'm4v' || file.extension === 'mkv') {
							mediaProc = exec('/usr/bin/omxplayer "http://dev.dxprog.com/dxmpv2/videos/' + item.meta.path + '/' + file.filename + '"');
							status = 'playing';
							mediaProc.on('exit', contentComplete);
						}
					}
					break;
			}
		}

	});
}

function keepAlive() {
	api_call('device', 'register', { port:config.port, status:DEVICE_STATUS_LIVE });
	setTimeout(keepAlive, 300000);
}

// Register this client with the DXMP server
api_call('device', 'register', { port:config.port, name:config.name, status:DEVICE_STATUS_BORN }).then((thing) => {
	console.log('register finished', arguments);
});

// Upon exit, deregister this device with the server
process.on('exit', function() {
	console.log('Exiting. Deregistering device');
	api_call('device', 'register', { port:config.port, name:config.name, status:DEVICE_STATUS_DEAD });
});

// Create the response server
http.createServer(function(request, response) {
	var
	qs = querystring.parse(url.parse(request.url).query),
	callback = typeof qs.callback === 'string' ? qs.callback : false,
	retVal = 'null';
	response.writeHead(200, { 'Content-Type':'text/javascript' });

	if (qs.hasOwnProperty('action')) {

		console.log('Incoming request: ' + qs.action);

		switch (qs.action) {
			case 'ping': // A ping from the server to see if this device is still alive
				retVal = '{ "alive":true}';
				setTimeout(keepAlive, 300000);
				break;
			case 'play':
				if (qs.hasOwnProperty('id')) {
					contentPlay(qs.id);
					retVal = '{ "status":"' + status + '" }';
				}
				break;
			case 'status':
				retVal = '{ "status":"' + status + '" }';
				break;
		}
	}

	retVal = callback ? callback + '(' + retVal + ');' : retVal;
	response.end(retVal);

}).listen(config.port, (err) => {
	console.log(`Server running on port ${config.port}`);
});