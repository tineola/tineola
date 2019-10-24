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
const {handleErrors, addLineBreaks, encodeUnPrintable} = require('../utils');
let fabricHelper = require('../fabric-helper');
let vorpal = null;

async function connectToChannel(chanName) {
  let channel = fabric.client.getChannel(chanName, false);
  if (! channel) {
    channel = fabric.client.newChannel(chanName);
  }
  if (! channel) {
    throw 'Could not create Channel object';
  }
  if (channel.getPeers().length < 1) {
    channel.addPeer(fabric.peer);
  }
  const tmpChan = fabric.channel;
  fabric.channel = channel;
  try {
    await showChannelInfo();
  } catch(e) {
    fabric.channel = tmpChan;
    throw e;
  }
  vorpal.log("Channel connected");
}

async function showChannelInfo() {
  let info = await fabric.channel.queryInfo();
  const chanTable = new Table();
  chanTable.push(
    {"Name": fabric.channel.getName()},
    {"Height": info.height.toString()},
    {"Current Block Hash": info.currentBlockHash.toString('hex')},
    {"Previous Block Hash": info.previousBlockHash.toString('hex')}
  );
  vorpal.log(chanTable.toString());
}

function showTxDetails(blockData, showRW, encodeArgs) {
  const txTable = new Table();
  txTable.push(
    {"Type": blockData.payload.header.channel_header.typeString},
    {"Timestamp": blockData.payload.header.channel_header.timestamp.toString() },
    {"# of Actions": blockData.payload.data.actions.length}
  );

  blockData.payload.data.actions.forEach((a) =>{
    const spec = a.payload.chaincode_proposal_payload.input.chaincode_spec;
    const endorsers = a.payload.action.endorsements.map((e) => e.endorser.Mspid);
    const args = spec.input.args.map(a => encodeUnPrintable(a.toString(), 'base64', encodeArgs));
    const action = `${args[0]}(${args.slice(1,args.length).join(", ")})`;

    let ccId = spec.chaincode_id.name;
    if (spec.chaincode_id.version) {
      ccId = `${ccId}:${spec.chaincode_id.version}`;
    }
    if (spec.chaincode_id.path) {
      ccId = `${ccId} (path: ${spec.chaincode_id.pathversion})`;
    }

    txTable.push(
      {"Chaincode ID": ccId},
      {"Action": addLineBreaks(action,128)},
      {"Creator": a.header.creator.Mspid},
      {"Endorsers": endorsers.join("\n")}
    );

    if (showRW) {
      const ns_rwsets = a.payload.action.proposal_response_payload.extension.results.ns_rwset;
      ns_rwsets.forEach((rw) => {
        const reads = rw.rwset.reads.map((x) => {
          return vorpal.chalk['green'](addLineBreaks(encodeUnPrintable(x.key, 'escape', true), 120));
        });
        const writes = rw.rwset.writes.map((x) => {
          const greenKey = vorpal.chalk['green'](addLineBreaks(encodeUnPrintable(x.key, 'escape', true), 120));
          if (x.is_delete) {
            return `${vorpal.chalk['red']('DELETE')} ${greenKey}`;
          } else {
            return `${greenKey}\n${addLineBreaks(encodeUnPrintable(x.value, 'base64', encodeArgs), 128)}`;
          }
        });

        let elements = {};
        elements[`${rw.namespace} Read Set`] = reads.join("\n");
        txTable.push(elements);
        elements = {};
        elements[`${rw.namespace} Write Set`] = writes.join("\n\n");
        txTable.push(elements);
      })
    }
  });

  vorpal.log(txTable.toString());
}

