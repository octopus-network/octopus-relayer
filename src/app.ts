import { ApiPromise, WsProvider } from "@polkadot/api";
import { DetectCodec } from "@polkadot/types/types";
import { decodeData, logJSON, toNumArray } from "./utils";
import { Event, Hash, Header } from "@polkadot/types/interfaces";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import { toCamel, toSnake } from "snake-camel";
import { decodeAddress, encodeAddress } from "@polkadot/keyring";
const keccak256 = require("keccak256");
const publicKeyToAddress = require("ethereum-public-key-to-address");
const { MerkleTree } = require("merkletreejs");
import { convertToSimplifiedMMRProof, SimplifiedMMRProof } from "./mmr";
import {
  initNearRpc,
  relayMessages,
  updateState,
  getLatestCommitmentBlockNumber,
  tryComplete,
} from "./near-calls";

import types from "./types";
import {
  dbRunAsync,
  dbAllAsync,
  dbGetAsync,
  initDb,
  upsertLastSyncedBlocks,
} from "./db";
import {
  Commitment,
  Proof,
  MerkleProof,
  SYNCEDBLOCK,
  MessageProof,
} from "./interfaces";

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
  const account = await initNearRpc();
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
    // logJSON("header", header.toJSON());
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        await storeCommitment(header.number.toNumber(), commitment);
      }
    });
  }
}

async function handleCommitments(appchain: ApiPromise) {
  try {
    const nextHeight = await getNextHeight();
    const currentHeight = nextHeight - 1;
    const unMarkedCommitments = await getUnmarkedCommitments(currentHeight);
    if (unMarkedCommitments.length > 0) {
      unMarkedCommitments;
      // Use try-catch here instead of in handleCommitment for issuring the excecution order.
      for (let index = 0; index < unMarkedCommitments.length; index++) {
        // Excecute by order.
        await handleCommitment(unMarkedCommitments[index], appchain);
      }
    }
  } catch (e) {
    console.error("commitments handling failed", e);
  }
  handleCommitments(appchain);
}

