/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const fabric = require('../fabric');
const fs = require('fs');
const archiver = require('archiver');
const {handleErrors} = require('../utils');
let vorpal = null;

async function createConfigJson() {
  const config = {
    "network-config": {
      org1: {
        name: "peerOrg",
        mspid: fabric.client.getMspid(),
        peer1: {
          requests: fabric.peer.getUrl(),
          "sever-hostname": fabric.peer_opts['ssl-target-name-override'],
          tls_cacerts: "/crypto/org1/tlsca.crt"
        },
        admin: {// TODO: does username need to == admin?
          "key": "/crypto/org1/admin.key",
          "cert": "/crypto/org1/amdin.crt"
        }
      },
    },
    channel: (fabric.channel ? fabric.channel.getName() : ''),
    // TODO
    /*"orderer": [
      {
      //"mspid": "%s",
      "requests": fabric.orderer._url
      }
    ],*/
    keyValueStore: "/crypto/kvs",
    configtxgenToolPath: "/farbic-bin",
    SYNC_START_DATE_FORMAT: "YYYY/MM/DD",
    syncStartDate: "2018/01/01",
    eventWaitTime: "30000",
    license: "Apache-2.0",
    version: "1.1"
  };

  return JSON.stringify(config);
}

async function createConfigZip() {
  // create a file to stream archive data to.
  const output = fs.createWriteStream('./explorerer.zip');
  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  });

  // listen for all archive data to be written
  // 'close' event is fired only when a file descriptor is involved
  output.on('close', function() {
    console.log(archive.pointer() + ' total bytes');
    console.log('archiver has been finalized and the output file descriptor has closed.');
  });

  // This event is fired when the data source is drained no matter what was the data source.
  // It is not part of this library but rather from the NodeJS Stream API.
  // @see: https://nodejs.org/api/stream.html#stream_event_end
  output.on('end', function() {
    console.log('Data has been drained');
  });

  // good practice to catch warnings (ie stat failures and other non-blocking errors)
  archive.on('warning', function(err) {
    if (err.code === 'ENOENT') {
      // log warning
    } else {
      // throw error
      throw err;
    }
  });

  // good practice to catch this error explicitly
  archive.on('error', function(err) {
    throw err;
  });

  // pipe archive data to the file
  archive.pipe(output);

  archive.append(createConfigJson(), { name: 'config.json' });
  archive.append(fabric.peer_opts['pem'], {name: 'crypto/org1/tlaca.cert'});
  archive.append()

  // finalize the archive (ie we are done appending files but streams have to finish yet)
  // 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
  archive.finalize();
}

module.exports = (_vorpal) => {
  vorpal = _vorpal;

  vorpal
    .command('explorer-gen-config', 'Generate a config file for the hyperledger block explorer')
    .action( (args, cb) => {
      const opts = createCaOptions(args);
      fabric.ca_client = new fabric.ca_sdk(opts);
      fabric.ca_url = opts.url;
      let name = fabric.ca_client.getCaName();
      if (!name) {
        name = fabric.ca_url;
      }
      vorpal.log(`Set CA to ${name}`);
      return cb();
    });
};