async function showBlockInfoByNum(blockNum, showRW, encodeArgs) {
  let chanInfo = await fabric.channel.queryInfo();
  let currentBlockNum = parseInt(chanInfo.height.toString());
  if (blockNum >= currentBlockNum) {
    throw 'Block number past end of chain, cannot pull block info';
  }

  let info = await fabric.channel.queryBlock(blockNum);

  vorpal.log(vorpal.chalk['blue']('Header'));
  const orderers = info.metadata.metadata[0].signatures.map(s => s.signature_header.creator.Mspid);
  const chanTable = new Table();
  chanTable.push(
    {"Block Number": info.header.number.toString()},
    {"Data Hash": info.header.data_hash.toString('hex')},
    {"Previous Block Hash": info.header.previous_hash.toString('hex')},
    {"# of Transactions": info.data.data.length},
    {"Orderer": orderers.join("\n")}
  );
  vorpal.log(chanTable.toString());

  vorpal.log(vorpal.chalk['blue']('Transactions'));
  info.data.data.forEach( (d) => {
    if (d.payload.data.actions) {
      showTxDetails(d, showRW, encodeArgs);
    }
  });
}

async function showCallHistory(startBlock, endBlock, encodeArgs, last) {
  let info = await fabric.channel.queryInfo();
  let currentBlockNum = parseInt(info.height.toString());

  if (!endBlock) {
    if(last) {
      startBlock = currentBlockNum - startBlock;
      endBlock = currentBlockNum - 1;
      if (startBlock < 1) {
        vorpal.log(`${vorpal.chalk['yellow']('Warning:')} Block history only has ${currentBlockNum - 1} blocks, showing all`);
        startBlock = 1;
      }
    } else {
      endBlock = currentBlockNum - 1;
    }
  }

  if (endBlock >= currentBlockNum) {
    endBlock = currentBlockNum - 1;
    vorpal.log(`${vorpal.chalk['yellow']('Warning:')} End block number past end of chain, setting to ${currentBlockNum-1}`);
  }

  if (startBlock > endBlock) {
    vorpal.log(`${vorpal.chalk['yellow']('Warning:')} Start block (${startBlock}) greater than end block (${endBlock})`);
  }

  const txTable = new Table({head: ['Block #', 'CC ID', 'Action', 'Creator', 'Endorser', 'Timestamp']});
  for(let n=startBlock; n<=endBlock; n++) {
    let info = await fabric.channel.queryBlock(n);
    if (! info || info.data === undefined || info.data.data === undefined) {
      vorpal.log(`${vorpal.chalk['yelkow']('Warning:')} Failed to retrieve block data (block ${n}`);
      return;
    }

    info.data.data.forEach( (d) => {
      if (d.payload === undefined || d.payload.data === undefined) {
        vorpal.log(`${vorpal.chalk['yellow']('Warning:')} Failed to capture payload data (block ${n})`);
        return;
      }
      if (!d.payload.data.actions || d.payload.data.actions.length < 1) {
        vorpal.log(`${vorpal.chalk['yellow']('Warning:')} No actions found in payload (block ${n})`);
        return;
      }

      const timestamp = d.payload.header.channel_header.timestamp.toString();
      d.payload.data.actions.forEach( (a) => {
        const spec = fabricHelper.decodeBlockInput(a.payload.chaincode_proposal_payload.input).chaincode_spec;
        const endorsers = a.payload.action.endorsements.map((e) => e.endorser.Mspid);
        const args = spec.input.args.map(a => encodeUnPrintable(a.toString(), 'base64', encodeArgs));
        const action = `${args[0]}(${args.slice(1,args.length).join(", ")})`;
        let ccId = spec.chaincode_id.name;
        if (spec.chaincode_id.version) {
          ccId = `${ccId}:${spec.chaincode_id.version}`;
        }
        txTable.push([
          n,
          ccId,
          addLineBreaks(action,66),
          a.header.creator.Mspid,
          endorsers.join("\n"),
          addLineBreaks(timestamp, 15)
        ]);
      });
    });
  }
  vorpal.log(txTable.toString());
}

async function listChanChaincodes() {
  const ccTable = new Table({
    head: ['Name', 'Version', 'Path']
  });
  let resp = await fabric.channel.queryInstantiatedChaincodes(fabric.peer, true);
  if (resp && resp.chaincodes) {
    //vorpal.log(`Found ${resp.chaincodes.length} chaincodes`);
    for(let i=0; i < resp.chaincodes.length; i++) {
      let cc = resp.chaincodes[i];
      ccTable.push([cc.name, cc.version, cc.path]);
    }
  }
  vorpal.log(ccTable.toString());
}

