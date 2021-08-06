import { ApiPromise, WsProvider } from "@polkadot/api";
import { Event, Hash } from "@polkadot/types/interfaces";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import { decodeAddress, encodeAddress } from "@polkadot/keyring";

import types from "./types";
import { dbRunAsync, dbAllAsync, initDb } from "./db";
import { Commitment, Proof, HeaderPartial } from "./interfaces";

const relayId = "dev-oct-relay.testnet";

const DEFAULT_GAS = new BN("300000000000000");
const MINIMUM_DEPOSIT = new BN("1250000000000000000000");

const {
  APPCHAIN_ID,
  RELAY_CONTRACT_ID,
  RELAYER_PRIVATE_KEY,
  APPCHAIN_ENDPOINT,
  NEAR_NODE_URL,
  NEAR_WALLET_URL,
  NEAR_HELPER_URL,
} = process.env;

console.log("APPCHAIN_ID", APPCHAIN_ID);
console.log("RELAY_CONTRACT_ID", RELAY_CONTRACT_ID);
console.log("RELAYER_PRIVATE_KEY", RELAYER_PRIVATE_KEY);
console.log("APPCHAIN_ENDPOINT", APPCHAIN_ENDPOINT);
console.log("NEAR_NODE_URL", NEAR_NODE_URL);
console.log("NEAR_WALLET_URL", NEAR_WALLET_URL);
console.log("NEAR_HELPER_URL", NEAR_HELPER_URL);

if (
  !APPCHAIN_ID ||
  !RELAY_CONTRACT_ID ||
  !RELAYER_PRIVATE_KEY ||
  !APPCHAIN_ENDPOINT
) {
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

async function listenEvents(appchain: ApiPromise, account: Account) {
  appchain.rpc.chain.subscribeFinalizedHeads(async (header) => {
    // Find the commitment to store it.
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        await storeCommitment(header.number.toNumber(), commitment);
      }
    });

    // relay cross-chain messages
    const commitments = await getUnmarkedCommitments(
      header.number.toNumber() - 1
    );
    commitments.forEach(async (commitment) => {
      const data = await getOffchainDataForCommitment(
        appchain,
        commitment.commitment
      );
      console.log("commitment", commitment.commitment);
      const dataBuffer = Buffer.from(data.toString().slice(2), "hex");
      console.log("decoded messages", dataBuffer.toString());
      const encoded_messages = Array.from(dataBuffer);
      const leafIndex = commitment.height;

      const rawProof = await appchain.rpc.mmr.generateProof(
        leafIndex,
        header.hash
      );
      const leaf_proof: Proof = {
        leaf_index: leafIndex,
        leaf_count: header.number.toNumber(),
        items: Array.from(
          Buffer.from(rawProof.proof.toString().slice(2), "hex")
        ),
      };

      const mmr_root = await appchain.query.mmr.rootHash.at(header.hash);

      const cBlockHash = await appchain.rpc.chain.getBlockHash(
        commitment.height
      );
      const cHeader = await appchain.rpc.chain.getHeader(cBlockHash);

      const header_partial: HeaderPartial = {
        parent_hash: cHeader.parentHash,
        number: cHeader.number.toNumber(),
        state_root: cHeader.stateRoot,
        extrinsics_root: cHeader.extrinsicsRoot,
        digest: cHeader.digest,
      };

      await relay(
        account,
        encoded_messages,
        header_partial,
        leaf_proof,
        mmr_root
      );
      markAsSent(commitment.height);
    });
  });
}

async function relay(
  account: Account,
  // decoded_messages:
  encoded_messages: Number[],
  header_partial: HeaderPartial,
  leaf_proof: Proof,
  mmr_root: Hash
) {
  // mock for verification
  const args = {
    appchain_id: APPCHAIN_ID,
    encoded_messages,
    header_partial: [0],
    leaf_proof: [0],
    mmr_root: [0],
  };
  console.log("args", JSON.stringify(args));
  const result = await account.functionCall({
    contractId: RELAY_CONTRACT_ID as string,
    methodName: "relay",
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("0"),
  });
  console.log("result", result);
}

async function storeCommitment(
  height: number,
  commitment: String
): Promise<any> {
  console.log("new commitment height", height);
  return await dbRunAsync(
    "INSERT INTO commitments(height, commitment, created_at, updated_at, status) values(?, ?, datetime('now'), datetime('now'), 0)",
    [height, commitment]
  );
}

async function getUnmarkedCommitments(height: number): Promise<Commitment[]> {
  const commitments: Commitment[] = await dbAllAsync(
    "SELECT * FROM commitments WHERE height <= ? AND status == 0",
    [height]
  );
  return commitments.map(({ height, commitment }) => ({
    height,
    commitment,
  }));
}

async function markAsSent(height: number) {
  return await dbRunAsync(
    `UPDATE commitments SET status = 1, updated_at = datetime('now') WHERE height = ${height}`
  );
}

async function getOffchainDataForCommitment(
  appchain: ApiPromise,
  commitment: string
) {
  console.log("getOffchainDataForCommitment");
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
