import { ApiPromise } from "@polkadot/api";
import { decodeData, logJSON, toNumArray } from "./utils";
import {
  relayMessages,
  getLatestCommitmentBlockNumber,
  tryComplete,
} from "./nearCalls";
import { getNextHeight, getLatestFinalizedHeight } from "./blockHeights";
import { dbRunAsync, dbAllAsync, dbGetAsync } from "./db";
import { storeAction, confirmAction } from "./actions";
import { Commitment, ActionType, MessageProof, Action } from "./interfaces";

let relayMessagesLock = false;

export function setRelayMessagesLock(status: boolean) {
  relayMessagesLock = status;
}

export async function handleCommitments(appchain: ApiPromise) {
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
  const blockNumberInAnchor = Number(await getLatestCommitmentBlockNumber());
  const latestFinalizedHeight = getLatestFinalizedHeight();
  if (
    commitment.height > latestFinalizedHeight ||
    blockNumberInAnchor > latestFinalizedHeight
  ) {
    return;
  }

  let messageProof: MessageProof | undefined = undefined;
  if (commitment.height >= blockNumberInAnchor + 20) {
    console.log("commitment.height >= blockNumberInAnchor + 20");
    messageProof = messageProofWithoutProof(encoded_messages);
  } else if (commitment.height < blockNumberInAnchor) {
    console.log("relay messages with proofs");
    const cBlockHash = await appchain.rpc.chain.getBlockHash(commitment.height);
    const cHeader = await appchain.rpc.chain.getHeader(cBlockHash);
    const blockHashInAnchor = await appchain.rpc.chain.getBlockHash(
      blockNumberInAnchor
    );
    logJSON("blockHashInAnchor", blockHashInAnchor);
    try {
      const rawProof = await appchain.rpc.mmr.generateProof(
        commitment.height,
        blockHashInAnchor
      );
      if (rawProof) {
        logJSON("rawProof", rawProof);
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

  if (messageProof) {
    console.log("decoded_messages", JSON.stringify(decoded_messages));
    console.log("blockNumberInAnchor", blockNumberInAnchor);
    console.log("latestFinalizedHeight", latestFinalizedHeight);
    console.log("commitment.height", commitment.height);
    let txId: string = "";
    let failedCall: any = null;
    try {
      for (let index = 0; index < decoded_messages.length; index++) {
        const payloadTypeString =
          decoded_messages[index].payload_type.toString();
        console.log("payloadTypeString", payloadTypeString);
        await confirmAction(payloadTypeString);
      }

      const inStateCompleting = !(await tryComplete(
        "try_complete_updating_state_of_beefy_light_client"
      ));

      console.log("inStateCompleting", inStateCompleting);

      if (relayMessagesLock || inStateCompleting) {
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

    let needCompletes: any = {
      PlanNewEra: false,
      EraPayout: false,
    };

    if (!failedCall) {
      decoded_messages.forEach((msg: any) => {
        if (msg.payload_type.toString() === "PlanNewEra") {
          needCompletes.PlanNewEra = true;
        } else if (msg.payload_type.toString() === "EraPayout") {
          needCompletes.EraPayout = true;
        }
      });
    }

    if (failedCall) {
      await markAsSent(commitment.commitment, 2, txId);
    } else {
      await markAsSent(commitment.commitment, 1, txId);
      await Promise.all(
        Object.keys(needCompletes).map(async (key) =>
          needCompletes[key] ? await storeAction(key as ActionType) : null
        )
      );
    }
  }
}

function messageProofWithoutProof(encoded_messages: string): MessageProof {
  console.log(
    "witnessMode ===== relay messages without proofs",
    encoded_messages
  );
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
  console.log("storeCommitment", commitment);
  return await dbRunAsync(
    "INSERT INTO commitments(height, commitment, created_at, updated_at, tx_id, status) values(?, ?, datetime('now'), datetime('now'), NULL, 0)",
    [height, commitment]
  );
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
