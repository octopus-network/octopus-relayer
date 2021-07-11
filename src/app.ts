import { ApiPromise, WsProvider } from "@polkadot/api";
// import { DigestItem } from "@polkadot/types/interfaces";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import { decodeAddress, encodeAddress } from "@polkadot/keyring";

import types from "./types";

const appchain_id = "easydeal-demo";
const relayId = "dev-oct-relay.testnet";

const DEFAULT_GAS = new BN("300000000000000");
const {
  RELAYER_PRIVATE_KEY,
  APPCHAIN_ENDPOINT,
  NEAR_NODE_URL,
  NEAR_WALLET_URL,
  NEAR_HELPER_URL,
} = process.env;

console.log("RELAYER_PRIVATE_KEY", RELAYER_PRIVATE_KEY);
console.log("APPCHAIN_ENDPOINT", APPCHAIN_ENDPOINT);
console.log("NEAR_NODE_URL", NEAR_NODE_URL);
console.log("NEAR_WALLET_URL", NEAR_WALLET_URL);
console.log("NEAR_HELPER_URL", NEAR_HELPER_URL);

async function init() {
  const wsProvider = new WsProvider(APPCHAIN_ENDPOINT);
  const appchain = await ApiPromise.create({
    provider: wsProvider,
    types,
  });

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
  const account = await near.account("test-relayer.testnet");
  return { appchain, account };
}

async function unlockOnNear(
  account: Account,
  sender: string,
  receiver_id: string,
  amount: string
) {
  const result = await account.functionCall({
    contractId: relayId,
    methodName: "unlock_token",
    args: {
      appchain_id,
      token_id: "usdc.testnet",
      sender,
      receiver_id,
      amount: amount,
    },
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("1250000000000000000000")
  });
  console.log(result);
}

async function listenEvents(appchain: ApiPromise, account: Account) {
  appchain.query.system.events((events) => {
    // Loop through the Vec<EventRecord>
    events.forEach((record) => {
      // Extract the phase, event and the event types
      const { event, phase } = record;
      const types = event.typeDef;

      if (event.section == "octopusAppchain" && event.method == "Burned") {
        const { data } = event;
        const assetId = data[0];
        const sender = Buffer.from(decodeAddress(data[1] as any)).toString(
          "hex"
        ) as string;
        const receiver_id = Buffer.from(data[2] as any, "hex").toString("utf8");
        const amount = data[3].toString();

        unlockOnNear(account, sender, receiver_id, amount);
      }
    });
  });

  appchain.rpc.chain.subscribeFinalizedHeads((header) => {
    // console.log("new finalized header: " + header);
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        const data = await get_offchain_data_for_commitment(
          appchain,
          commitment
        );
        console.log("data", data);
        const messages = Buffer.from(data.toString().slice(2), "hex").toString(
          "ascii"
        );
        console.log("messages", messages);
      }
    });
  });
}

async function get_offchain_data_for_commitment(
  appchain: ApiPromise,
  commitment: string
) {
  const prefixBuffer = Buffer.from("commitment", "utf8");
  const key = "0x" + prefixBuffer.toString("hex") + commitment.slice(2);
  const data = (
    await appchain.rpc.offchain.localStorageGet("PERSISTENT", key)
  ).toString();
  return data;
}

async function start() {
  const { appchain, account } = await init();
  listenEvents(appchain, account);
}

start().catch((error) => {
  console.error(error);
  process.exit(-1);
});
