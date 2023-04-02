// Imports the Google Cloud client library
import { PubSub, v1 } from "@google-cloud/pubsub";
import { ApiPromise } from "@polkadot/api";
import { BlockHash, MmrLeafBatchProof } from "@polkadot/types/interfaces";

export interface MessageProof {
  proof: MmrLeafBatchProof;
  message: any;
}

// Creates a client; cache this for further use
const pubSubClient = new PubSub();

export async function publishMessage(topicNameOrId: string, data: string) {
  // Publishes the message as a string, e.g. "Hello, world!" or JSON.stringify(someObject)
  const dataBuffer = Buffer.from(data);

  try {
    const messageId = await pubSubClient
      .topic(topicNameOrId)
      .publishMessage({ data: dataBuffer });
    console.log(`Message ${messageId} published.`);
  } catch (error) {
    console.error(
      `Received error while publishing: ${(error as Error).message}`
    );
    process.exitCode = 1;
  }
}

// Creates a client; cache this for further use.
const subClient = new v1.SubscriberClient();

export async function synchronousPull(
  api: ApiPromise,
  projectId: string,
  subscriptionNameOrId: string,
  until: number,
  hash: BlockHash
) {
  // The low level API client requires a name only.
  const formattedSubscription =
    subscriptionNameOrId.indexOf("/") >= 0
      ? subscriptionNameOrId
      : subClient.subscriptionPath(projectId, subscriptionNameOrId);

  // The maximum number of messages returned for this request.
  // Pub/Sub may return fewer than the number specified.
  const request = {
    subscription: formattedSubscription,
    maxMessages: 10,
  };

  // The subscriber pulls a specified number of messages.
  const [response] = await subClient.pull(request);

  // Process the messages.
  const ackIds: string[] = [];
  const messageProofs: MessageProof[] = [];
  for (const message of response.receivedMessages ?? []) {
    console.log(`Received message: ${message.message?.data}`);
    const obj = JSON.parse(`${message.message?.data}`);
    if (obj.blockNumber < until) {
      const leafIndex = obj.blockNumber;

      console.log(`Generate MMR proof for leafIndex: ${leafIndex} at ${until}`);
      const mmrProof = await api.rpc.mmr.generateProof(
        [leafIndex],
        until,
        hash
      );
      messageProofs.push({ proof: mmrProof, message: obj });
      if (message.ackId) {
        ackIds.push(message.ackId);
      }
    }
  }

  if (ackIds.length !== 0) {
    // Acknowledge all of the messages. You could also acknowledge
    // these individually, but this is more efficient.
    const ackRequest = {
      subscription: formattedSubscription,
      ackIds: ackIds,
    };

    await subClient.acknowledge(ackRequest);
    return messageProofs;
  }

  console.log("Done.");
}