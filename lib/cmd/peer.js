/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const fs = require('fs');
const url = require('url');
const Table = require('cli-table3');
const fabric = require('../fabric');
const {handleErrors, getServerCertData, allGoodOrThrow} = require('../utils');
let fabricHelper = require('../fabric-helper');
let vorpal = null;

async function connectToPeer(peerUrl) {
  const peerParsed = url.parse(peerUrl);
  let peer_opts = {};
  if (peerParsed.protocol === 'grpcs:') {
    if (fabric.user.clientKey) {
      peer_opts = {clientCert: fabric.user.clientCert, clientKey: fabric.user.clientKey}
    }
    if (fabric.user.serverPem) {
      peer_opts['pem'] = fabric.user.serverPem;
    } else {
      vorpal.log('Retrieving server keys from peer and CA server. If this fails please pass a chain file with the --pem option.')
      const grpcCertData = await getServerCertData(peerUrl);
      const caCertData = await getServerCertData(fabric.ca_url);
      if (!grpcCertData || !grpcCertData.pem || !grpcCertData.name) {
        throw new Error("Unable to retrieve peer server certificate");
      }
      if (!caCertData || !caCertData.pem) {
        throw new Error("Unable to retrieve CA server certificate");
      }
      peer_opts['pem'] = `${grpcCertData.pem}\n${caCertData.pem}`;
      peer_opts['ssl-target-name-override'] = grpcCertData.name;
    }
  }
  let peer = fabric.client.newPeer(peerUrl, peer_opts);
  await fabric.client.queryChannels(peer);
  fabric.peer = peer;
  fabric.peer_opts = peer_opts;
  vorpal.log("Successfully connected to peer");
}

async function listChannels() {
  const channels = await fabric.client.queryChannels(fabric.peer);
  if (!channels || channels.channels === null || channels.channels === undefined) { throw new Error("Channels could not be enumerated"); }
  const chanTable = new Table({
    head: ['Channel ID']
  });
  channels.channels.forEach((c) => {chanTable.push([c.channel_id])});
  vorpal.log(chanTable.toString());
}

async function listCC() {
  const ccTable = new Table({
    head: ['Name', 'Version', 'Path']
  });
  let resp = await fabric.client.queryInstalledChaincodes(fabric.peer);
  if (resp && resp.chaincodes) {
    for(let i=0; i < resp.chaincodes.length; i++) {
      let cc = resp.chaincodes[i];
      ccTable.push([cc.name, cc.version, cc.path]);
    }
  }
  vorpal.log(ccTable.toString());
}

async function installCC(ccName, ccVersion, ccPath) {
  return fabricHelper.installCC(ccName, ccVersion, ccPath);
}

module.exports = (_vorpal) => {
  vorpal = _vorpal;
  fabricHelper = fabricHelper(vorpal, fabric);
  vorpal
    .command('peer-set <url>', 'Sets the connected peer')
    .option('--pem <pemFile>', 'Path to a full chain PEM for the server\'s TLS certificate (optional if connected to ca server)')
    .action( (args, cb) => {
      vorpal.log(`Connecting to peer ${args.url}`);
      if (args.options.pem) {
        let serverPem;
        try {
          serverPem = fs.readFileSync(args.options.pem).toString();
        } catch (err) {
          vorpal.log(`Error reading pem file: ${err}`);
        }
        if (serverPem) {
          fabric.user.serverPem = serverPem;
        }
      }
      return handleErrors(connectToPeer(args.url), vorpal, cb);
    });

  vorpal
    .command('peer-list-channels', 'List channels connected to peer')
    .validate( (args) => {
      if (! fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      return true;
    })
    .action( (args, cb) => {
      return listChannels().catch((e)=>{vorpal.log(`Error: ${e}`);}).finally(cb);
    });

  vorpal
    .command('peer-list-cc', 'List chaincodes installed on peer')
    .validate( (args) => {
      if (! fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      return true;
    })
    .action( (args, cb) => {
      return listCC().catch((e)=>{vorpal.log(`Error: ${e}`);}).finally(cb);
    });

  vorpal
      .command('peer-cert <url>', 'Get the public key of a peer node')
      .action( (args, cb) => {
        return handleErrors(getServerPem(args.url).then((p)=>{vorpal.log(p)}), vorpal, cb);
      });

  vorpal
    .command('peer-install-cc <ccName> <ccVersion> <ccDir>', 'Install a chaincode on the remote peer')
    .validate( (args) => {
      if (! fabric.peer) {
        return 'Must connect to a peer with peer-set';
      }
      // TODO: validate ccDir is correct and give helpful advice
      // TODO: validate ccName/ccVersion is not installed already and give helpful info
      // TODO: validate user is a real admin and give helpful info
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(installCC(args.ccName, args.ccVersion, args.ccDir), vorpal, cb);
    });
};


