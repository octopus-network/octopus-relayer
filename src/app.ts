import { ApiPromise, WsProvider } from "@polkadot/api";
import { Header, Event } from "@polkadot/types/interfaces";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import { decodeAddress, encodeAddress } from "@polkadot/keyring";

import types from "./types";
import { dbRunAsync, dbAllAsync, initDb } from "./db";
import { Commitment } from "./interfaces";

const relayId = 'dev-oct-relay.testnet';

const DEFAULT_GAS = new BN('300000000000000');
const MINIMUM_DEPOSIT = new BN('1250000000000000000000');

const {
  APPCHAIN_ID,
  APPCHAIN_TOKEN_ID,
  RELAYER_PRIVATE_KEY,
  APPCHAIN_ENDPOINT,
  NEAR_NODE_URL,
  NEAR_WALLET_URL,
  NEAR_HELPER_URL,
} = process.env;

console.log("APPCHAIN_ID", APPCHAIN_ID);
console.log("APPCHAIN_TOKEN_ID", APPCHAIN_TOKEN_ID);
console.log("RELAYER_PRIVATE_KEY", RELAYER_PRIVATE_KEY);
console.log("APPCHAIN_ENDPOINT", APPCHAIN_ENDPOINT);
console.log("NEAR_NODE_URL", NEAR_NODE_URL);
console.log("NEAR_WALLET_URL", NEAR_WALLET_URL);
console.log("NEAR_HELPER_URL", NEAR_HELPER_URL);

if (!APPCHAIN_ID || !APPCHAIN_TOKEN_ID || !RELAYER_PRIVATE_KEY || !APPCHAIN_ENDPOINT) {
  console.log("[EXIT] Missing parameters!");
  process.exit(0);
}

async function init() {
  initDb();
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
  assetId: string,
  account: Account,
  sender: string,
  receiver_id: string,
  amount: string
) {
  console.log('unlock on near:', assetId, sender, receiver_id, amount);

  const contractId = assetId ? relayId : APPCHAIN_TOKEN_ID as string;
  const methodName = assetId ? 'unlock_token' : 'mint';

  const args = assetId ? {
    appchain_id: APPCHAIN_ID,
    token_id: 'usdc.testnet',
    sender,
    receiver_id,
    amount: amount,
  } : {
    account_id: receiver_id,
    amount
  }

  const result = await account.functionCall({
    contractId,
    methodName,
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: MINIMUM_DEPOSIT,
  });

  console.log(result);
}

async function listenEvents(appchain: ApiPromise, account: Account) {
  appchain.rpc.chain.subscribeFinalizedHeads(async (header) => {
    // Find the commitment to store it.
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        await storeCommitment(
          header.number.toNumber(),
          commitment
        );
      }
    });

    // relay cross-chain messages
    const commitments = await getCommitments(header.number.toNumber() - 1);
    commitments.forEach(async (commitment) => {
      console.log("handle commitment", commitment);
      const data = await get_offchain_data_for_commitment(
        appchain,
        commitment.commitment
      );
      console.log("data", data);
      const messages = Buffer.from(data.toString().slice(2), "hex").toString(
        "ascii"
      );
      console.log("messages", messages);
      const leafIndex = commitment.height;

      const proof = await appchain.rpc.mmr.generateProof(
        leafIndex,
        header.hash
      );
      console.log("proof:", proof);

      const rootHash = await appchain.query.mmr.rootHash(header.hash);
      console.log("rootHash:", rootHash);
      // TODO
      // let header = await appchain.get_header();
      // send_unlock_tx(messages, header, leaf_proof, mmr_root);
      markAsSent(commitment.height);
    });
  });
}

async function storeCommitment(
  height: number,
  commitment: String,
): Promise<any> {
  console.log("new commitment height", height);
  return await dbRunAsync(
    "INSERT INTO commitments(height, commitment, created_at, updated_at, status) values(?, ?, datetime('now'), datetime('now'), 0)",
    [height, commitment]
  );
}

async function getCommitments(height: number): Promise<Commitment[]> {
  const commitments: Commitment[] = await dbAllAsync("SELECT * FROM commitments WHERE height <= ? AND status == 0", [height]);
  return commitments.map(({ height, commitment }) => ({
    height,
    commitment,
  }));
}

async function markAsSent(height: number) {
  return await dbRunAsync(`UPDATE commitments SET status = 1 WHERE height = ${height}`);
}

async function get_offchain_data_for_commitment(
  appchain: ApiPromise,
  commitment: string
) {
  console.log("get_offchain_data_for_commitment");
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
