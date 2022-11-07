import { ApiPromise } from "@polkadot/api";
import { decodeData, logJSON, toNumArray } from "./utils";
import { relayMessagesWithAllProofs, getLatestCommitmentBlockNumber, checkAnchorIsWitnessMode, relayMessages } from "./nearCalls";
import { getNextHeight, getLatestFinalizedHeight } from "./blockHeights";
import { dbRunAsync, dbAllAsync, dbGetAsync, upsertCommitments } from "./db";
import {
  isActionCompleted,
} from "./actions";
import { confirmProcessingMessages } from "./messages";
import { Commitment, ActionType, MessageProof, MessageProofWithLightClientState, Action } from "./interfaces";
import { updateStateMinInterval } from "./constants";
import { MmrLeafProof } from "@polkadot/types/interfaces";
const util = require('util')

let relayMessagesLock = false;

export function setRelayMessagesLock(status: boolean) {
  relayMessagesLock = status;
}

export async function handleCommitments(appchain: ApiPromise) {
  // set expired time for the whole async block
  const timer = setTimeout(async () => {
    console.error("handleCommitments expired");

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
    process.exit(-1);
  }, 2 * 60 * 1000);
  if (appchain.isConnected) {
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
      clearTimeout(timer);
    } catch (e: any) {
      console.error("commitments handling failed", e);
      if (!/disconnected/.test(e.toString())) {
        clearTimeout(timer);
      }
    }
  }
  setTimeout(() => handleCommitments(appchain), 6000);
}

let lightClientStateWrapper: any = null;
export function storeLightClientState(_lightClientStateWrapper: any) {
  console.log("storeLightClientState", JSON.stringify(_lightClientStateWrapper));
  lightClientStateWrapper = _lightClientStateWrapper;
}


async function handleCommitment(commitment: Commitment, appchain: ApiPromise) {
  const latestFinalizedHeight = getLatestFinalizedHeight();
  if (commitment.height > latestFinalizedHeight) {
    return;
  }

  const encoded_messages = await getOffchainDataForCommitment(
    appchain,
    commitment.commitment
  );
  const decoded_messages: any = decodeData(
    {
      Messages: "Vec<Message>",
      Message: {
        nonce: "Compact<u64>",
        payload_type: "PayloadType",
        payload: "BoundedVec<u8, u32>",
      },
      PayloadType: {
        _enum: ["Lock", "BurnAsset", "PlanNewEra", "EraPayout", "LockNft"],
      },
    },
    encoded_messages
  );
  console.log("decoded_messages", util.inspect(decoded_messages.toJSON(), { showHidden: false, depth: null, colors: true }));

  let rawProof: MmrLeafProof | undefined = undefined;
  let messageProofWithState: MessageProofWithLightClientState | undefined = undefined;
  let messageProofWithoutState: MessageProof | undefined = undefined;

  const isWitnessMode = await checkAnchorIsWitnessMode();
  if (isWitnessMode) {
    console.log(
      "witnessMode ===== relay messages without proofs",
      encoded_messages
    );
    messageProofWithoutState = messageProofWithoutProof(encoded_messages);
  } else {
    const blockNumberInAnchor = Number(await getLatestCommitmentBlockNumber());
    if (
      blockNumberInAnchor > latestFinalizedHeight
      || !lightClientStateWrapper
      || commitment.height >= blockNumberInAnchor) {
      return;
    }

    console.log("relay messages with proofs");
    const cBlockHash = await appchain.rpc.chain.getBlockHash(commitment.height);
    const cHeader = await appchain.rpc.chain.getHeader(cBlockHash);
    const blockHashInAnchor = await appchain.rpc.chain.getBlockHash(
      blockNumberInAnchor
    );
    logJSON("blockHashInAnchor", blockHashInAnchor);
    try {
      const { lightClientState, decodedSignedCommitment } = lightClientStateWrapper;
      const mmrRootBlockHash = await appchain.rpc.chain.getBlockHash(
        decodedSignedCommitment.commitment.blockNumber
      );
      rawProof = await appchain.rpc.mmr.generateProof(
        commitment.height,
        mmrRootBlockHash
      );
      logJSON("rawProof", rawProof);
      if (rawProof) {
        messageProofWithState = {
          signed_commitment: lightClientState.signed_commitment,
          validator_proofs: lightClientState.validator_proofs,
          mmr_leaf_for_mmr_root: lightClientState.mmr_leaf,
          mmr_proof_for_mmr_root: lightClientState.mmr_proof,
          encoded_messages: toNumArray(encoded_messages),
          header: toNumArray(cHeader.toHex()),
          mmr_leaf_for_header: toNumArray(rawProof.leaf),
          mmr_proof_for_header: toNumArray(rawProof.proof),
        };
      } else {
        messageProofWithoutState = messageProofWithoutProof(encoded_messages);
      }
    } catch (error) {
      console.log("generateProof error", error);
      messageProofWithoutState = messageProofWithoutProof(encoded_messages);
    }
  }

  if (messageProofWithState || messageProofWithoutState) {
    let txId: string = "";
    let failedCall: any = null;
    try {
      let inStateCompleting: boolean = false;
      if (rawProof) {
        inStateCompleting = !(await isActionCompleted("UpdateState"));
        console.log("inStateCompleting", inStateCompleting);
      }

      if (relayMessagesLock || (inStateCompleting && !isWitnessMode)) {
        return;
      }

      let callResult: any;
      if (messageProofWithState) {
        callResult = await relayMessagesWithAllProofs(messageProofWithState);
      } else if (messageProofWithoutState) {
        callResult = await relayMessages(messageProofWithoutState);
      }
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
      await markAsSent(commitment.commitment, 2, txId);
      const latestIsWitnessMode = await checkAnchorIsWitnessMode();
      if (isWitnessMode && !latestIsWitnessMode) {
        console.log(
          "re-handle commitment for witnessMode switching",
          commitment
        );
        await handleCommitment(commitment, appchain);
      }
    } else {
      await markAsSent(commitment.commitment, 1, txId);
      await confirmProcessingMessages();
    }

  }
}

function messageProofWithoutProof(encoded_messages: string): MessageProof {
  return {
    encoded_messages: toNumArray(encoded_messages),
    header: [],
    mmr_leaf: [],
    mmr_proof: [],
  };
}

async function markAsSent(commitment: string, status: number, txId: string) {
  await dbRunAsync(
    `UPDATE commitments SET status = ?, updated_at = datetime('now'), tx_id = ? WHERE commitment == ?`,
    [status, txId, commitment]
  );
}

async function getOffchainDataForCommitment(
  appchain: ApiPromise,
  commitment: string
) {
  const key = commitment;
  const data = (
    await appchain.rpc.offchain.localStorageGet("PERSISTENT", key)
  ).toString();
  return data;
}

export async function storeCommitment(
  height: number,
  commitment: String
): Promise<any> {
  console.log(`storeCommitment-${height}`, commitment);
  return await upsertCommitments({
    height,
    commitment,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tx_id: null,
    status: 0,
  });
}

export async function getUnmarkedCommitments(height: number): Promise<Commitment[]> {
  const commitments: Commitment[] = await dbAllAsync(
    "SELECT * FROM commitments WHERE height <= ? AND status == 0 ORDER BY height",
    [height]
  );
  return commitments.map(({ height, commitment }) => ({
    height,
    commitment,
  }));
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
