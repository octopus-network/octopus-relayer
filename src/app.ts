import "@polkadot/api-augment";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Account } from "near-api-js";
import {
  logJSON,
  toNumArray,
  toBytes,
  WsProvider2,
  decodeV1SignedCommitment,
} from "./utils";
import keccak256 from "keccak256";
// @ts-ignore
import publicKeyToAddress from "ethereum-public-key-to-address";
import MerkleTree from "merkletreejs";
import { initNearRpc, checkAnchorIsWitnessMode } from "./nearCalls";
import { initDb } from "./db";
import { MerkleProof, MerkleProof2, Session } from "./interfaces";
import {
  getNextHeight,
  getLatestFinalizedHeight,
  updateSyncedBlock,
  syncFinalizedHeights,
} from "./blockHeights";
import {
  storeCommitment,
  getLatestUpdateStateBlockNumber,
  updateStateAndHandleCommitments,
  directHandleCommitments,
} from "./commitments";
import { storeAction, confirmAction, tryCompleteActions } from "./actions";
import {
  getLastNotCompletedSession,
  storeSession,
  sessionCompleted,
  markFailedSession,
} from "./sessions";
import { confirmProcessingMessages } from "./messages";
// @ts-ignore
import { isEqual } from "lodash";
import { appchainSetting, MINUTE, SECOND } from "./constants";
import util from "util";
import {
  newActor,
  setIcpClient,
  getPublicKey,
  forceSetIcpClient,
  updateState as updateStateForCanister,
} from "./icp";
import { initial_public_keys } from "./mock";
import { _SERVICE as Service } from "./factory/idl.d";

const BLOCK_SYNC_SIZE = 20;
const BLOCK_LOG_SIZE = 100;

