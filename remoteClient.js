const http = require('http');
const url = require('url');
const exec = require('child_process').exec;
const querystring = require('querystring');
const request = require('request');
const express = require('express');

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
const KEEP_ALIVE_PERIOD = 300000;

let status = 'idle';
var mediaProc = null;

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
	setTimeout(keepAlive, KEEP_ALIVE_PERIOD);
}

function handlePing(res) {
	setTimeout(keepAlive, KEEP_ALIVE_PERIOD);
	res.jsonp({ alive: true });
}

function handlePlay(req, res) {
	contentPlay(req.query.id);
	handleStatus(res);
}

function handleStatus(res) {
	res.jsonp({ status });
}

// Register this client with the DXMP server
api_call('device', 'register', { port:config.port, name:config.name, status:DEVICE_STATUS_BORN }).catch((err) => {
	console.error('Device registration failed', err);
});

// Upon exit, deregister this device with the server
process.on('exit', function() {
	console.log('Exiting. Deregistering device');
	api_call('device', 'register', { port:config.port, name:config.name, status:DEVICE_STATUS_DEAD });
});

const app = express();

app.get('*', (req, res) => {
	const action = req.query.action;
	switch (action) {
		case 'ping':
			handlePing(res);
			break;
		case 'play':
			handlePlay(req, res);
			break;
		case 'status':
			handleStatus(res);
			break;
	}
});

app.listen(config.port, (err) => {
	if (!err) {
		console.log(`Listening on port ${config.port}`);
	}
});