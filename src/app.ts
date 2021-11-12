import { ApiPromise, WsProvider } from "@polkadot/api";
import { decodeData } from "./utils";
import { Event, Hash, Header } from "@polkadot/types/interfaces";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import { decodeAddress, encodeAddress } from "@polkadot/keyring";
const keccak256 = require("keccak256");
const { MerkleTree } = require("merkletreejs");

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
        await storeCommitment(header.number.toNumber(), commitment);
      }
    });
  }
}

async function handleCommitments(appchain: ApiPromise, account: Account) {
  try {
    const nextHeight = await getNextHeight();
    const currentHeight = nextHeight - 1;
    const unMarkedCommitments = await getUnmarkedCommitments(currentHeight);
    if (unMarkedCommitments.length > 0) {
      const currentBlockHash = await appchain.rpc.chain.getBlockHash(
        nextHeight
      );
      const header = await appchain.rpc.chain.getHeader(currentBlockHash);
      unMarkedCommitments;
      // Use try-catch here instead of in handleCommitment for issuring the excecution order.
      for (let index = 0; index < unMarkedCommitments.length; index++) {
        // Excecute by order.
        await handleCommitment(
          unMarkedCommitments[index],
          appchain,
          account,
          header
        );
      }
    }
  } catch (e) {
    console.error("commitments handling failed", e);
  }
  handleCommitments(appchain, account);
}

async function handleCommitment(
  commitment: Commitment,
  appchain: ApiPromise,
  account: Account,
  header: Header
) {
  console.log("handleCommitment", commitment.commitment);
  const data = await getOffchainDataForCommitment(
    appchain,
    commitment.commitment
  );
  const decoded_messages: any = decodeData(
    {
      Messages: "Vec<Message>",
      Message: {
        nonce: "u64",
        payload_type: "PayloadType",
        payload: "Vec<u8>",
      },
      PayloadType: {
        _enum: ["BurnAsset", "Lock", "PlanNewEra", "EraPayout"],
      },
    },
    data
  );
  console.log("decoded_messages", JSON.stringify(decoded_messages));

  let needCompletes: any = {
    planNewEra: false,
    eraPayout: false,
  };

  decoded_messages.forEach((msg: any) => {
    if (msg.payload_type.toString() === "PlanNewEra") {
      needCompletes.planNewEra = true;
    } else if (msg.payload_type.toString() === "EraPayout") {
      needCompletes.eraPayout = true;
    }
  });

  const dataBuffer = Buffer.from(data.toString().slice(2), "hex");
  const encoded_messages = Array.from(dataBuffer);
  const leafIndex = commitment.height;

  const rawProof = await appchain.rpc.mmr.generateProof(leafIndex, header.hash);
  console.log("rawProof", rawProof);
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
  console.log("==========proof data===========");
  console.log("mmr_root", mmr_root.toString());
  console.log("leaf_proof", leaf_proof);
  console.log("commitment", commitment.commitment);
  console.log("header hash", cBlockHash.hash.toString());
  console.log("===============================");

  console.log("the crosschain data: ", data);

  let txId: string = "";
  let failedCall: any = null;
  try {
    for (let index = 0; index < decoded_messages.length; index++) {
      const payloadTypeString = decoded_messages[index].payload_type.toString();
      await tryReadyCommitment(account, payloadTypeString);
    }

    const callResult: any = await relay(
      account,
      commitment.commitment,
      encoded_messages,
      header_partial,
      leaf_proof,
      mmr_root
    );
    if (callResult.transaction_outcome) {
      txId = callResult.transaction_outcome.id;
    }
  } catch (e: any) {
    if (e.transaction_outcome) {
      console.error("handleCommitment error", e);
      txId = e.transaction_outcome.id;
      failedCall = e;
    } else {
      throw e;
    }
  }

  if (failedCall) {
    needCompletes = null;
  }

  if (failedCall) {
    await markAsSent(commitment.commitment, 2, txId, needCompletes);
  } else {
    await markAsSent(commitment.commitment, 1, txId, needCompletes);
  }
}

