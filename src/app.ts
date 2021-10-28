import { ApiPromise, WsProvider } from "@polkadot/api";
import { Event, Hash, Header } from "@polkadot/types/interfaces";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import { decodeAddress, encodeAddress } from "@polkadot/keyring";

import types from "./types";
import {
  dbRunAsync,
  dbAllAsync,
  dbGetAsync,
  initDb,
  upsertLastSyncedBlocks,
} from "./db";
import { Commitment, Proof, HeaderPartial, SYNCEDBLOCK } from "./interfaces";

const DEFAULT_GAS = new BN("300000000000000");
const MINIMUM_DEPOSIT = new BN("1250000000000000000000");
const BLOCK_SYNC_SIZE = 20;

const {
  APPCHAIN_ID,
  ANCHOR_CONTRACT_ID,
  RELAYER_PRIVATE_KEY,
  APPCHAIN_ENDPOINT,
  START_BLOCK_HEIGHT,
  NEAR_NODE_URL,
  NEAR_WALLET_URL,
  NEAR_HELPER_URL,
} = process.env;
let latestFinalizedHeight = 0;

console.log("APPCHAIN_ID", APPCHAIN_ID);
console.log("ANCHOR_CONTRACT_ID", ANCHOR_CONTRACT_ID);
console.log("RELAYER_PRIVATE_KEY", RELAYER_PRIVATE_KEY);
console.log("APPCHAIN_ENDPOINT", APPCHAIN_ENDPOINT);
console.log("START_BLOCK_HEIGHT", START_BLOCK_HEIGHT);
console.log("NEAR_NODE_URL", NEAR_NODE_URL);
console.log("NEAR_WALLET_URL", NEAR_WALLET_URL);
console.log("NEAR_HELPER_URL", NEAR_HELPER_URL);

if (
  !APPCHAIN_ID ||
  !ANCHOR_CONTRACT_ID ||
  !RELAYER_PRIVATE_KEY ||
  !APPCHAIN_ENDPOINT ||
  !START_BLOCK_HEIGHT
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

async function syncBlocks(appchain: ApiPromise) {
  const nextHeight = await getNextHeight();
  if (nextHeight > latestFinalizedHeight) {
    syncBlocks(appchain);
  } else {
    console.log("nextHeight", nextHeight);
    if (nextHeight <= latestFinalizedHeight - BLOCK_SYNC_SIZE) {
      const promises = new Array(BLOCK_SYNC_SIZE)
        .fill(1)
        .map(async (_, index) => {
          await syncBlock(appchain, nextHeight + index);
        });
      Promise.all(promises).then(
        async () => {
          try {
            await updateSyncedBlock(nextHeight + BLOCK_SYNC_SIZE - 1);
          } catch (e) {
            console.error("updateSyncedBlock error", e);
          }
          syncBlocks(appchain);
        },
        (e) => {
          console.error("syncBlocks error", e);
          syncBlocks(appchain);
        }
      );
    } else {
      try {
        await syncBlock(appchain, nextHeight);
        await updateSyncedBlock(nextHeight);
      } catch (e) {
        console.error("syncBlocks error", e);
      }
      syncBlocks(appchain);
    }
  }
}

async function syncBlock(appchain: ApiPromise, nextHeight: number) {
  if (nextHeight <= latestFinalizedHeight) {
    const nextBlockHash = await appchain.rpc.chain.getBlockHash(nextHeight);
    const header = await appchain.rpc.chain.getHeader(nextBlockHash);
    // Find the commitment to store it.
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        console.log("storeCommitment", commitment);
        await storeCommitment(header.number.toNumber(), commitment);
      }
    });
  }
}

async function handleCommitments(appchain: ApiPromise, account: Account) {
  const nextHeight = await getNextHeight();
  const currentHeight = nextHeight - 1;
  const unMarkedCommitments = await getUnmarkedCommitments(currentHeight);
  if (unMarkedCommitments.length > 0) {
    const currentBlockHash = await appchain.rpc.chain.getBlockHash(nextHeight);
    const header = await appchain.rpc.chain.getHeader(currentBlockHash);
    unMarkedCommitments;
    // Use try-catch here instead of in handleCommitment for issuring the excecution order.
    try {
      for (let index = 0; index < unMarkedCommitments.length; index++) {
        // Excecute by order.
        await handleCommitment(
          unMarkedCommitments[index],
          appchain,
          account,
          header
        );
      }
    } catch (e) {
      console.error(
        "commitments handling failed, currentHeight=",
        currentHeight
      );
    }
  }
  handleCommitments(appchain, account);
}

