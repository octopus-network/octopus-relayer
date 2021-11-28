import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";

import { LightClientState, MessageProof } from "./interfaces";
import { logJSON } from "./utils";
const util = require("util");

const DEFAULT_GAS = new BN("300000000000000");

import {
  anchorContractId,
  relayerPrivateKey,
  nearNodeUrl,
  nearWalletUrl,
  nearHelperUrl,
} from "./constants";

let account: Account;

export async function initNearRpc() {
  const keyPair = utils.KeyPair.fromString(relayerPrivateKey as string);

  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey("testnet", "test-relayer.testnet", keyPair);

  const near = await connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: nearNodeUrl as string,
    walletUrl: nearWalletUrl,
    helperUrl: nearHelperUrl,
  });
  account = await near.account("test-relayer.testnet");
  return account;
}

export async function relayMessages(args: MessageProof) {
  console.log("relayMessages-----------------------");
  console.log("\x1b[34m%s\x1b[0m", JSON.stringify(args));
  console.log("------------------------------------");
  return await account.functionCall({
    contractId: anchorContractId as string,
    methodName: "verify_and_apply_appchain_messages",
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("0"),
  });
}

export async function updateState(args: LightClientState) {
  console.log("updateState========================");
  console.log("\x1b[32m%s\x1b[0m", JSON.stringify(args));
  console.log("===================================");
  return await account.functionCall({
    contractId: anchorContractId as string,
    methodName: "start_updating_state_of_beefy_light_client",
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("0"),
  });
}

export async function getLatestCommitmentBlockNumber() {
  const latest_commitment = await account.viewFunction(
    anchorContractId as string,
    "get_latest_commitment_of_appchain",
    {}
  );
  return latest_commitment ? latest_commitment.block_number : 0;
}

export async function tryComplete(methodName: string) {
  console.log("tryComplete", methodName);
  const tryCompleteResult: any = await account.functionCall({
    contractId: anchorContractId as string,
    methodName,
    args: {},
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("0"),
  });
  let returnVal = "";
  const returnValBase64 = tryCompleteResult.status.SuccessValue;
  if (returnValBase64) {
    returnVal = JSON.parse(
      Buffer.from(returnValBase64, "base64").toString("utf8")
    );
  }
  console.log("tryComplete returnVal: ", returnVal);
  const isOk = returnVal === "Ok";
  return isOk;
}

export async function getAnchorSettings() {
  const anchorSettings = await account.viewFunction(
    anchorContractId as string,
    "get_anchor_settings",
    {}
  );
  return anchorSettings;
}
