/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const fabric = require('../fabric');
const Table = require('cli-table3');
const fs = require('fs');
const {handleErrors} = require('../utils');
let vorpal = null;

function createCaOptions(args) {
  let opts = { url: args.url };
  if (args.caName) {
    opts.caName = args.caName;
  }
  if (args.options.verify) {
    opts.tlsOptions = {verify: true};
  }
  if (fabric.client.getCryptoSuite()) {
    opts.cryptoSuite = fabric.client.getCryptoSuite();
  }
  return opts;
}

async function enrollUser(username, enrollmentSecret, mspId, opts) {
  // Enrollment signs a certificate with the ca-server using a previously assigned enrollment secret
  let enrollmentOpts = {
    enrollmentID: username,
    enrollmentSecret: enrollmentSecret
  };
  if (opts.serverPEM) {
    enrollmentOpts['profile'] = 'tls';
  }
  let enrollment = await fabric.ca_client.enroll(enrollmentOpts);
  if (! opts.no_context) {
    vorpal.log("Successfully signed new certificate with ca-server");
    // createUser will save the keys to the locally configured keystore along with a username/mspId for later lookup
    //   later, the getUserContext function can retrieve this key pair w/o authenticating to ca-server
    let user = await fabric.client.createUser({
      username: username,
      mspid: mspId,
      cryptoContent: { privateKeyPEM: enrollment.key.toBytes(), signedCertPEM: enrollment.certificate }
    });
    await fabric.client.setUserContext(user);
    fabric.user.context = user;
    if (opts.serverPEM) {
      let serverPem = fs.readFileSync(opts.serverPEM);
      fabric.user.clientCert = enrollment.certificate;
      fabric.user.clientKey = enrollment.key.toBytes();
      fabric.user.serverPem = Buffer.from(serverPem).toString();
    }
    vorpal.log(`Set user context to ${username}`);
  }
  return { privateKeyPEM: enrollment.key.toBytes(), signedCertPEM: enrollment.certificate };
}

async function listCaUsers() {
  let identity_svc = fabric.ca_client.newIdentityService();
  let resp = await identity_svc.getAll(fabric.user.context);
  if (resp.success !== true) {
    throw new Error(JSON.stringify(resp.errors));
  }
  vorpal.log(`Found ${resp.result.identities.length} identity`);
  const userTable = new Table({
    head: ['User', 'Type', 'Affiliation', 'Attributes']
  });
  for(let i=0; i < resp.result.identities.length; i++) {
    let identity = resp.result.identities[i];
    if (!identity) { continue; }
    let attributes = "";
    for (let j=0; j < identity.attrs.length; j++) {
      const attr = identity.attrs[j];
      if (attributes !== "") {
        attributes += "\n";
      }
      attributes += `${attr.name}: ${attr.value}`;
    }
    userTable.push([identity.id, identity.type, identity.affiliation, attributes]);
  }
  vorpal.log(userTable.toString());
}

async function registerUser(username, attributes, enrollmentSecret, role, affiliation, max_enrollments) {
  let request = {
    enrollmentID: username,
    affiliation: '',
    maxEnrollments: 0,
  };
  if (enrollmentSecret) {
    request['enrollmentSecret'] = enrollmentSecret;
  }
  if (role) {
    request['role'] = role;
  }
  if (affiliation) {
    request['affiliation'] = affiliation;
  }
  if (max_enrollments != false) {
    request['maxEnrollments'] = max_enrollments;
  }
  if (attributes && attributes.length > 0) {
    request['attrs'] = [];
    if (attributes.length % 2 !== 0) {
      vorpal.log("Attributes must have both a key and a value");
      vorpal.log(JSON.stringify(attributes));
      return null;
    }
    for (let i=0; i<attributes.length; i+=2) {
      request['attrs'].push({name: attributes[i], value: attributes[i+1], ecert: true});
    }
  }
  vorpal.log((request));
  let secret = await fabric.ca_client.register(request, fabric.user.context);
  vorpal.log(`User successfully registered, enrollment secret = ${secret}`);
}

async function setCa(args) {
  const opts = createCaOptions(args);
  fabric.ca_client = new fabric.ca_sdk(opts);
  fabric.ca_url = opts.url;
  let name = fabric.ca_client.getCaName();
  if (!name) {
    name = fabric.ca_url;
  }
  vorpal.log(`Set CA to ${name}`);
  if (fabric.user.username) {
    vorpal.log(`Clearing all context`);
  }
  fabric.client = await fabric.newClient(fabric.ca_url, fabric.ca_client.getCaName());
  fabric.clearUser();
  fabric.channel = null;
  fabric.peer = null;
  fabric.orderer = null;
}

module.exports = (_vorpal) => {
  vorpal = _vorpal;

  vorpal
    .command('ca-set <url> [caName]', 'Set a ca-server for use in ca commands.')
    .option('-v, --verify', 'Verify server TLS cert')
    .action( (args, cb) => {
      return handleErrors(setCa(args), vorpal, cb);
    });

  vorpal
    .command('ca-enroll <enrollmentSecret> <mspId>', 'Enroll current user')
    .option('-f, --force', 'Force enrollment of new certificate')
    .option('--out', 'Output certificate information to screen')
    .option('--no-context', 'Do not switch context to newly enrolled user')
    .option('-t, --tls <serverPEM>', 'Use tls profile and save mutual tls cert')
    .validate( (args) => {
      if (! fabric.ca_client) {
        return 'Must set a ca-server first';
      }
      if (! fabric.user.username) {
        return 'Must set a username using user-set command';
      }
      if (fabric.user.context && ! args.options.force) {
        return 'User already enrolled';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(enrollUser(fabric.user.username, args.enrollmentSecret, args.mspId, {no_context: args.options.context === false, tlsPEM: args.options.tls})
        .then( (keys) => {
          if (args.options.out) {
            vorpal.log("Certificate:");
            vorpal.log(keys.signedCertPEM);
            vorpal.log("Private Key:");
            vorpal.log(keys.privateKeyPEM);
          }
        }), vorpal, cb);
    });

  vorpal
    .command('ca-register <username> [attrs...]', 'Register a new user with the ca-server')
    .option('-s, --secret <enrollmentSecret>')
    .option('-r, --role <role>')
    .option('-a, --affiliation <affiliation>')
    .option('--max-enrollments <count>')
    .validate( (args) => {
      vorpal.log(args);
      if (! fabric.ca_client) {
        return 'Must set a ca-server first';
      }
      if (! fabric.user.context) {
        return 'Must have a user context before registering new users. Use the user-set and/or ca-enroll commands';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(registerUser(
        args.username,
        args.attrs,
        args.options.secret,
        args.options.role,
        args.options.affiliation,
        args.options['max-enrollments']
      ), vorpal, cb);
    });

  vorpal
    .command('ca-list-users')
    .validate( (args) => {
      if (! fabric.ca_client) {
        return 'Must set a ca-server first';
      }
      if (! fabric.user.username) {
        return 'Must set a username using user-set command';
      }
      if (! fabric.user.context) {
        return 'Must enroll user using ca-enroll';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(listCaUsers(), vorpal, cb);
    });
};
