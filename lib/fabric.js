/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const FabricClient = require('fabric-client');
const FabricCaClient = require('fabric-ca-client');
const path = require('path');
const sanitizeFilename = require("sanitize-filename");

async function newFabricClient(ca_url, ca_name) {
  let client = new FabricClient();
  let store_path = module.exports.root_keystore_path;
  if (ca_url) {
    store_path = path.join(store_path, sanitizeFilename(ca_url));
  }
  if (ca_name) {
    store_path = path.join(store_path, sanitizeFilename(ca_name));
  }
  let state_store = await FabricClient.newDefaultKeyValueStore({path: store_path});
  client.setStateStore(state_store);
  let crypto_suite = FabricClient.newCryptoSuite();
  let crypto_store = FabricClient.newCryptoKeyStore({path: store_path});
  crypto_suite.setCryptoKeyStore(crypto_store);
  client.setCryptoSuite(crypto_suite);
  return client;
}

module.exports = {
  sdk: FabricClient,
  ca_sdk: FabricCaClient,
  root_keystore_path: path.join(__dirname, '.hfc-key-store'),
  client: null,
  ca_client: null,
  ca_url: null,
  user: {username: null, password: null, context: null, clientKey: null, clientCert: null, serverPem: null},
  peer: null,
  orderer: null,
  peer_opts: {},
  channel: null,
  //admin_user: {username: null, password: null, context: null, clientKey: null, clientCert: null},
  //bluemix_settings: {admin_username: null, admin_password: null, ca_url: null, ca_name: null},
  newClient: newFabricClient,
  clearUser(){ this.user = {username: null, password: null, context: null, clientKey: null, clientCert: null, serverPem: null}; }
};

