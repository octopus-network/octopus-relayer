import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";

import { LightClientState, MessageProof } from "./interfaces";
const util = require("util");

const DEFAULT_GAS = new BN("300000000000000");

const {
  APPCHAIN_ID,
  ANCHOR_CONTRACT_ID,
  RELAYER_PRIVATE_KEY,
  NEAR_NODE_URL,
  NEAR_WALLET_URL,
  NEAR_HELPER_URL,
} = process.env;

let account: Account;

export async function initNearRpc() {
  const keyPair = utils.KeyPair.fromString(RELAYER_PRIVATE_KEY as string);

  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey("testnet", "test-relayer.testnet", keyPair);

  const near = await connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: NEAR_NODE_URL as string,
    walletUrl: NEAR_WALLET_URL,
    helperUrl: NEAR_HELPER_URL,
  });
  account = await near.account("test-relayer.testnet");
  return account;
}

export async function relayMessages(args: MessageProof) {
  console.log("relayMessages-----------------------");
  console.log("\x1b[34m%s\x1b[0m", JSON.stringify(args));
  console.log("------------------------------------");
  const relayMessagesResult: any = await account.functionCall({
    contractId: ANCHOR_CONTRACT_ID as string,
    methodName: "verify_and_apply_appchain_messages",
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("0"),
  });
  const reqStatus = JSON.parse(
    Buffer.from(relayMessagesResult.status.SuccessValue, "base64").toString(
      "utf8"
    )
  );
  console.log("reqStatus", reqStatus);

  return relayMessagesResult;
}

export async function updateState(args: LightClientState) {
  console.log("updateState========================");
  console.log("\x1b[32m%s\x1b[0m", JSON.stringify(args));
  console.log("===================================");
  const relayResult: any = await account.functionCall({
    contractId: ANCHOR_CONTRACT_ID as string,
    methodName: "update_state",
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("0"),
  });
  const reqStatus = JSON.parse(
    Buffer.from(relayResult.status.SuccessValue, "base64").toString("utf8")
  );
  console.log("reqStatus", reqStatus);
  return relayResult;
}

export async function getLatestCommitmentBlockNumber() {
  return await account.viewFunction(
    ANCHOR_CONTRACT_ID as string,
    "get_latest_commitment_block_number",
    {}
  );
}

export async function tryComplete(methodName: string) {
  // console.log("tryComplete", methodName);
  // const tryCompleteResult: any = await account.functionCall({
  //   contractId: ANCHOR_CONTRACT_ID as string,
  //   methodName,
  //   args: {},
  //   gas: DEFAULT_GAS,
  //   attachedDeposit: new BN("0"),
  // });
  // let returnVal = false;
  // const returnValBase64 =
  //   tryCompleteResult.receipts_outcome[0].outcome.status.SuccessValue;
  // if (returnValBase64) {
  //   returnVal = JSON.parse(
  //     Buffer.from(returnValBase64, "base64").toString("utf8")
  //   );
  // }
  // console.log("returnVal", returnVal);
  // return returnVal;
  return true;
}
