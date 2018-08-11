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
const url = require('url');
const {handleErrors, getServerCertData} = require('../utils');
let vorpal = null;

async function connectToOrderer(ordererUrl) {
  const ordererParsed = url.parse(ordererUrl);
  let oderer_opts = {};
  if (ordererParsed.protocol === 'grpcs:') {
    if (fabric.user.clientKey) {
      oderer_opts = {clientCert: fabric.user.clientCert, clientKey: fabric.user.clientKey}
    }
    if (fabric.user.serverPem) {
      oderer_opts[pem] = fabric.user.serverPem;
    } else {
      const grpcCertData = await getServerCertData(ordererUrl);
      if (!grpcCertData || !grpcCertData.pem || !grpcCertData.name) {
        throw new Error("Unable to retrieve peer server certificate");
      }
      oderer_opts['pem'] = `${grpcCertData.pem}`;
      oderer_opts['ssl-target-name-override'] = grpcCertData.name;
    }
  }
  let orderer = fabric.client.newOrderer(ordererUrl, oderer_opts);
  //await fabric.client.queryChannels(peer);
  fabric.orderer = orderer;
  //fabric.peer_opts = peer_opts;
  vorpal.log("Successfully connected to orderer");
}

module.exports = (_vorpal) => {
  vorpal = _vorpal;

  vorpal
    .command('orderer-set <url>', 'Sets the connected orderer')
    //.option('--pem <pemFile>', 'Path to a full chain PEM for the server\'s TLS certificate (optional if connected to ca server)')
    .action( (args, cb) => {
      vorpal.log(`Connecting to orderer ${args.url}`);
      if (args.pem) {
        const serverPem = fs.readFileSync(args.pem);
        if (serverPem) {
          fabric.user.serverPem = serverPem;
        }
      }
      return handleErrors(connectToOrderer(args.url), vorpal, cb);
    });
};