async function handleCommitment(
  commitment: Commitment,
  appchain: ApiPromise,
  account: Account,
  header: Header
) {
  const data = await getOffchainDataForCommitment(
    appchain,
    commitment.commitment
  );
  console.log("commitment", commitment.commitment);
  const dataBuffer = Buffer.from(data.toString().slice(2), "hex");
  // console.log("decoded messages", dataBuffer.toString());
  const encoded_messages = Array.from(dataBuffer);
  const leafIndex = commitment.height;

  const rawProof = await appchain.rpc.mmr.generateProof(leafIndex, header.hash);
  const leaf_proof: Proof = {
    leaf_index: leafIndex,
    leaf_count: header.number.toNumber(),
    items: Array.from(Buffer.from(rawProof.proof.toString().slice(2), "hex")),
  };

  const mmr_root = await appchain.query.mmr.rootHash.at(header.hash);

  const cBlockHash = await appchain.rpc.chain.getBlockHash(commitment.height);
  const cHeader = await appchain.rpc.chain.getHeader(cBlockHash);

  const header_partial: HeaderPartial = {
    parent_hash: cHeader.parentHash,
    number: cHeader.number.toNumber(),
    state_root: cHeader.stateRoot,
    extrinsics_root: cHeader.extrinsicsRoot,
    digest: cHeader.digest,
  };

  console.log("the crosschain data: ", data);

  await relay(
    account,
    commitment.commitment,
    encoded_messages,
    header_partial,
    leaf_proof,
    mmr_root
  );
  markAsSent(commitment.height);
}

async function syncFinalizedHeights(appchain: ApiPromise) {
  appchain.rpc.chain.subscribeFinalizedHeads(async (header) => {
    latestFinalizedHeight = header.number.toNumber();
  });
}

async function relay(
  account: Account,
  // decoded_messages:
  commitment: String,
  encoded_messages: Number[],
  header_partial: HeaderPartial,
  leaf_proof: Proof,
  mmr_root: Hash
) {
  // const commitmentaBuffer = Buffer.from(commitment.toString().slice(2), "hex");
  // const commitmentData = Array.from(commitmentaBuffer);
  // mock for verification
  const args = {
    // commitment: commitmentData,
    encoded_messages,
    header_partial: [0],
    leaf_proof: [0],
    mmr_root: [0],
  };
  const result = await account.functionCall({
    contractId: ANCHOR_CONTRACT_ID as string,
    methodName: "verify_and_apply_appchain_messages",
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

async function updateSyncedBlock(height: number): Promise<any> {
  return await upsertLastSyncedBlocks({ height, type: 1 });
}

async function getNextHeight(): Promise<number> {
  const data: SYNCEDBLOCK[] = await dbAllAsync(
    "SELECT * FROM last_synced_blocks WHERE type == ?",
    [1]
  );
  if (data.length > 0) {
    const lastSyncedBlock = data[0];
    return lastSyncedBlock.height + 1;
  } else {
    return Number(START_BLOCK_HEIGHT) + 1;
  }
}

async function getUnmarkedCommitments(height: number): Promise<Commitment[]> {
  const commitments: Commitment[] = await dbAllAsync(
    "SELECT * FROM commitments WHERE height <= ? AND status == 0 ORDER BY height",
    [height]
  );
  return commitments.map(({ height, commitment }) => ({
    height,
    commitment,
  }));
}

async function getLastCommitment(currentHeight: number): Promise<Commitment> {
  const commitment: Commitment = await dbGetAsync(
    "SELECT * FROM commitments WHERE height == ? AND status == 0",
    [currentHeight - 1]
  );
  return commitment;
}

async function markAsSent(height: number) {
  return await dbRunAsync(
    `UPDATE commitments SET status = 1, updated_at = datetime('now') WHERE height == ${height}`
  );
}

async function getOffchainDataForCommitment(
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
  // appchain.rpc.beefy.subscribeJustifications((justifications) => {
  // });
  syncBlocks(appchain);
  handleCommitments(appchain, account);
  syncFinalizedHeights(appchain);
}

start().catch((error) => {
  console.error(error);
  process.exit(-1);
});
