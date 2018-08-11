/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

const {decodeChaincodeProposalPayloadInput} = require('./3rd_party/fabric-sdk-node-1.2/BlockDecoder');
const {allGoodOrThrow} = require('./utils');

module.exports = (vorpal, fabric) => { return {

  parseArgumentsList(input) {
    let arguments = [];
    try {
      arguments = JSON.parse(input);
    } catch(e) {
      throw new Error(`Failed to parse argument list '${input}' as json: ${e}`);
    }
    if (typeof(arguments) === 'object') {
      if (arguments.length === undefined) {
        arguments = [JSON.stringify(arguments)];
      } else {
        arguments = arguments.map( (x) => {
          if(typeof(x) === 'string') {
            return x;
          } else {
            return JSON.stringify(x);
          }
        })
      }
    } else {
      arguments = [input];
    }
    return arguments;
  },

  async installCC(ccName, ccVersion, ccPath) {
    const results = await fabric.client.installChaincode({
      targets: [fabric.peer],
      chaincodePath: ccPath,
      chaincodeId: ccName,
      chaincodeVersion: ccVersion
    });
    allGoodOrThrow(results); // check for errors
    vorpal.log('Successfully received installed chaincode');
  },

  async initCC(ccName, ccVersion, args, isUpgrade) {
    const txId = fabric.client.newTransactionID();
    args = args.map(x => {
      if (typeof(x) === 'string') {
        return x;
      } else {
        return `${x}`;
      }
    });
    const request = {
      tagets: [fabric.peer],
      chaincodeVersion: ccVersion,
      chaincodeId: ccName,
      fcn: 'init',
      args: args,
      txId: txId
    };
    //vorpal.log(request);
    let results = null;
    if (isUpgrade) {
      results = await fabric.channel.sendUpgradeProposal(request);
    } else {
      results = await fabric.channel.sendInstantiateProposal(request);
    }
    allGoodOrThrow(results);
    vorpal.log('Successfully received endorsement for proposal');

    const proposalResponses = results[0];
    const proposal =  results[1];
    if (fabric.channel.getOrderers().length < 1) {
      fabric.channel.addOrderer(fabric.orderer);
    }
    const broacastResponse = await fabric.channel.sendTransaction({
      proposalResponses,
      proposal
    });
    if (broacastResponse.status !== 'SUCCESS') {
      throw broacastResponse.status;
    }
    vorpal.log('Successfully sent proposal');
  },

  async invokeCC(ccName, funcName, args) {
    const txId = fabric.client.newTransactionID();
    let request = {
      chaincodeId: ccName,
      fcn: funcName,
      args: args,
      txId: txId
    };
    //vorpal.log(request);
    let results = await fabric.channel.sendTransactionProposal(request);
    allGoodOrThrow(results);
    const proposalResponses = results[0];
    const proposal =  results[1];
    if (fabric.channel.getOrderers().length < 1) {
      fabric.channel.addOrderer(fabric.orderer);
    }
    const broacastResponse = await fabric.channel.sendTransaction({
      proposalResponses,
      proposal
    });
    if (broacastResponse.status !== 'SUCCESS') {
      throw broacastResponse.status;
    }
    return results[0][0].response.payload.toString();
  },

  async queryCC(ccName, funcName, args) {
    let request = {
      chaincodeId: ccName,
      fcn: funcName,
      args: args
    };
    //vorpal.log(request);
    let resp = await fabric.channel.queryByChaincode(request);
    if (resp && resp.length >= 1) {
      if (resp[0] instanceof Error) {
        throw resp[0];
      } else {
        return resp[0].toString();
      }
    }
    return '';
  },

  decodeBlockInput(block_input) {
    return decodeChaincodeProposalPayloadInput(block_input);
  }

}};