async function handleCommitment(commitment: Commitment, appchain: ApiPromise) {
  const encoded_messages = await getOffchainDataForCommitment(
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
    encoded_messages
  );

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

  const blockNumberInAnchor = await getLatestCommitmentBlockNumber();
  if (
    commitment.height >= blockNumberInAnchor ||
    commitment.height > latestFinalizedHeight ||
    blockNumberInAnchor > latestFinalizedHeight
  ) {
    return;
  }
  console.log("decoded_messages", JSON.stringify(decoded_messages));
  console.log("blockNumberInAnchor", blockNumberInAnchor);
  console.log("latestFinalizedHeight", latestFinalizedHeight);
  console.log("commitment.height", commitment.height);
  const blockHashInAnchor = await appchain.rpc.chain.getBlockHash(
    blockNumberInAnchor
  );
  logJSON("blockHashInAnchor", blockHashInAnchor);
  const rawProof = await appchain.rpc.mmr.generateProof(
    commitment.height,
    blockHashInAnchor
  );

  logJSON("rawProof", rawProof);

  // const mmr_root = await appchain.query.mmr.rootHash.at(blockHashInAnchor);
  const cBlockHash = await appchain.rpc.chain.getBlockHash(commitment.height);
  const cHeader = await appchain.rpc.chain.getHeader(cBlockHash);
  const messageProof: MessageProof = {
    header: toNumArray(cHeader.toHex()),
    messages: toNumArray(encoded_messages),
    mmr_leaf: toNumArray(rawProof.leaf),
    mmr_proof: toNumArray(rawProof.proof),
  };
  let txId: string = "";
  let failedCall: any = null;
  try {
    for (let index = 0; index < decoded_messages.length; index++) {
      const payloadTypeString = decoded_messages[index].payload_type.toString();
      await tryReadyCommitment(payloadTypeString);
    }

    const callResult: any = await relayMessages(messageProof);
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

function decodeMmrProofWrapper(rawMmrProofWrapper: any): {
  blockHash: DetectCodec<any, any>;
  mmrLeaf: DetectCodec<any, any>;
  mmrProof: DetectCodec<any, any>;
} {
  const mmrProofWrapper = rawMmrProofWrapper.toJSON();
  const mmrLeaf: any = decodeData(
    {
      MmrLeaf: {
        version: "u8",
        parent_number_and_hash: "(u32, Hash)",
        beefy_next_authority_set: "BeefyNextAuthoritySet",
        parachain_heads: "Hash",
      },
      BeefyNextAuthoritySet: {
        id: "u64",
        len: "u32",
        root: "Hash",
      },
    },
    mmrProofWrapper.leaf
  );
  const leafHash = keccak256(mmrProofWrapper.leaf).toString("hex");
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
  return {
    blockHash: mmrProofWrapper.blockHash,
    mmrLeaf,
    mmrProof,
  };
}

async function subscribeJustifications(appchain: ApiPromise) {
  console.log("start subscribe");
  appchain.rpc.beefy.subscribeJustifications(async (justification) => {
    console.log("justification", JSON.stringify(justification));
    console.log("justification encode", JSON.stringify(justification.toHex()));
    const currBlockHash = await appchain.rpc.chain.getBlockHash(
      justification.commitment.blockNumber
    );
    const rawMmrProofWrapper = await appchain.rpc.mmr.generateProof(
      Number(justification.commitment.blockNumber) - 1,
      currBlockHash
    );
    logJSON("rawMmrProofWrapper", rawMmrProofWrapper);
    const decodedMmrProofWrapper = decodeMmrProofWrapper(rawMmrProofWrapper);
    logJSON("decodedMmrProofWrapper", decodedMmrProofWrapper);

    // const validatorProof = {
    //   root: justification.commitment.payload.toJSON(),
    //   proof: mmrProof.toJSON(),
    // };

    const rawAuthorities = (await appchain.query.beefy.authorities.at(
      currBlockHash
    )) as DetectCodec<any, any>;

    const authorities = rawAuthorities.toJSON();
    logJSON("authorities", authorities);
    const ethAddrs = authorities.map((a: string) => publicKeyToAddress(a));
    console.log("ethAddrs", ethAddrs);
    const leaves = ethAddrs.map((a: string) => keccak256(a));
    const tree = new MerkleTree(leaves, keccak256);
    const root = tree.getRoot().toString("hex");
    console.log("root", root);

    const merkleProofs = leaves.map((leaf: any, index: number) => {
      const proof: string[] = tree.getHexProof(leaf);
      console.log("proof", proof);
      const u8aProof = proof.map((hash) => toNumArray(hash));
      const merkleProof: MerkleProof = {
        root: toNumArray(root),
        proof: u8aProof,
        number_of_leaves: leaves.length,
        leaf_index: index,
        leaf: toNumArray(ethAddrs[index]),
      };
      return merkleProof;
    });

    const lightClientState = {
      signed_commitment: toNumArray(justification.toHex()) as number[],
      validator_proofs: merkleProofs,
      mmr_leaf: toNumArray(rawMmrProofWrapper.leaf),
      mmr_proof: toNumArray(rawMmrProofWrapper.proof),
    };

    try {
      await updateState(lightClientState);
    } catch (err) {
      console.log(err);
    }

    // const simplifiedProof = convertToSimplifiedMMRProof(
    //   blockHash,
    //   mmrProof.leafIndex,
    //   mmrLeaf,
    //   mmrProof.leafCount,
    //   mmrProof.items
    // );
    // console.log("simplifiedProof", JSON.stringify(simplifiedProof));
  });
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
  payloadTypeString: "PlanNewEra" | "EraPayout"
): Promise<boolean | undefined> {
  console.log("tryReadyCommitment", payloadTypeString);
  if (payloadTypeString == "PlanNewEra") {
    const switchingEraResult = await tryComplete("try_complete_switching_era");
    if (!switchingEraResult) {
      return await tryReadyCommitment(payloadTypeString);
    } else {
      return true;
    }
  }
  if (payloadTypeString == "EraPayout") {
    const distributingRewardtResult = await tryComplete(
      "try_complete_distributing_reward"
    );
    if (!distributingRewardtResult) {
      return await tryReadyCommitment(payloadTypeString);
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
          "try_complete_switching_era"
        );
        if (switchingEraResult) {
          needCompletes.planNewEra = false;
          await markAsCompleted(commitment.commitment, needCompletes);
        }
      }
      if (needCompletes.eraPayout) {
        const distributingRewardtResult = await tryComplete(
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
  handleCommitments(appchain);
  tryCompleteCommitments(account);
  syncFinalizedHeights(appchain);
}

start().catch((error) => {
  console.error(error);
  process.exit(-1);
});
