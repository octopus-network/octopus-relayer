import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}
import Logger, { LOGGING_LEVEL } from "./logger";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import './interfaces/augment-api';
import './interfaces/augment-types';

import * as definitions from './interfaces/definitions';

const relayId = "dev-oct-relay.testnet";
const receiverId = "test-receiver-id.testnet";
const tokenId = "test-stable.testnet";

async function init() {
  const types = Object.values(definitions).reduce((res, { types }): object => ({ ...res, ...types }), {});
  const wsProvider = new WsProvider("ws://localhost:9944");
  const appchain = await ApiPromise.create({ provider: wsProvider, types: { ...types, 'Moment': 'u64' } });

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

async function unlockOnNear(account: Account) {
  const result = await account.functionCall(
    relayId,
    "unlock_token",
    {
      appchain_id: "testchain",
      token_id: tokenId,
      sender:
        "0xc425bbf59c7bf49e4fcc6547539d84ba8ecd2fb171f5b83cde3571d45d0c8224",
      receiver_id: receiverId,
      amount: "100000000000",
    },
    new BN("300000000000000")
  );
  console.log(result);
}

async function listenEvents(appchain: ApiPromise) {
  appchain.query.system.events((events) => {
    console.log(`\>>> ${events}`);
    console.log(`\nReceived ${events.length} events:`);

    // Loop through the Vec<EventRecord>
    events.forEach((record) => {
      // Extract the phase, event and the event types
      const { event, phase } = record;
      const types = event.typeDef;

      // Show what we are busy with
      console.log(`\t${event.section}:${event.method}:: (phase=${phase.toString()})`);
      console.log(`\t\t${event.meta.documentation.toString()}`);

      // Loop through each of the parameters, displaying the type and data
      event.data.forEach((data, index) => {
        console.log(`\t\t\t${types[index].type}: ${data.toString()}`);
      });
    });
  });
}

async function testSample() {
  const { appchain, account } = await init();
  console.log("here to test");
  // test unlock, 0.1 TSB everytime
  // unlockOnNear(account);
  // test events
  listenEvents(appchain);
}

testSample().catch((error) => {
  console.error(error);
  process.exit(-1);
});