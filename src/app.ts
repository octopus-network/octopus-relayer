import '@polkadot/api-augment';
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Account } from "near-api-js";
import { DetectCodec } from "@polkadot/types/types";
import { decodeData, logJSON, toNumArray, WsProvider2, decodeV1SignedCommitment } from "./utils";
const keccak256 = require("keccak256");
const publicKeyToAddress = require("ethereum-public-key-to-address");
const { MerkleTree } = require("merkletreejs");
import { initNearRpc, updateState, checkAnchorIsWitnessMode, getLatestCommitmentBlockNumber } from "./nearCalls";
import { initDb } from "./db";
import { MerkleProof, Session } from "./interfaces";
import {
  getNextHeight,
  getLatestFinalizedHeight,
  updateSyncedBlock,
  syncFinalizedHeights,
} from "./blockHeights";
import {
  storeCommitment,
  handleCommitments,
  getUnmarkedCommitments,
  setRelayMessagesLock,
  storeLightClientState,
} from "./commitments";
import {
  storeAction,
  confirmAction,
  tryCompleteActions
} from "./actions";
import {
  getLastNotCompletedSession,
  storeSession,
  sessionCompleted,
  markFailedSession
} from "./sessions";
import {
  confirmProcessingMessages
} from "./messages";
import { LightClientState, ActionType } from "./interfaces";
const { isEqual } = require("lodash");
import { appchainSetting, updateStateMinInterval } from "./constants";
const util = require('util')

const BLOCK_SYNC_SIZE = 20;
const BLOCK_LOG_SIZE = 100;

async function start() {
  await initDb();
  const account = await initNearRpc();
  const wsProvider = new WsProvider2(appchainSetting.wsRpcEndpoint, 300 * 1000, undefined, 180 * 1000);

  const exitTimer = setTimeout(() => {
    console.error("init polkadotjs expired: always pending");
    process.exit(1)
  }, 60 * 1000);

  const appchain = await ApiPromise.create({
    provider: wsProvider,
  });
  if (appchain) {
    clearTimeout(exitTimer);
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
}

async function listening(
  appchain: ApiPromise,
  account: Account,
) {
  console.log("start syncing");
  syncBlocks(appchain);
  handleCommitments(appchain);
  syncFinalizedHeights(appchain);
  confirmProcessingMessages();
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
  confirmProcessingMessages();
  tryCompleteActions(account, appchain);
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
        console.log("finalizedHead", finalizedHead.toHuman())
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
      if (!/(disconnected)|(No response received)/.test(e.toString())) {
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

    const apiAt = await appchain.at(nextBlockHash);
    const events = await apiAt.query.system.events();
    const containsNewSession = events.findIndex(({ event: { section, method } }) => section === "session" && method === "NewSession") > -1;
    if (containsNewSession) {
      await storeSession(nextHeight);
    }

    let signedCommitmentHex: any;
    if (justificationsHuman) {
      (justificationsHuman as string[]).forEach(justificationHuman => {
        if (justificationHuman[0] === "BEEF") {
          signedCommitmentHex = justificationHuman[1];
        }
      });
    }
    if (signedCommitmentHex) {
      const session = await getLastNotCompletedSession();
      await handleSignedCommitment(appchain, signedCommitmentHex, session);
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
        leaf_extra: "Vec<u8>",
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
  signedCommitmentHex: string,
  session: Session,
) {
  const decodedSignedCommitment = decodeV1SignedCommitment(signedCommitmentHex);
  const isWitnessMode = await checkAnchorIsWitnessMode();
  if (isWitnessMode) {
    return;
  }
  const blockNumberInAnchor = Number(await getLatestCommitmentBlockNumber());
  const { blockNumber } = decodedSignedCommitment.commitment;

  if (blockNumberInAnchor >= blockNumber) {
    return;
  }
  const isNewSession = session && blockNumber >= session.height

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

  if (unMarkedCommitments.length === 0 && (!isNewSession)) {
    return;
  }

  // if (inInterval) {
  //   console.log("skip this justification. Reason: in interval");
  //   return;
  // }

  console.log("decodedSignedCommitment", util.inspect(decodedSignedCommitment.toJSON(), { showHidden: false, depth: null, colors: true }))

  if (!isAuthoritiesEqual) {
    console.log("Authorities changed!");
  }
  logJSON("previousAuthorities", previousAuthorities);
  logJSON("currentAuthorities", currentAuthorities);

  console.log("blockNumber======", blockNumber.toNumber())
  logJSON("currBlockHash", currBlockHash);
  const rawMmrProofWrapper = await appchain.rpc.mmr.generateBatchProof(
    [Number(decodedSignedCommitment.commitment.blockNumber) - 1],
    currBlockHash
  );
  logJSON("rawMmrProofWrapper", rawMmrProofWrapper.toJSON());
  // const decodedMmrProofWrapper = decodeMmrProofWrapper(rawMmrProofWrapper);
  // logJSON("decodedMmrProofWrapper", decodedMmrProofWrapper);

  const ethAddrs = currentAuthorities.map((a: string) => publicKeyToAddress(a));
  const leaves = ethAddrs.map((a: string) => keccak256(a));
  const tree = new MerkleTree(leaves, keccak256);
  const root = tree.getRoot().toString("hex");

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
  console.log("lightClientState", util.inspect(lightClientState, { showHidden: false, depth: null, colors: true }))

  const actionType = "UpdateState";
  try {
    if (isNewSession) {
      if (await confirmAction(actionType)) {
        console.log("done");
        setRelayMessagesLock(true);
        await updateState(lightClientState);
        if (isNewSession) {
          await sessionCompleted(session.height);
        }
        setRelayMessagesLock(false);
        await storeAction(actionType);
        lastStateUpdated = Date.now();
      }
    } else {
      storeLightClientState({ lightClientState, decodedSignedCommitment });
    }
  } catch (err) {
    if (isNewSession) {
      await markFailedSession(session.height);
    }
    setRelayMessagesLock(false);
    console.log(err);
  }
}

start().catch((error) => {
  console.error("error catch in start", error);
  process.exit(-1);
});
