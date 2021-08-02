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

if (
  !APPCHAIN_ID ||
  !APPCHAIN_TOKEN_ID ||
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
      const dataBuffer = Buffer.from(data.toString().slice(2), "hex");
      console.log("decoded messages", dataBuffer.toString());
      const encoded_messages = Array.from(dataBuffer);
      const leafIndex = commitment.height;

      const rawProof = await appchain.rpc.mmr.generateProof(
        leafIndex,
        header.hash
      );
      const proof: Proof = {
        leaf_index: leafIndex,
        leaf_count: header.number.toNumber(),
        items: Array.from(
          Buffer.from(rawProof.proof.toString().slice(2), "hex")
        ),
      };

      const mmrRoot = await appchain.query.mmr.rootHash.at(header.hash);

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

      await verify(account, encoded_messages, header_partial, proof, mmrRoot);
      markAsSent(commitment.height);
    });
  });
}

async function verify(
  account: Account,
  encoded_messages: Number[],
  header_partial: HeaderPartial,
  proof: Proof,
  mmrRoot: Hash
) {
  const result = await account.functionCall({
    contractId: APPCHAIN_ID as string,
    methodName: "verify",
    args: {
      encoded_messages,
      header_partial,
      proof,
      mmrRoot,
    },
    gas: DEFAULT_GAS,
    attachedDeposit: MINIMUM_DEPOSIT,
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
