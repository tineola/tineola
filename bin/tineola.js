#!/usr/bin/env node

/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const vorpal = require('vorpal')();
const fs = require('fs');
const path = require('path');
const scripting = require('../lib/scripting');
const fabric = require('../lib/fabric');

require('../lib/cmd/ca')(vorpal);
require('../lib/cmd/user')(vorpal);
require('../lib/cmd/peer')(vorpal);
require('../lib/cmd/orderer')(vorpal);
require('../lib/cmd/channel')(vorpal);
require('../lib/cmd/tineola')(vorpal);

async function loadConfig() {
  // TODO: allow custom store_path
  fabric.root_keystore_path = path.join(__dirname, '.hfc-key-store');
  fabric.client = await fabric.newClient();
  vorpal.log("Loaded HLF client");

  // TODO: decide how to handle this better
  process.env['GOPATH'] = path.join(__dirname, "..", "chaincodes");

  if (fs.existsSync('./.tineola-rc', fs.constants.R_OK)) {
    vorpal.log("Loading tineola-rc");
    await scripting.loadScriptFile('.tineola-rc', vorpal).catch((e) => {vorpal.log(`Error executing tineola-rc: ${e}`)});
  }
}

loadConfig().then( () => {
  vorpal
    .history('tineola')
    .delimiter(`\ntineola${vorpal.chalk['yellow']('$')}`)
    .show();
});
