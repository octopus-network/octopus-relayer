import { ApiPromise, WsProvider } from "@polkadot/api";
import { Account } from "near-api-js";
import { DetectCodec } from "@polkadot/types/types";
import { decodeData, logJSON, toNumArray } from "./utils";
const keccak256 = require("keccak256");
const publicKeyToAddress = require("ethereum-public-key-to-address");
const { MerkleTree } = require("merkletreejs");
import { initNearRpc, updateState } from "./nearCalls";
import { initDb } from "./db";
import { MerkleProof } from "./interfaces";
import {
  getNextHeight,
  getLatestFinalizedHeight,
  updateSyncedBlock,
  subscribeFinalizedHeights,
} from "./blockHeights";
import {
  storeCommitment,
  handleCommitments,
  setRelayMessagesLock,
} from "./commitments";
import {
  storeAction,
  confirmAction,
  checkAnchorIsWitnessMode,
} from "./actions";
import { tryCompleteActions } from "./actions";
import { LightClientState, ActionType } from "./interfaces";
import { appchainEndpoint, updateStateMinInterval } from "./constants";

const BLOCK_SYNC_SIZE = 20;
const BLOCK_LOG_SIZE = 100;

async function start() {
  initDb();
  const account = await initNearRpc();

  const wsProvider = new WsProvider(appchainEndpoint, 5 * 60 * 1000);
  const appchain = await ApiPromise.create({
    provider: wsProvider,
  });

  wsProvider.on("connected", () =>
    checkSubscription(account, wsProvider, appchain)
  );
  wsProvider.on("disconnected", () =>
    checkSubscription(account, wsProvider, appchain)
  );
  wsProvider.on("error", (error) =>
    console.log("provider", "error", JSON.stringify(error))
  );
  appchain.on("connected", () =>
    checkSubscription(account, wsProvider, appchain)
  );
  appchain.on("disconnected", () =>
    checkSubscription(account, wsProvider, appchain)
  );
  appchain.on("error", (error) =>
    console.log("api", "error", JSON.stringify(error))
  );
  checkSubscription(account, wsProvider, appchain);
  setInterval(() => witnessModeWatcher(appchain), 10 * 1000);
  return { appchain, account };
}

let lastProviderConnectionLog = false;
let lastAppchainConnectionLog = false;
let lastIsWitnessMode = true;
async function checkSubscription(
  account: Account,
  provider: WsProvider,
  appchain: ApiPromise
) {
  if (
    provider.isConnected != lastProviderConnectionLog ||
    appchain.isConnected != lastAppchainConnectionLog
  ) {
    console.log("checkSubscription");
    console.log("provider connection: ", provider.isConnected);
    console.log("appchain connection: ", appchain.isConnected);
    lastProviderConnectionLog = provider.isConnected;
    lastAppchainConnectionLog = appchain.isConnected;
    if (appchain.isConnected && provider.isConnected) {
      console.log("start subscribe");
      syncBlocks(appchain);
      handleCommitments(appchain);
      tryCompleteActions(account, appchain);
      subscribeFinalizedHeights(appchain);
      lastIsWitnessMode = true;
    }
  }
}

async function witnessModeWatcher(appchain: ApiPromise) {
  const isWitnessMode = await checkAnchorIsWitnessMode();
  if (lastIsWitnessMode && !isWitnessMode) {
    subscribeJustifications(appchain);
  }
  lastIsWitnessMode = isWitnessMode;
}

let lastSyncBlocksLog = 0;
let debugMode = false;
async function syncBlocks(appchain: ApiPromise) {
  // set expired time for the whole async block
  const timer = setTimeout(() => {
    console.error("syncBlocks expired");
    debugMode = true;
    syncBlocks(appchain);
  }, 2 * 60 * 1000);

  debugMode && console.log("appchain.isConnected:", appchain.isConnected);

  if (appchain.isConnected) {
    try {
      const nextHeight = await getNextHeight();
      debugMode && console.log("nextHeight:", nextHeight);
      const latestFinalizedHeight = getLatestFinalizedHeight();
      debugMode && console.log("latestFinalizedHeight:", latestFinalizedHeight);
      if (nextHeight <= latestFinalizedHeight) {
        if (nextHeight - lastSyncBlocksLog >= BLOCK_LOG_SIZE) {
          console.log("nextHeight", nextHeight);
          lastSyncBlocksLog = nextHeight;
        }
        if (nextHeight <= latestFinalizedHeight - BLOCK_SYNC_SIZE) {
          const promises = new Array(BLOCK_SYNC_SIZE)
            .fill(1)
            .map(async (_, index) => {
              await syncBlock(appchain, nextHeight + index);
            });
          debugMode && console.log("set promises");
          await Promise.all(promises);
          debugMode && console.log("promises executed");
          await updateSyncedBlock(nextHeight + BLOCK_SYNC_SIZE - 1);
          debugMode && console.log("syncedBlock updated");
        } else {
          await syncBlock(appchain, nextHeight);
          debugMode && console.log("syncBlock");
          await updateSyncedBlock(nextHeight);
          debugMode && console.log("syncedBlock updated");
        }
      }
      setTimeout(() => syncBlocks(appchain), 1000);
      clearTimeout(timer);
      debugMode = false;
    } catch (e) {
      console.error("syncBlocks error", e);
      setTimeout(() => syncBlocks(appchain), 10 * 1000);
      clearTimeout(timer);
      debugMode = false;
    }
  }
}

async function syncBlock(appchain: ApiPromise, nextHeight: number) {
  const latestFinalizedHeight = getLatestFinalizedHeight();
  if (nextHeight <= latestFinalizedHeight) {
    const nextBlockHash = await appchain.rpc.chain.getBlockHash(nextHeight);
    debugMode && console.log("nextBlockHash", nextBlockHash.toJSON());
    const header = await appchain.rpc.chain.getHeader(nextBlockHash);
    debugMode && console.log("header", header.toJSON());
    // logJSON("header", header.toJSON());
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        await storeCommitment(header.number.toNumber(), commitment);
        debugMode && console.log("commitment stored", commitment);
      }
    });
  }
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

function subscribeJustifications(appchain: ApiPromise) {
  console.log("subscribeJustifications");
  appchain.rpc.beefy.subscribeJustifications(async (justification) => {
    await handleJustification(appchain, justification);
  });
}

let lastStateUpdated = 0;
async function handleJustification(
  appchain: ApiPromise,
  justification: DetectCodec<any, any>
) {
  console.log("justification", JSON.stringify(justification));
  const isWitnessMode = await checkAnchorIsWitnessMode();
  const inInterval =
    Date.now() - lastStateUpdated < updateStateMinInterval * 60 * 1000;

  if (isWitnessMode) {
    console.log("skip this justification. Reason: anchor is witness-mode");
    return;
  }
  if (inInterval) {
    console.log("skip this justification. Reason: in interval");
    return;
  }
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

  const actionType = "UpdateState";
  try {
    await confirmAction(actionType);
    setRelayMessagesLock(true);
    await updateState(lightClientState);
    setRelayMessagesLock(false);
    await storeAction(actionType);
    lastStateUpdated = Date.now();
  } catch (err) {
    setRelayMessagesLock(false);
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
}

start().catch((error) => {
  console.error("error catch in start", error);
  process.exit(-1);
});