async function start() {
  await initDb();
  const account = await initNearRpc();
  const wsProvider = new WsProvider2(
    appchainSetting.wsRpcEndpoint,
    5 * MINUTE,
    undefined,
    3 * MINUTE
  );

  const exitTimer = setTimeout(() => {
    console.error("init polkadotjs expired: always pending");
    process.exit(1);
  }, MINUTE);

  const actor = await newActor();
  // await setIcpClient(actor, "test", initial_public_keys);
  await forceSetIcpClient(actor, "test", initial_public_keys);

  let publickey = await getPublicKey(actor);
  // let public_key = new Uint8Array(Buffer.from(publickey, "hex"));
  console.log("Icp canister publickey is: ", publickey);

  const appchain = await ApiPromise.create({
    provider: wsProvider,
  });
  if (appchain) {
    clearTimeout(exitTimer);
    listening(appchain, account, actor);
    wsProvider.on("error", (error) =>
      console.log("provider", "error", JSON.stringify(error))
    );
    appchain.on("disconnected", () => handleDisconnected(wsProvider, appchain));
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
  actor: Service
) {
  console.log("start syncing");
  syncBlocks(appchain, actor);
  syncFinalizedHeights(appchain);
  confirmProcessingMessages();
  tryCompleteActions(account, appchain);
}

async function handleDisconnected(provider: WsProvider, appchain: ApiPromise) {
  console.log("provider.isConnected", provider.isConnected);
  console.log("appchain.isConnected", appchain.isConnected);
  setTimeout(async () => {
    if (!(appchain.isConnected && provider.isConnected)) {
      console.log("timeout for reconnection");
      process.exit(-1);
    }
  }, 20 * MINUTE);
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
async function syncBlocks(appchain: ApiPromise, actor: Service) {
  // set expired time for the whole async block
  const timer = setTimeout(async () => {
    console.error("syncBlocks expired");
    const latestFinalizedHeight = getLatestFinalizedHeight();
    console.log("latestFinalizedHeight", latestFinalizedHeight);

    // test connection
    const exitTimer = setTimeout(() => {
      console.error("test connection: always pending");
      process.exit(1);
    }, 10 * SECOND);
    try {
      const finalizedHead = await appchain.rpc.chain.getFinalizedHead();
      if (finalizedHead) {
        console.log("test connection: Ok");
        console.log("finalizedHead", finalizedHead.toHuman());
        return clearTimeout(exitTimer);
      }
    } catch (e) {
      console.error("test connection: fail", e);
    }
  }, 2 * MINUTE);

  if (appchain.isConnected) {
    try {
      const nextHeight = await getNextHeight();
      const latestFinalizedHeight = getLatestFinalizedHeight();
      console.log(
        "syncBlocks nextHeight: %o, latestFinalizedHeight: %o",
        nextHeight,
        latestFinalizedHeight
      );
      if (nextHeight <= latestFinalizedHeight) {
        if (nextHeight - lastSyncBlocksLog >= BLOCK_LOG_SIZE) {
          console.log("nextHeight", nextHeight);
          lastSyncBlocksLog = nextHeight;
        }
        if (nextHeight <= latestFinalizedHeight - BLOCK_SYNC_SIZE) {
          const promises = new Array(BLOCK_SYNC_SIZE)
            .fill(1)
            .map(async (_, index) => {
              await syncBlock(appchain, nextHeight + index, actor);
            });
          await Promise.all(promises);
          await updateSyncedBlock(nextHeight + BLOCK_SYNC_SIZE - 1);
        } else {
          await syncBlock(appchain, nextHeight, actor);
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
  setTimeout(() => syncBlocks(appchain, actor), 6000);
}

async function syncBlock(
  appchain: ApiPromise,
  nextHeight: number,
  actor: Service
) {
  const latestFinalizedHeight = getLatestFinalizedHeight();
  if (nextHeight <= latestFinalizedHeight) {
    const nextBlockHash = await appchain.rpc.chain.getBlockHash(nextHeight);
    const blockWrapper = await appchain.rpc.chain.getBlock(nextBlockHash);
    const {
      block: { header },
      justifications,
    } = blockWrapper;
    const justificationsHuman = justifications.toHuman();
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        await storeCommitment(header.number.toNumber(), commitment);
      }
    });

    const apiAt = await appchain.at(nextBlockHash);
    const events = await apiAt.query.system.events();
    const containsNewSession =
      events.findIndex(
        ({ event: { section, method } }) =>
          section === "session" && method === "NewSession"
      ) > -1;
    if (containsNewSession) {
      await storeSession(nextHeight);
    }

    const isWitnessMode = await checkAnchorIsWitnessMode();
    if (isWitnessMode) {
      await directHandleCommitments(appchain, actor);
    } else {
      let signedCommitmentHex: any;
      if (justificationsHuman) {
        (justificationsHuman as string[]).forEach((justificationHuman) => {
          if (justificationHuman[0] === "BEEF") {
            signedCommitmentHex = justificationHuman[1];
          }
        });
      }
      if (signedCommitmentHex) {
        await handleSignedCommitment(appchain, signedCommitmentHex, actor);
      }
    }
  }
}

async function handleSignedCommitment(
  appchain: ApiPromise,
  signedCommitmentHex: string,
  actor: Service
) {
  const decodedSignedCommitment = decodeV1SignedCommitment(signedCommitmentHex);
  const latestUpdateStateBlockNumber = getLatestUpdateStateBlockNumber();
  const { blockNumber } = decodedSignedCommitment.commitment;

  if (latestUpdateStateBlockNumber >= blockNumber) {
    return;
  }

  const currBlockHash = await appchain.rpc.chain.getBlockHash(blockNumber);
  const previousBlockHash = await appchain.rpc.chain.getBlockHash(
    blockNumber - 1
  );
  const currentAuthorities: any = (
    await appchain.query.beefy.authorities.at(currBlockHash)
  ).toJSON();
  const previousAuthorities: any = (
    await appchain.query.beefy.authorities.at(previousBlockHash)
  ).toJSON();
  const isAuthoritiesEqual = isEqual(currentAuthorities, previousAuthorities);

  console.log(
    "decodedSignedCommitment",
    util.inspect(decodedSignedCommitment.toJSON(), {
      showHidden: false,
      depth: null,
      colors: true,
    })
  );

  if (!isAuthoritiesEqual) {
    console.log("Authorities changed!");
  }
  logJSON("previousAuthorities", previousAuthorities);
  logJSON("currentAuthorities", currentAuthorities);

  console.log("blockNumber======", blockNumber.toNumber());
  logJSON("currBlockHash", currBlockHash);

  const rawMmrProofWrapper = await appchain.rpc.mmr.generateProof(
    Number(decodedSignedCommitment.commitment.blockNumber) - 1,
    currBlockHash
  );
  logJSON("rawMmrProofWrapper", rawMmrProofWrapper.toJSON());

  const ethAddrs = currentAuthorities.map((a: string) => publicKeyToAddress(a));
  const leaves = ethAddrs.map((a: string) => keccak256(a));
  const tree = new MerkleTree(leaves, keccak256);
  const root = tree.getRoot().toString("hex");

  const merkleProofs = leaves.map((leaf: any, index: number) => {
    const proof: string[] = tree.getHexProof(leaf);
    console.log("proof", proof);
    const u8aProof = proof.map((hash) => toNumArray(hash));
    const merkleProof: MerkleProof2 = {
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

  console.log(
    "lightClientState",
    util.inspect(lightClientState, {
      showHidden: false,
      depth: null,
      colors: true,
    })
  );

  // console.log('storeLightClientState', JSON.stringify(lightClientState))
  // console.log('storeLightClientState', toBytes(JSON.stringify(lightClientState)))
  await updateStateAndHandleCommitments(
    appchain,
    actor,
    toBytes(JSON.stringify(lightClientState)),
    Number(decodedSignedCommitment.commitment.blockNumber)
  );
}

start().catch((error) => {
  console.error("error catch in start", error);
  process.exit(-1);
});
