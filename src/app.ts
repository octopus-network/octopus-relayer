import { ApiPromise, WsProvider } from "@polkadot/api";
import { Account } from "near-api-js";
import { DetectCodec } from "@polkadot/types/types";
import { decodeData, logJSON, toNumArray } from "./utils";
const keccak256 = require("keccak256");
const publicKeyToAddress = require("ethereum-public-key-to-address");
const { MerkleTree } = require("merkletreejs");
import { initNearRpc, updateState } from "./nearCalls";
import types from "./types";
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
    types,
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
  return { appchain, account };
}

let lastProviderConnectionLog = false;
let lastAppchainConnectionLog = false;
let unsubscribeJustifications: any = () => {};
let unsubscribeFinalizedHeights: any = () => {};
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
      unsubscribeFinalizedHeights = await subscribeFinalizedHeights(appchain);
      unsubscribeJustifications = await subscribeJustifications(appchain);
    } else {
      console.log("unsubscribe");
      unsubscribeJustifications();
      unsubscribeFinalizedHeights();
    }
  }
}

let lastSyncBlocksLog = 0;
async function syncBlocks(appchain: ApiPromise) {
  if (appchain.isConnected) {
    try {
      const nextHeight = await getNextHeight();
      const latestFinalizedHeight = getLatestFinalizedHeight();
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
          await Promise.all(promises);
          await updateSyncedBlock(nextHeight + BLOCK_SYNC_SIZE - 1);
        } else {
          await syncBlock(appchain, nextHeight);
          await updateSyncedBlock(nextHeight);
        }
      }
      setTimeout(() => syncBlocks(appchain), 1000);
    } catch (e) {
      console.error("syncBlocks error", e);
      setTimeout(() => syncBlocks(appchain), 3000);
    }
  }
}

async function syncBlock(appchain: ApiPromise, nextHeight: number) {
  const latestFinalizedHeight = getLatestFinalizedHeight();
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
  return await appchain.rpc.beefy.subscribeJustifications(
    async (justification) => {
      await handleJustification(appchain, justification);
    }
  );
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
