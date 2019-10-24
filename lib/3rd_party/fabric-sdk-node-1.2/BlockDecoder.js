/*
 Copyright 2017, 2018 IBM All Rights Reserved.
 SPDX-License-Identifier: Apache-2.0
*/

/*
The functions in this file are extracted from the fabric-client version 1.2 library for use with the older 1.1 branch.
The original file can be found here: https://github.com/hyperledger/fabric-sdk-node/blob/release-1.2/fabric-client/lib/BlockDecoder.js
Limited modification has been made to export the needed functions.
Original licience has been included in this directory.
 */

const grpc = require('grpc');
const _chaincodeProto = grpc.load(__dirname + '/../../../node_modules/fabric-client/lib/protos/peer/chaincode.proto').protos;

function decodeChaincodeProposalPayloadInput(chaincode_proposal_payload_input_bytes) {
    const chaincode_proposal_payload_input = {};

    // For a normal transaction, input is ChaincodeInvocationSpec.
    const proto_chaincode_invocation_spec = _chaincodeProto.ChaincodeInvocationSpec.decode(chaincode_proposal_payload_input_bytes);
    chaincode_proposal_payload_input.chaincode_spec = decodeChaincodeSpec(proto_chaincode_invocation_spec.getChaincodeSpec().toBuffer());

    return chaincode_proposal_payload_input;
}

const chaincode_type_as_string = {
    0: 'UNDEFINED',
    1: 'GOLANG',
    2: 'NODE',
    3: 'CAR',
    4: 'JAVA'
};

function chaincodeTypeToString(type) {
    let type_str = chaincode_type_as_string[type];
    if (typeof type_str == 'undefined') {
        return 'UNKNOWN';
    } else {
        return type_str;
    }
}

function decodeChaincodeSpec(chaincode_spec_bytes) {
    var chaincode_spec = {};
    var proto_chaincode_spec = _chaincodeProto.ChaincodeSpec.decode(chaincode_spec_bytes);
    chaincode_spec.type = proto_chaincode_spec.getType();
    // Add a string for the chaincode type (GOLANG, NODE, etc.)
    chaincode_spec.typeString = chaincodeTypeToString(chaincode_spec.type);
    chaincode_spec.input = decodeChaincodeInput(proto_chaincode_spec.getInput().toBuffer());
    chaincode_spec.chaincode_id = proto_chaincode_spec.getChaincodeId();
    chaincode_spec.timeout = proto_chaincode_spec.getTimeout();

    return chaincode_spec;
}

function decodeChaincodeInput(chaincode_spec_input_bytes) {
    var input = {};
    var proto_chaincode_input = _chaincodeProto.ChaincodeInput.decode(chaincode_spec_input_bytes);
    var args = proto_chaincode_input.getArgs();

    input.args = [];
    for (let i in args) {
        input.args.push(args[i].toBuffer());
    }
    let decorations = proto_chaincode_input.getDecorations();
    let keys = Object.keys(decorations.map);
    input.decorations = {};
    for (let i in keys) {
        input.decorations[keys[i]] = decorations.map[keys[i]].value.toBuffer();
    }

    return input;
}


// Tineola modification follows:
module.exports = {
    decodeChaincodeProposalPayloadInput
};
