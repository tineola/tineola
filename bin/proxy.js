#!/usr/bin/env node

/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const net = require('net');
const tls = require('tls');
const url = require('url');

function openRemote(remoteUrl) {
  const parsedUrl = url.parse(remoteUrl);
  return tls.connect({
    host: parsedUrl.hostname,
    port: parsedUrl.port,
    rejectUnauthorized: false,
  }).on('error', (err) => {
    throw err;
  });
}

function startProxy(remoteUrl, localPort) {

  const remote = {};

  const server = net.createServer((socket) => {
    socket.on('connect', () => {

    });
    socket.on('data', (data) => {
      if (!remote[socket.remotePort] || remote[socket.remotePort].destroyed) {
        console.log(`Creating remote ${socket.remotePort}`)
        remote[socket.remotePort] = openRemote(remoteUrl);
        remote[socket.remotePort].on('data', (data) => {
          //console.log(`Received ${data}`);
          socket.write(data);
        });
      }
      //console.log(`Sending ${data}`);
      remote[socket.remotePort].write(data);
    });
    socket.on('end', () => {
      if (remote[socket.remotePort] && !remote[socket.remotePort].destroyed) {
        console.log(`Closing remote ${socket.remotePort}`)
        remote[socket.remotePort].end();
      }
    });
  }).on('error', (err) => {
    // handle errors here
    throw err;
  });

  server.listen({port: localPort}, () => {
    console.log('opened server on', server.address());
  });
}

startProxy(process.argv[2], process.argv[3]);