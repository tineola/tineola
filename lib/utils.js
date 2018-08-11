/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const tls = require('tls');
const url = require('url');
const fabric = require('./fabric');

module.exports = {
  async handleErrors(promise, vorpal, cb) {
    //TODO: need a way to prevent HLF SDK from printing error messages
    let err = null;
    const ret = await promise.catch((e) => { err = e; });
    if (err === null) {
      vorpal.log("");
      if (typeof(cb) === 'function') {
        cb(ret);
      }
      return ret;
    }
    if (err && err.message) {
      vorpal.log(`${vorpal.chalk['red']('Error:')} ${vorpal.chalk['magenta'](err.message)}`);
    } else {
      vorpal.log(`${vorpal.chalk['red']('Error:')} ${err}`);
      if (err && err.stack !== undefined) {
        vorpal.log(err.stack);
      }
    }
    vorpal.log("");
    if (typeof(cb) === 'function') {
      cb(null);
    }
    return null;
  },

  extractErrorResponse(err) {
    // This is a hacky way of getting actual error response from HLF error objects
    const errStr = err.toString();
    const matches = errStr.match(/message: (.+)\)$/)
    if(matches) {
      return matches[1];
    }
    return errStr;
  },

  async getServerCertData(peerUrl) {
    const peerParsed = url.parse(peerUrl);
    return await new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: peerParsed.hostname,
        port: peerParsed.port,
        rejectUnauthorized: false,
      }, () => {
        const cert = socket.getPeerCertificate(true);
        resolve({pem: "-----BEGIN CERTIFICATE-----\n"+cert.raw.toString('base64')+"\n-----END CERTIFICATE-----", name: cert.subject.CN})
      });
      socket.on('error', (e) =>{
        reject(e)
      });
    })
  },

  async loadKeysFromDisk(user) {
    let ski = user.context.getSigningIdentity()._publicKey.getSKI();
    let key = await fabric.client.getCryptoSuite().getKey(ski);
    return {
      cert: user.context.getSigningIdentity()._certificate,
      key: key.toBytes()
    };
  },

  // https://stackoverflow.com/questions/8495687/split-array-into-chunks
  addLineBreaks(input, max) {
    if (! max) {
      max = 32;
    }
    matches = input.match(new RegExp(`.{1,${max}}`, 'g'));
    if (matches) {
      return matches.join("\n");
    } else {
      return input;
    }
  },

  // Returns true if all Fabric responses are status==200 or else throws with error message
  allGoodOrThrow(results) {
    const good = results[0].every(pr => pr.response && pr.response.status == 200);
    if(!good) {
      throw `Proposal rejected by some or all peers: ${results[0]}`
    }
    return true;
  },

  encodeUnPrintable(input, type, doEncode) {
    if(/[^\x20-\x7E]+/.test(input) && (doEncode === true || doEncode === undefined)) {
      if (type === 'escape') {
        return JSON.stringify(input);
      } else { // default is base64
        return Buffer.from(input).toString('base64');
      }
    } else {
      return input;
    }
  }
};