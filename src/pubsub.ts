// Imports the Google Cloud client library
import { PubSub } from "@google-cloud/pubsub";

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
