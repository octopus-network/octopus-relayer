import '@polkadot/api-augment';
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Account } from "near-api-js";
import { DetectCodec } from "@polkadot/types/types";
import { decodeData, logJSON, toNumArray, WsProvider2, decodeSignedCommitment } from "./utils";
const keccak256 = require("keccak256");
const publicKeyToAddress = require("ethereum-public-key-to-address");
const { MerkleTree } = require("merkletreejs");
import { initNearRpc, updateState, checkAnchorIsWitnessMode } from "./nearCalls";
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
  getUnmarkedCommitments,
  setRelayMessagesLock,
} from "./commitments";
import {
  storeAction,
  confirmAction,
  tryCompleteActions
} from "./actions";
import {
  confirmProcessingMessages
} from "./messages";
import { LightClientState, ActionType } from "./interfaces";
const { isEqual } = require("lodash");
import { appchainEndpoint, updateStateMinInterval } from "./constants";
const util = require('util')

const BLOCK_SYNC_SIZE = 20;
const BLOCK_LOG_SIZE = 100;

async function start() {
  await initDb();
  const account = await initNearRpc();
  const wsProvider = new WsProvider2(appchainEndpoint);

  setInterval(() => {
    console.log("callCache capacity", wsProvider.getCallCache().capacity);
    console.log("callCache length", wsProvider.getCallCache().length);
  }, 10 * 60 * 1000);

  const appchain = await ApiPromise.create({
    provider: wsProvider,
  });
  listening(appchain, account);
  wsProvider.on("error", (error) =>
    console.log("provider", "error", JSON.stringify(error))
  );
  appchain.on("disconnected", () =>
    handleDisconnected(wsProvider, appchain)
  );
  appchain.on("connected", () =>
    handleConnected(account, wsProvider, appchain)
  );
  appchain.on("error", (error) =>
    console.log("api", "error", JSON.stringify(error))
  );
}

async function listening(
  appchain: ApiPromise,
  account: Account,
) {
  console.log("start subscribe");
  syncBlocks(appchain);
  handleCommitments(appchain);
  subscribeFinalizedHeights(appchain);
  tryCompleteActions(account, appchain);
}

async function handleDisconnected(
  provider: WsProvider,
  appchain: ApiPromise
) {
  console.log("provider.isConnected", provider.isConnected);
  console.log("appchain.isConnected", appchain.isConnected);
  setTimeout(async () => {
    if (!(appchain.isConnected && provider.isConnected)) {
      console.log("timeout for reconnection");
      process.exit(-1);
    }
  }, 20 * 60 * 1000);
}

async function handleConnected(
  account: Account,
  provider: WsProvider,
  appchain: ApiPromise
) {
  console.log("provider.isConnected", provider.isConnected);
  console.log("appchain.isConnected", appchain.isConnected);
  tryCompleteActions(account, appchain);
  confirmProcessingMessages();
}

let lastSyncBlocksLog = 0;
async function syncBlocks(appchain: ApiPromise) {
  // set expired time for the whole async block
  const timer = setTimeout(async () => {
    console.error("syncBlocks expired");
    const latestFinalizedHeight = getLatestFinalizedHeight();
    console.log("latestFinalizedHeight", latestFinalizedHeight);

    // test connection
    const exitTimer = setTimeout(() => {
      console.error("test connection: always pending");
      process.exit(1)
    }, 10 * 1000);
    try {
      const finalizedHead = await appchain.rpc.chain.getFinalizedHead();
      if (finalizedHead) {
        console.log("test connection: Ok");
        console.log("finalizedHead", finalizedHead)
        return clearTimeout(exitTimer);
      }
    } catch (e) {
      console.error("test connection: fail", e);
    }
  }, 2 * 60 * 1000);

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
      clearTimeout(timer);
    } catch (e: any) {
      console.error("syncBlocks error", e);
      if (!/disconnected/.test(e.toString())) {
        clearTimeout(timer);
      }
    }
  }
  setTimeout(() => syncBlocks(appchain), 6000);
}

