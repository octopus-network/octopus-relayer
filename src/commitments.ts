import { ApiPromise } from "@polkadot/api";
import { decodeData, logJSON, toNumArray } from "./utils";
import { relayMessages, getLatestCommitmentBlockNumber, checkAnchorIsWitnessMode } from "./nearCalls";
import { getNextHeight, getLatestFinalizedHeight } from "./blockHeights";
import { dbRunAsync, dbAllAsync, dbGetAsync } from "./db";
import {
  isActionCompleted,
} from "./actions";
import { confirmProcessingMessages } from "./messages";
import { Commitment, ActionType, MessageProof, Action } from "./interfaces";
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
        console.log("finalizedHead", finalizedHead)
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
        nonce: "u64",
        payload_type: "PayloadType",
        payload: "Vec<u8>",
      },
      PayloadType: {
        _enum: ["Lock", "BurnAsset", "PlanNewEra", "EraPayout", "LockNft"],
      },
    },
    encoded_messages
  );
  console.log("decoded_messages", util.inspect(decoded_messages.toJSON(), { showHidden: false, depth: null, colors: true }));

  let rawProof: MmrLeafProof | undefined = undefined;
  let messageProof: MessageProof | undefined = undefined;

  const isWitnessMode = await checkAnchorIsWitnessMode();
  if (isWitnessMode) {
    console.log(
      "witnessMode ===== relay messages without proofs",
      encoded_messages
    );
    messageProof = messageProofWithoutProof(encoded_messages);
  } else {
    const blockNumberInAnchor = Number(await getLatestCommitmentBlockNumber());
    if (blockNumberInAnchor > latestFinalizedHeight) {
      return;
    }
    if (commitment.height < blockNumberInAnchor) {
      console.log("relay messages with proofs");
      const cBlockHash = await appchain.rpc.chain.getBlockHash(commitment.height);
      const cHeader = await appchain.rpc.chain.getHeader(cBlockHash);
      const blockHashInAnchor = await appchain.rpc.chain.getBlockHash(
        blockNumberInAnchor
      );
      logJSON("blockHashInAnchor", blockHashInAnchor);
      try {
        rawProof = await appchain.rpc.mmr.generateProof(
          commitment.height,
          blockHashInAnchor
        );
        logJSON("rawProof", rawProof);
        if (rawProof) {
          messageProof = {
            header: toNumArray(cHeader.toHex()),
            encoded_messages: toNumArray(encoded_messages),
            mmr_leaf: toNumArray(rawProof.leaf),
            mmr_proof: toNumArray(rawProof.proof),
          };
        } else {
          messageProof = messageProofWithoutProof(encoded_messages);
        }
      } catch (error) {
        console.log("generateProof error", error);
        messageProof = messageProofWithoutProof(encoded_messages);
      }
    }
  }

  if (messageProof) {
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
    header: [] as number[],
    encoded_messages: toNumArray(encoded_messages),
    mmr_leaf: [] as number[],
    mmr_proof: [] as number[],
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
  const prefixBuffer = Buffer.from("commitment", "utf8");
  const key = "0x" + prefixBuffer.toString("hex") + commitment.slice(2);
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
  return await dbRunAsync(
    "INSERT INTO commitments(height, commitment, created_at, updated_at, tx_id, status) values(?, ?, datetime('now'), datetime('now'), NULL, 0)",
    [height, commitment]
  );
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
