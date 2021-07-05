import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}
import Logger, { LOGGING_LEVEL } from "./logger";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";

const relayId = "dev-oct-relay.testnet";
const receiverId = "test-receiver-id.testnet";
const tokenId = "test-stable.testnet";

async function init() {
  const wsProvider = new WsProvider("wss://rpc.polkadot.io");
  const appchain = await ApiPromise.create({ provider: wsProvider });

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
    console.log(`Received ${events.length} events`);
    events.forEach((record) => {
      const { event, phase } = record;
      const types = event.typeDef;
      // console.log("event", event);
      // console.log("phase", phase);
      // console.log("types", types);
    });
  });
}

async function testSample() {
  const { appchain, account } = await init();
  console.log("here to test");
  // test unlock, 0.1 TSB everytime
  unlockOnNear(account);
  // test events
  listenEvents(appchain);
}

testSample();
