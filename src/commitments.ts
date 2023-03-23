import { ApiPromise } from "@polkadot/api";
import { logJSON, toNumArray } from "./utils";
import { relayMessagesWithSignature, relayMessages } from "./nearCalls";
import { getNextHeight, getLatestFinalizedHeight } from "./blockHeights";
import { dbRunAsync, dbAllAsync, dbGetAsync, upsertCommitments } from "./db";
import { isActionCompleted } from "./actions";
import { confirmProcessingMessages } from "./messages";
import { Commitment, MessageProof, MessageWithSignature } from "./interfaces";
import { MmrLeafProof } from "@polkadot/types/interfaces";
import { SECOND, MINUTE } from "./constants";
import decodeMessages from "messages-decoder";
import util from "util";
import { _SERVICE as Service } from "./factory/idl.d";
import { signMessages, updateState as updateStateForCanister } from "./icp";
import { bool } from "@polkadot/types";

let relayMessagesLock = false;
export function setRelayMessagesLock(status: boolean) {
  relayMessagesLock = status;
}

export async function directHandleCommitments(
  appchain: ApiPromise,
  actor: Service
) {
  if (appchain.isConnected) {
    try {
      const nextHeight = await getNextHeight();
      const currentHeight = nextHeight - 1;
      const unMarkedCommitments = await getUnmarkedCommitments(currentHeight);
      if (unMarkedCommitments.length > 0) {
        console.log("unMarkedCommitments.length: ", unMarkedCommitments.length);

        unMarkedCommitments;
        // Use try-catch here instead of in handleCommitment for issuring the excecution order.
        for (let index = 0; index < unMarkedCommitments.length; index++) {
          // Excecute by order.
          await handleCommitment(
            unMarkedCommitments[index],
            appchain,
            actor,
            true
          );
        }
      }
    } catch (e: any) {
      console.error("commitments handling failed", e);
    }
  }
}

export async function updateStateAndHandleCommitments(
  appchain: ApiPromise,
  actor: Service,
  state: Uint8Array,
  blockNumber: number
) {
  if (appchain.isConnected) {
    try {
      const nextHeight = await getNextHeight();
      const currentHeight = nextHeight - 1;
      const unMarkedCommitments = await getUnmarkedCommitments(currentHeight);
      if (unMarkedCommitments.length > 0) {
        await updateState(actor, state, blockNumber);
        console.log("unMarkedCommitments.length: ", unMarkedCommitments.length);

        unMarkedCommitments;
        // Use try-catch here instead of in handleCommitment for issuring the excecution order.
        for (let index = 0; index < unMarkedCommitments.length; index++) {
          // Excecute by order.
          await handleCommitment(
            unMarkedCommitments[index],
            appchain,
            actor,
            false
          );
        }
      } else {
        if (
          latestUpdateStateTime == null ||
          Date.now() - latestUpdateStateTime >= 4 * 60 * 60 * 1000
        ) {
          console.log("data.now", Date.now());
          console.log("latestSetTime", latestUpdateStateTime);
          await updateState(actor, state, blockNumber);
        }
      }
    } catch (e: any) {
      console.error("commitments handling failed", e);
    }
  }
}

let latestUpdateStateBlockNumber: any = null;
function setLatestUpdateStateBlockNumber(block_number: any) {
  latestUpdateStateBlockNumber = block_number;
}

export function getLatestUpdateStateBlockNumber(): number {
  return latestUpdateStateBlockNumber;
}

let latestUpdateStateTime: any = null;
function setlatestUpdateStateTime() {
  latestUpdateStateTime = Date.now();
}

async function updateState(
  actor: Service,
  state: Uint8Array,
  blockNumber: number
) {
  await updateStateForCanister(actor, state);
  setLatestUpdateStateBlockNumber(blockNumber);
  setlatestUpdateStateTime();
}

async function handleCommitment(
  commitment: Commitment,
  appchain: ApiPromise,
  actor: Service,
  isWitnessMode: boolean
) {
  const latestFinalizedHeight = getLatestFinalizedHeight();
  if (commitment.height > latestFinalizedHeight) {
    return;
  }

  const encoded_messages = await getOffchainDataForCommitment(
    appchain,
    commitment.commitment
  );
  // console.log('encoded_messages: ', encoded_messages)
  // const decoded_messages: any = decodeMessages(encoded_messages)
  // console.log(
  //   'decoded_messages: ',
  //   util.inspect(decoded_messages.toString(), {
  //     showHidden: false,
  //     depth: null,
  //     colors: true,
  //   })
  // )

  let rawProof: MmrLeafProof | undefined = undefined;
  let messageProof: MessageProof | undefined = undefined;
  let messageProofWithoutState: MessageProof | undefined = undefined;

  if (isWitnessMode) {
    console.log(
      "witnessMode ===== relay messages without proofs",
      encoded_messages
    );
    messageProofWithoutState = messageProofWithoutProof(encoded_messages);
  } else {
    if (
      latestUpdateStateBlockNumber > latestFinalizedHeight ||
      commitment.height >= latestUpdateStateBlockNumber
    ) {
      console.log(
        "latestUpdateStateBlockNumber : ",
        latestUpdateStateBlockNumber
      );
      console.log("latestFinalizedHeight: ", latestFinalizedHeight);
      console.log("commitment.height: ", commitment.height);
      return;
    }

    console.log("relay messages with proofs");
    const cBlockHash = await appchain.rpc.chain.getBlockHash(commitment.height);
    const cHeader = await appchain.rpc.chain.getHeader(cBlockHash);
    try {
      const mmrRootBlockHash = await appchain.rpc.chain.getBlockHash(
        latestUpdateStateBlockNumber
      );

      rawProof = await appchain.rpc.mmr.generateProof(
        commitment.height,
        mmrRootBlockHash
      );
      logJSON("rawProof", rawProof);
      messageProof = {
        encoded_messages: toNumArray(encoded_messages),
        header: toNumArray(cHeader.toHex()),
        mmr_leaf: toNumArray(rawProof.leaf),
        mmr_proof: toNumArray(rawProof.proof),
      };
    } catch (error) {
      console.log("generateProof error", error);
    }
  }

  if (messageProof || messageProofWithoutState) {
    let txId: string = "";
    let failedCall: any = null;
    try {
      let inStateCompleting: boolean = false;
      if (rawProof) {
        inStateCompleting = !(await isActionCompleted("UpdateState"));
        console.log("inStateCompleting", inStateCompleting);
      }

      if (relayMessagesLock) {
        return;
      }

      let callResult: any;
      if (messageProof) {
        let sig = await signMessages(actor, messageProof);
        let sigInArray = Array.from(sig);
        console.log("sig:", sigInArray);
        let messageWithSignature = {
          encoded_messages: messageProof.encoded_messages,
          verification_proxy_signature: sigInArray,
        };
        callResult = await relayMessagesWithSignature(messageWithSignature);
      } else if (messageProofWithoutState) {
        console.log("witnessMode ===== will relay messages");
        messageProofWithoutState = messageProofWithoutProof(encoded_messages);
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

export async function getOffchainDataForCommitment(
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

export async function getUnmarkedCommitments(
  height: number
): Promise<Commitment[]> {
  const commitments: Commitment[] = await dbAllAsync(
    "SELECT * FROM commitments WHERE height <= ? AND status == 0 ORDER BY height",
    [height]
  );
  return commitments.map(({ height, commitment }) => ({
    height,
    commitment,
  }));
}

export async function getCommitments(): Promise<Commitment[]> {
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
