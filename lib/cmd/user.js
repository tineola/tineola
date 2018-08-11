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
const x509 = require('x509');
const Table = require('cli-table3');
const {handleErrors} = require('../utils');
let vorpal = null;

async function tryLoadUser(username) {
  // Pulls key from local storage and ensures key is signed by the ca-server certificate
  let user_from_store = await fabric.client.getUserContext(username, true);
  if (user_from_store && user_from_store.isEnrolled()) {
    fabric.user.context = user_from_store;
    //const signId = await loadKeysFromDisk(fabric.user);
    //fabric.client.setAdminSigningIdentity(signId.key.toString(), signId.cert.toString(), "InsuranceOrgMSP");
    vorpal.log(`Found user certificate for ${username} from local key store`);
  } else {
    vorpal.log(`Certificate for ${username} not found in local key store. Use ca-enroll command`);
    fabric.user.context = null;
  }
}

async function loadKeysFromDisk(user) {
  let ski = user.context.getSigningIdentity()._publicKey.getSKI();
  let key = await fabric.client.getCryptoSuite().getKey(ski);
  return {
    cert: user.context.getSigningIdentity()._certificate,
    key: key.toBytes()
  };
}

async function setUserKeys(user, certPath, keyPath, mspid, isAdminIdentity) {
  const certPem = Buffer.from(fs.readFileSync(certPath));
  const keyPem = Buffer.from(fs.readFileSync(keyPath));
  if (isAdminIdentity) {
    fabric.user.context.setAdminSigningIdentity(keyPem, certPem, mspid);
    vorpal.log(`Successfully loaded keys for admin identity`);
  } else {
    const newUser = await fabric.client.createUser({
      username: user.username,
      mspid: mspid,
      cryptoContent: {
        privateKeyPEM: keyPem,
        signedCertPEM: certPem
      }
    });
    fabric.user.context = newUser;
    //vorpal.log(`ret=${await fabric.client.setUserContext(newUser, true)}`);
    vorpal.log(`Successfully loaded keys for user ${user.username}`);
  }
}

function genDN(certData) {
  let output = "";
  for(key in certData) {
    if (certData.hasOwnProperty(key)) {
      if (output !== '') {
        output += "\n";
      }
      let value = certData[key];
      if (key === 'commonName') {
        value = vorpal.chalk['green'](value);
      }
      output += `${key} = ${value}`;
    }
  }
  return output;
}

function showCertContent(cert) {
  const certData = x509.parseCert(cert);
  const certTable = new Table();
  certTable.push({"Subject": genDN(certData.subject)});
  certTable.push({"Issuer": genDN(certData.issuer)});
  vorpal.log(certTable.toString());
}

async function showUserKeys(user, raw) {
  let pair = await loadKeysFromDisk(user);
  if (raw) {
    vorpal.log(vorpal.chalk['green']("User Certificate:"));
    vorpal.log(pair.cert);
    vorpal.log(vorpal.chalk['green']("User Private Key:"));
    vorpal.log(pair.key);
    if (user.clientCert) {
      vorpal.log(vorpal.chalk['green']("TLS Certificate:"));
      vorpal.log(user.clientCert);
    }
    if (user.clientKey) {
      vorpal.log(vorpal.chalk['green']("TLS Key:"));
      vorpal.log(user.clientKey);
    }
    if (user.serverPem) {
      vorpal.log(vorpal.chalk['green']("Server TLS Certificate Chain"));
      vorpal.log(user.serverPem);
    }
  } else {
    vorpal.log(vorpal.chalk['green']("User Certificate:"));
    showCertContent(pair.cert);
    if (user.clientCert) {
      vorpal.log(vorpal.chalk['green']("TLS Certificate:"));
      showCertContent(pair.cert);
    }
    if (user.serverPem) {
      vorpal.log(vorpal.chalk['green']("Chain Certificate"));
      showCertContent(user.serverPem);
    }
  }
}

async function setUserTlsKeys(user, certPath, keyPath, serverPath) {
  let certPem = fs.readFileSync(certPath);
  let keyPem = fs.readFileSync(keyPath);
  let serverPem = fs.readFileSync(serverPath);
  user.clientCert = Buffer.from(certPem).toString();
  user.clientKey = Buffer.from(keyPem).toString();
  user.serverPem = Buffer.from(serverPem).toString();
  vorpal.log("Set client tls keys");
}



module.exports = (_vorpal) => {
  vorpal = _vorpal;

  vorpal
    .command('user-set <username> [enrollmentSecret]', 'Sets the current user context')
    .action( (args, cb) => {
      if (fabric.user.username === args.username) {
        vorpal.log(`User context already assigned to ${fabric.user.username}`)
        return cb();
      }
      fabric.clearUser();
      fabric.user.username = args.username;
      return handleErrors(tryLoadUser(args.username), vorpal, cb);
    });

  vorpal
    .command('user-show-keys', 'Show the public/private key material for current user')
    .option('--raw', 'Show raw PEM encoded certificates and PRIVATE keys')
    .validate( (args) => {
      if(! fabric.user.context) {
        return 'Must setup current user context using user-set and/or ca-enroll';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(showUserKeys(fabric.user, args.options.raw), vorpal, cb);
    });

  vorpal
    .command('user-load-mutualtls-key <certPemPath> <keyPemPath> <serverPemPath>', 'Set the mutual TLS keys for the current user')
    .validate( (args) => {
      if(! fabric.user.context) {
        return 'Must set current user context using user-set and/or ca-enroll';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(setUserTlsKeys(fabric.user, args.certPemPath, args.keyPemPath, args.serverPemPath), vorpal, cb);
    });

  vorpal
    .command('user-load-keys <certPemPath> <keyPemPath> <mspId>')
    .option('--admin', 'Set the admin signing identity')
    .validate( (args) =>{
      if(! fabric.user.username) {
        return 'Must set current username with user-set';
      }
      if (args.admin && fabric.user.context === null) {
        return 'Must have a user identity before assigning admin identity. Use ca-enroll or user-load-keys.';
      }
      return true;
    })
    .action((args, cb) => {
      return handleErrors(setUserKeys(fabric.user, args.certPemPath, args.keyPemPath, args.mspId, args.admin), vorpal, cb);
    });

};



