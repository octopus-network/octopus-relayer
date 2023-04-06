import { v1 } from "@google-cloud/pubsub";
import {
  newActor,
  getPublicKey,
  setIcpClient,
  resetIcpClient,
  updateState as updateStateForCanister,
  signMessages,
} from "./icp/icp";
import {
  initial_public_keys,
  state,
  header,
  mmr_leaf,
  mmr_proof,
  messages2,
} from "./icp/mock";

const projectId = "octopus-dev-309403";
const topicVersionedFinalityProof =
  "projects/octopus-dev-309403/topics/test-appchain-versioned-finality-proof";
const topicMessage = "projects/octopus-dev-309403/topics/test-appchain-message";
const topicUnsignedMessage =
  "projects/octopus-dev-309403/topics/test-appchain-unsigned-message";
const subscriptionMessage =
  "projects/octopus-dev-309403/subscriptions/test-appchain-message-sub";
const subscriptionUnsignedMessage =
  "projects/octopus-dev-309403/subscriptions/test-appchain-unsigned-message-sub";
const subscriptionVersionedFinalityProof =
  "projects/octopus-dev-309403/subscriptions/test-appchain-versioned-finality-proof-sub";

export interface MessageWithSignature {
  encoded_messages: number[];
  verification_proxy_signature: number[] | null;
}

async function main() {
  await newIcpClient();
  await test_update_state();
  // await handleMessage();
}

let actor: any = null;
async function newIcpClient() {
  if (actor == null) {
    actor = await newActor();
    await getPublicKey(actor);
    // await setIcpClient(actor, "test", initial_public_keys);
    await resetIcpClient(actor, "test", initial_public_keys);
  }

  // await updateStateForCanister(actor, new Uint8Array(state));
  // await signMessages(actor, new Uint8Array(messages2), new Uint8Array(header), new Uint8Array(mmr_leaf), new Uint8Array(mmr_proof));
}

async function handleMessage() {
  await synchronousPull(projectId, topicVersionedFinalityProof);
}

// Creates a client; cache this for further use.
const subClient = new v1.SubscriberClient();

export async function synchronousPull(
  projectId: string,
  subscriptionNameOrId: string
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

  console.log(`Before received message +++++++++++++++ `);
  // Process the messages.
  const ackIds: string[] = [];
  for (const message of response.receivedMessages ?? []) {
    console.log(`Received message: ${message.message?.data}`);
    const obj = JSON.parse(`${message.message?.data}`);

    // 1. update state
    console.log("before update state:");
    let versionedFinalityProof = hexStringToUint8Array(
      obj.beefySignedCommitment
    );
    let authoritySetProof = obj.authoritySetProof.map(hexStringToUint8Array);
    let mmrLeaves = hexStringToUint8Array(obj.mmrLeaves);
    let mmrProof = hexStringToUint8Array(obj.mmrProof);

    console.log(`versionedFinalityProof:  ${versionedFinalityProof}`);
    console.log(`authoritySetProof: ${authoritySetProof}`);
    console.log(`mmrLeaves: ${mmrLeaves}`);
    console.log(`mmrProof: ${mmrProof}`);

    const result = await updateStateForCanister(
      actor,
      versionedFinalityProof,
      authoritySetProof,
      mmrLeaves,
      mmrProof
    );
    console.log(`Update state result: ${result}`);

    // 2. verify messages


    if (message.ackId) {
      ackIds.push(message.ackId);
    }
  }

  if (ackIds.length !== 0) {
    // Acknowledge all of the messages. You could also acknowledge
    // these individually, but this is more efficient.
    const ackRequest = {
      subscription: formattedSubscription,
      ackIds: ackIds,
    };

    // await subClient.acknowledge(ackRequest);
  }

  console.log("Done.");
}

async function test_update_state() {
  let s1 =
    "0x01046d688073ef87418b8855d5955db4384fa6219a8c1b2b49c8a9cde3e00233088f3179f261000000000000000000000004c00200000008fa49c77e42b7ee863e26344674ab845d3cd5a0bfc9d2aa9d0bbd48eeeb1ed4c07f63a27d54cfa833cb617414b2ddacb8ba91ac1ae1915d90a9fcafe21214501700d63ab6e28c21034e8628c78d0730be86d66e70db763278476476d388e814047a77346861c982d7aaee0faf98c88fe4dd5e9500f3cd8537fd7b5f0cc465654b4901";
  let s2 = [
    "0x697ea2a8fe5b03468548a7a413424a6292ab44a82a6f5cc594c3fa7dda7ce40204f68aec7304bf37f340dae2ea20fb5271ee28a3128812b84a615da4789e458bde0200000000000000000000000000000050e04cc55ebee1cbce552f250e85c57b70b2e2625b",
    "0x697ea2a8fe5b03468548a7a413424a6292ab44a82a6f5cc594c3fa7dda7ce40204aeb47a269393297f4b0a3c9c9cfd00c7a4195255274cf39d83dabc2fcc9ff3d7020000000000000001000000000000005025451a4de12dccc2d166922fa938e900fcc4ed24",
  ];
  let s3 =
    "0x044901005f0000005fab560d4f7025d5ec8a5edf2f412c89b9d100710f48b06508f1ba13aa44e56c010000000000000002000000697ea2a8fe5b03468548a7a413424a6292ab44a82a6f5cc594c3fa7dda7ce40200";
  let s4 =
    "0x045f0000000000000061000000000000001c32006e36a2d63f3a5a4f1cfd5e1414d5ccd362c8f67c92f865f6ba35c76632a3c7607d15bcff3f8a8834807b61c0d6ed8dff009c6a4a3767b1ad3be24ef9136334e2dbcd8c6998ff865912a081acd95589e0319116c8cf2bde71ab25b8976506b16370c839e0d724c2c1c3d255a4be75d34d792c105cf36c5b0c9b448a6c344c67ec5946d8c4f0543ff484b2c5be092bb0a7912b91e4b91e6b7be789dbfe27f876cb3dd1ed195cf64a4da24c314ce1b3efe4919fe137389ab596b976f8cebf2519af8360663232451e34ebda90361e37c3f37ae48b6cfefc7f2971d84ff16a36";

  let ss1 = hexStringToUint8Array(s1);
  let ss2 = s2.map(hexStringToUint8Array);
  
  let ss3 = hexStringToUint8Array(s3);
  let ss4 = hexStringToUint8Array(s4);
  const result = await updateStateForCanister(actor, ss1, ss2, ss3, ss4);
  console.log("after :");
  console.log(result);
}

function hexStringToUint8Array(hexString: string): Uint8Array {
  const buffer = Buffer.from(hexString.slice(2), "hex");
  return new Uint8Array(buffer);
}

main().catch(console.error);