async function getCcArgs(self) {
  const args = [];
  const p = await self.prompt({
    type: 'input',
    name: 'numArgs',
    default: 0,
    message: 'How many arguments to pass to function? ',
  });
  for(let i=0; i<parseInt(p.numArgs); ++i) {
    args.push((await self.prompt({
      type: 'input',
      name: 'arg',
      default: '',
      message: `Value for argument ${i+1}: `,
    })).arg);
  }
  return args;
}

async function queryCC(ccName, funcName, isInvoke, self) {
  const args = await getCcArgs(self);
  let response = null;
  if (isInvoke) {
    response = await fabricHelper.invokeCC(ccName, funcName, args);
  } else {
    response = await fabricHelper.queryCC(ccName, funcName, args);
  }
  vorpal.log(`CC Response: ${response}`);
}

async function initCC(ccName, ccVersion, self) {
  const args = await getCcArgs(self);
  return fabricHelper.initCC(ccName, ccVersion, args, false);
}

module.exports = (_vorpal) => {
  vorpal = _vorpal;
  fabricHelper = fabricHelper(vorpal, fabric);
  vorpal
    .command('channel-set <channelName>', 'Sets the connected channel')
    .validate( (args) => {
      if (! fabric.peer) {
        return 'Must connect to a peer first using peer-set';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(connectToChannel(args.channelName), vorpal, cb);
    });

  vorpal
    .command('channel-info', 'Get channel information')
    .validate( (args) => {
      if (! fabric.channel) {
        return 'Must connect to channel with channel-set';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(showChannelInfo(), vorpal, cb);
    });

  vorpal
    .command('channel-list-cc', 'Get list of instantiated chaincodes')
    .validate( (args) => {
      if (! fabric.channel) {
        return 'Must connect to channel with channel-set';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(listChanChaincodes(), vorpal, cb);
    });

  vorpal
    .command('channel-query-cc <ccName> <funcName>')
    .option('--invoke', 'Invoke and commit transaction to orderer')
    .validate( (args) => {
      if (! fabric.channel) {
        return 'Must connect to channel with channel-set';
      }
      return true;
    })
    .action( function (args, cb) {
      return handleErrors(queryCC(args.ccName, args.funcName, args.options.invoke, this), vorpal, cb);
    });

  vorpal
    .command('channel-block-info <blockNum>', 'Get information about a block by number')
    .option('--rwset', 'Show the Read/Write set for transactions of this block')
    .option('--base64', 'Encodes non-printable chaincode arguments as base64')
    .validate( (args) => {
      if (! fabric.channel) {
        return 'Must connect to channel with channel-set';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(showBlockInfoByNum(args.blockNum, args.options.rwset, args.options.base64===true), vorpal, cb);
    });

  vorpal
    .command('channel-history <startBlockNum> [endBlockNum]', 'Get all chaincode function calls between two block numbers')
    .option('--last', 'Show last N blocks. Used with one argument like "channel-history --last 5" shows the last 5 blocks')
    .option('--base64', 'Encodes non-printable chaincode arguments as base64')
    .validate( (args) => {
      if (! fabric.channel) {
        return 'Must connect to channel with channel-set';
      }
      if (args.endBlockNum && parseInt(args.startBlockNum) > parseInt(args.endBlockNum)) {
        return 'Starting block number must be before ending block number';
      }
      if (! parseInt(args.startBlockNum)) {
        return 'Starting block must be a number > 0';
      }
      return true;
    })
    .action( (args, cb) => {
      return handleErrors(showCallHistory(parseInt(args.startBlockNum), parseInt(args.endBlockNum), args.options.base64===true, args.options.last===true), vorpal, cb);
    });

  vorpal
    .command('channel-init-cc <ccName> <ccVersion>', 'Initialize (instantiate) a cc on a channel')
    .validate( (args) => {
      if (! fabric.channel) {
        return 'Must connect to channel with channel-set';
      }
      return true;
    })
    .action( function (args, cb) {
      return handleErrors(initCC(args.ccName, args.ccVersion, this), vorpal, cb);
    });
};