async function syncFinalizedHeights(appchain: ApiPromise) {
  appchain.rpc.chain.subscribeFinalizedHeads(async (header) => {
    latestFinalizedHeight = header.number.toNumber();
  });
}

async function subscribeJustifications(appchain: ApiPromise) {
  appchain.rpc.beefy.subscribeJustifications(async (justification) => {
    console.log("justification", JSON.stringify(justification));
    // console.log(
    //   "justification.commitment.payload: ",
    //   justification.commitment.payload.toString()
    // );
    // console.log(
    //   "justification.commitment.blockNumber: ",
    //   justification.commitment.blockNumber.toString()
    // );
    // console.log(
    //   "justification.commitment.validatorSetId: ",
    //   justification.commitment.validatorSetId.toString()
    // );
    // console.log(
    //   "justification.signatures: ",
    //   justification.signatures.toString()
    // );

    const blockHash = await appchain.rpc.chain.getBlockHash(
      justification.commitment.blockNumber
    );
    // const targetHash = await appchain.rpc.chain.getBlockHash(
    //   Number(justification.commitment.blockNumber) - 1
    // );
    const rawMmrProofWrapper = await appchain.rpc.mmr.generateProof(
      Number(justification.commitment.blockNumber) - 1,
      blockHash
    );
    const mmrProofWrapper = rawMmrProofWrapper.toJSON();
    console.log("mmrProofWrapper", mmrProofWrapper);

    const mmrProof: any = decodeData(
      {
        MMRProof: {
          leafIndex: "u64",
          leafCount: "u64",
          items: "Vec<Hash>",
        },
      },
      mmrProofWrapper.proof
    );
    console.log("mmrProof", mmrProof.toJSON());

    const authorities = (
      await appchain.query.beefy.authorities.at(blockHash)
    ).toJSON() as string[];
    console.log("authorities", authorities);
    const leaves = authorities.map((a) => keccak256(a));
    console.log("leaves", leaves);
    const tree = new MerkleTree(leaves, keccak256, { sort: true });
    const root = tree.getHexRoot();

    const proofs = authorities.map((authority, index) => {
      const leaf = keccak256(authority);
      const proof = tree.getHexProof(leaf);
      return proof;
    });

    console.log("proofs", proofs);
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
  const relayResult: any = await account.functionCall({
    contractId: ANCHOR_CONTRACT_ID as string,
    methodName: "verify_and_apply_appchain_messages",
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("0"),
  });
  console.log("relayResult", relayResult);

  return relayResult;
}

async function tryComplete(account: Account, methodName: string) {
  console.log("tryComplete", methodName);
  const tryCompleteResult: any = await account.functionCall({
    contractId: ANCHOR_CONTRACT_ID as string,
    methodName,
    args: {},
    gas: DEFAULT_GAS,
    attachedDeposit: new BN("0"),
  });
  let returnVal = false;
  const returnValBase64 =
    tryCompleteResult.receipts_outcome[0].outcome.status.SuccessValue;
  if (returnValBase64) {
    returnVal = JSON.parse(
      Buffer.from(returnValBase64, "base64").toString("utf8")
    );
  }
  console.log("returnVal", returnVal);
  return returnVal;
}

async function storeCommitment(
  height: number,
  commitment: String
): Promise<any> {
  console.log("storeCommitment", commitment);
  return await dbRunAsync(
    "INSERT INTO commitments(height, commitment, created_at, updated_at, tx_id, need_completes, status) values(?, ?, datetime('now'), datetime('now'), NULL, NULL, 0)",
    [height, commitment]
  );
}

async function updateSyncedBlock(height: number): Promise<any> {
  await upsertLastSyncedBlocks({ height, type: 1 });
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

async function getNotCompletedCommitments(
  height: number
): Promise<Commitment[]> {
  const commitments: Commitment[] = await dbAllAsync(
    "SELECT * FROM commitments WHERE height <= ? AND status == 1 AND need_completes NOT NULL ORDER BY height",
    [height]
  );
  return commitments;
}

async function getCommitments(): Promise<Commitment[]> {
  const commitments: Commitment[] = await dbAllAsync(
    "SELECT * FROM commitments  ORDER BY height"
  );
  return commitments;
}

async function getCommitmentByHeight(height: number): Promise<Commitment> {
  const commitment: Commitment = await dbGetAsync(
    "SELECT * FROM commitments WHERE height == ?",
    [height]
  );
  return commitment;
}

async function markAsSent(
  commitment: string,
  status: number,
  txId: string,
  needCompletes: any
) {
  const _needCompletes =
    needCompletes.planNewEra || needCompletes.eraPayout
      ? JSON.stringify(needCompletes)
      : null;
  await dbRunAsync(
    `UPDATE commitments SET status = ?, updated_at = datetime('now'), tx_id = ?, need_completes = ? WHERE commitment == ?`,
    [status, txId, _needCompletes, commitment]
  );
}

async function markAsCompleted(commitment: string, needCompletes: any) {
  const _needCompletes =
    needCompletes.planNewEra || needCompletes.eraPayout
      ? JSON.stringify(needCompletes)
      : null;
  await dbRunAsync(
    `UPDATE commitments SET updated_at = datetime('now'), need_completes = ? WHERE commitment == ?`,
    [_needCompletes, commitment]
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

async function tryReadyCommitment(
  account: Account,
  payloadTypeString: "PlanNewEra" | "EraPayout"
): Promise<boolean | undefined> {
  console.log("tryReadyCommitment", payloadTypeString);
  if (payloadTypeString == "PlanNewEra") {
    const switchingEraResult = await tryComplete(
      account,
      "try_complete_switching_era"
    );
    if (!switchingEraResult) {
      return await tryReadyCommitment(account, payloadTypeString);
    } else {
      return true;
    }
  }
  if (payloadTypeString == "EraPayout") {
    const distributingRewardtResult = await tryComplete(
      account,
      "try_complete_distributing_reward"
    );
    if (!distributingRewardtResult) {
      return await tryReadyCommitment(account, payloadTypeString);
    } else {
      return true;
    }
  }
}

async function tryCompleteCommitments(account: Account) {
  const nextHeight = await getNextHeight();
  const currentHeight = nextHeight - 1;
  const commitments: Commitment[] = await getNotCompletedCommitments(
    currentHeight
  );
  for (let index = 0; index < commitments.length; index++) {
    try {
      const commitment = commitments[index];
      const needCompletes = JSON.parse(commitment.need_completes as string);
      if (needCompletes.planNewEra) {
        const switchingEraResult = await tryComplete(
          account,
          "try_complete_switching_era"
        );
        if (switchingEraResult) {
          needCompletes.planNewEra = false;
          await markAsCompleted(commitment.commitment, needCompletes);
        }
      }
      if (needCompletes.eraPayout) {
        const distributingRewardtResult = await tryComplete(
          account,
          "try_complete_distributing_reward"
        );
        if (distributingRewardtResult) {
          needCompletes.eraPayout = false;
          await markAsCompleted(commitment.commitment, needCompletes);
        }
      }
    } catch (e) {
      console.error("tryCompleteCommitments failed", e);
    }
  }
  setTimeout(() => {
    tryCompleteCommitments(account);
  }, 200);
}

async function start() {
  const { appchain, account } = await init();
  subscribeJustifications(appchain);
  syncBlocks(appchain);
  handleCommitments(appchain, account);
  tryCompleteCommitments(account);
  syncFinalizedHeights(appchain);
}

start().catch((error) => {
  console.error(error);
  process.exit(-1);
});