async function syncBlock(appchain: ApiPromise, nextHeight: number) {
  const latestFinalizedHeight = getLatestFinalizedHeight();
  if (nextHeight <= latestFinalizedHeight) {
    const nextBlockHash = await appchain.rpc.chain.getBlockHash(nextHeight);
    const blockWrapper = await appchain.rpc.chain.getBlock(nextBlockHash);
    const { block: { header }, justifications } = blockWrapper;
    const justificationsHuman = justifications.toHuman();
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        await storeCommitment(header.number.toNumber(), commitment);
      }
    });
    let signedCommitmentHex: any;
    if (justificationsHuman) {
      (justificationsHuman as string[]).forEach(justificationHuman => {
        if (justificationHuman[0] === "BEEF") {
          signedCommitmentHex = "0x" + justificationHuman[1].slice(4);
        }
      });
    }
    if (signedCommitmentHex) {
      console.log(`signedCommitmentHex-${nextHeight}`, signedCommitmentHex);
      handleSignedCommitment(appchain, signedCommitmentHex);
    }
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

let lastStateUpdated = 0;
async function handleSignedCommitment(
  appchain: ApiPromise,
  signedCommitmentHex: string
) {
  const decodedSignedCommitment = decodeSignedCommitment(signedCommitmentHex);
  const isWitnessMode = await checkAnchorIsWitnessMode();
  // const inInterval =
  //   Date.now() - lastStateUpdated < updateStateMinInterval * 60 * 1000;

  const { blockNumber } = decodedSignedCommitment.commitment;
  const unMarkedCommitments = await getUnmarkedCommitments(blockNumber);

  const currBlockHash = await appchain.rpc.chain.getBlockHash(
    blockNumber
  );
  const previousBlockHash = await appchain.rpc.chain.getBlockHash(
    blockNumber - 1
  );
  const currentAuthorities: any = (await appchain.query.beefy.authorities.at(
    currBlockHash
  )).toJSON();
  const previousAuthorities: any = (await appchain.query.beefy.authorities.at(
    previousBlockHash
  )).toJSON();
  const isAuthoritiesEqual = isEqual(currentAuthorities, previousAuthorities)

  if (isWitnessMode || (unMarkedCommitments.length === 0 && isAuthoritiesEqual)) {
    return;
  }

  // if (inInterval) {
  //   console.log("skip this justification. Reason: in interval");
  //   return;
  // }

  console.log("decodedSignedCommitment", decodedSignedCommitment.toJSON())

  if (!isAuthoritiesEqual) {
    console.log("Authorities changed!");
  }
  logJSON("previousAuthorities", previousAuthorities);
  logJSON("currentAuthorities", currentAuthorities);

  const rawMmrProofWrapper = await appchain.rpc.mmr.generateProof(
    Number(decodedSignedCommitment.commitment.blockNumber) - 1,
    currBlockHash
  );
  logJSON("rawMmrProofWrapper", rawMmrProofWrapper.toHex());
  const decodedMmrProofWrapper = decodeMmrProofWrapper(rawMmrProofWrapper);
  logJSON("decodedMmrProofWrapper", decodedMmrProofWrapper);

  const ethAddrs = currentAuthorities.map((a: string) => publicKeyToAddress(a));
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
    signed_commitment: toNumArray(signedCommitmentHex) as number[],
    validator_proofs: merkleProofs,
    mmr_leaf: toNumArray(rawMmrProofWrapper.leaf),
    mmr_proof: toNumArray(rawMmrProofWrapper.proof),
  };
  console.log("notificationHistories", util.inspect(lightClientState, { showHidden: false, depth: null, colors: true }))

  const actionType = "UpdateState";
  try {
    if (await confirmAction(actionType)) {
      console.log("done");
      setRelayMessagesLock(true);
      await updateState(lightClientState);
      setRelayMessagesLock(false);
      await storeAction(actionType);
      lastStateUpdated = Date.now();
    }
  } catch (err) {
    setRelayMessagesLock(false);
    console.log(err);
  }
}

start().catch((error) => {
  console.error("error catch in start", error);
  process.exit(-1);
});
