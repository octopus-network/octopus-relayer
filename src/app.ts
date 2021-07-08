import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}
import Logger, { LOGGING_LEVEL } from "./logger";
import { ApiPromise, WsProvider } from "@polkadot/api";
// import { DigestItem } from "@polkadot/types/interfaces";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import { decodeAddress, encodeAddress } from "@polkadot/keyring";

import types from "./types";

const appchain_id = "testchain";
const relayId = "dev-oct-relay.testnet";
const DEFAULT_GAS = new BN("300000000000000");

async function init() {
  const wsProvider = new WsProvider(
    "wss://barnacle-dev.rpc.testnet.oct.network:9944"
  );
  const appchain = await ApiPromise.create({
    provider: wsProvider,
    types,
  });

  const privateKey =
    "ed25519:2xUVVWxJamN17xYCP5Ev4oyhJ8MK6JN6xY3nS5vmdPHiAjoR5gjsk67R12EQTauphv21UYEvzDG8p19SHmSc33wX";
  const keyPair = utils.KeyPair.fromString(privateKey);
  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey("testnet", "test-relayer.testnet", keyPair);

  const near = await connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: "https://rpc.testnet.near.org",
    walletUrl: "https://wallet.testnet.near.org",
    helperUrl: "https://helper.testnet.near.org",
  });
  const account = await near.account("test-relayer.testnet");
  return { appchain, account };
}

async function unlockOnNear(
  account: Account,
  sender: String,
  receiver_id: String,
  amount: String
) {
  const result = await account.functionCall(
    relayId,
    "unlock_token",
    {
      appchain_id,
      token_id: "usdc.testnet",
      sender,
      receiver_id,
      amount: amount,
    },
    DEFAULT_GAS
  );
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
        ) as String;
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
  commitment: String
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
