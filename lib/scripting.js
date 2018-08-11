/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const fs = require('fs');
const {promisify} = require('util');

module.exports = {
  async loadScriptFile(filename, vorpal) {
    await promisify(fs.access)(filename, fs.constants.R_OK);

    // Read file and split into lines
    const scriptContent = await promisify(fs.readFile)(filename);
    const scriptLines = scriptContent.toString().split(/[\r\n]+/);

    // Execute each line synchronously (but asynchronous to the main thread)
    for(const line of scriptLines) {
      if (!/^\s*#/.test(line)) {
        vorpal.log(`tineola${vorpal.chalk['yellow']('$')} ${vorpal.chalk['cyan'](line)}`);
        /*vorpal.log(`${vorpal.chalk['yellow']('>')} ${line}`);*/
        // all of Tineola's vorpal commands should RETURN a Promise, which can be awaited on
        // this is a hack since vorpal doesn't "support" async commands for some reason :(
        await vorpal.execSync(line);
      } else {
        // Wait command
        const waitMatches = line.match(/^\s*#wait\s+(\d+)/);
        if (waitMatches) {
          try {
            const waitTime = parseInt(waitMatches[1]);
            await new Promise(resolve => setTimeout(resolve, waitTime*1000));
          } catch(e) { /* do nothing */ }
        }
        // stop command
        if (line.match(/^\s*#stop/)) {
          break;
        }
      }
    }
  }
};