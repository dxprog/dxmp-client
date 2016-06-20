const request = require('request');
const express = require('express');
const mpg123 = require('node-mpg123');

const config = {
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
const PLAYING = 'playing';
const PAUSED = 'paused';
const IDLE = 'idle';

let status = IDLE;
var mediaProc = null;

/**
 * Effectively a promise wrapper around `request`
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    request(url, (err, res, body) => {
      if (err) {
        reject(err);
      } else {
        resolve(body);
      }
    });
  });
}

/**
 * Returns the URL for an API call
 */
function getApiCallUrl(library, method, params = {}) {
  let url = `http://${config.server.host}:${config.server.port}/api/?type=json&method=${library}.${method}`;
  Object.keys(params).forEach((key) => {
    url += `&${key}=${encodeURIComponent(params[key])}`;
  });
	return url;
}

/**
 * Makes an API call to the DXMP server
 */
function makeServerCall(library, method, params = {}) {
  let url = getApiCallUrl(library, method, params);
  return httpGet(url).then((body) => {
    try {
      body = JSON.parse(body);
      return body;
    } catch (exc) {
      throw new Error('Received invalid payload from server', exc);
    }
  });
}

function contentComplete(error, stdout, stderr) {
  console.log('Media finished');
  status = IDLE;
  mediaProc = null;
}

function contentPlay(id) {
  makeServerCall('content', 'getContent', { id:id }).then((content) => {
    if (content.body.count > 0) {
      const item = content.body.content[0];

      console.log(`Playing ${item.type} "${item.title}"`);

      if (status !== IDLE || null != mediaProc) {
        mediaProc.stop();
        mediaProc = null;
      }

      mediaProc = new mpg123(getApiCallUrl('dxmp', 'getTrackFile', { id: item.id }));
      mediaProc.play();
      status = PLAYING;
      mediaProc.on('complete', contentComplete);
    }
  });
}

function keepAlive() {
  makeServerCall('device', 'register', { port:config.port, status:DEVICE_STATUS_LIVE });
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

function handlePause(res) {
  if (mediaProc) {
    if (status === PAUSED) {
      console.log('Resuming playback');
      mediaProc.resume();
      status = PLAYING;
    } else {
      console.log('Pausing playback');
      mediaProc.pause();
      status = PAUSED;
    }
  }
  res.jsonp({ okay: true });
}

function handleStatus(res) {
  res.jsonp({ status });
}

const app = express();

app.get('*', (req, res) => {
  const action = req.query.action;
  switch (action) {
    case 'pause':
      handlePause(res);
      break;
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
    // Register this client with the DXMP server
    makeServerCall('device', 'register', { port: config.port, name: config.name, status: DEVICE_STATUS_BORN }).then(() => {
      console.log('Successfully registered device');
    }).catch((err) => {
      console.error('Device registration failed', err);
    });
  }
});

// Upon exit, deregister this device with the server
process.on('exit', function() {
  console.log('Exiting. Deregistering device');
  makeServerCall('device', 'register', { port:config.port, name:config.name, status:DEVICE_STATUS_DEAD });
});