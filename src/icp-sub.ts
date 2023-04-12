import { v1 } from "@google-cloud/pubsub";
import { publishMessage } from "./pubsub";
import { newActor, getPublicKey, setIcpClient, resetIcpClient, updateState as updateStateForCanister, signMessages } from "./icp/icp";

import { initial_public_keys, projectId, topicSignedMessage, subscriptionVersionedFinalityProof } from "./constants";

async function main() {
  await newIcpClient();
  // await testUpdateState();
  // await testSignMessages();
  await handleMessage();
}

let actor: any = null;
async function newIcpClient() {
  if (actor == null) {
    actor = await newActor();
    await setIcpClient(actor, "test", initial_public_keys);
    // await resetIcpClient(actor, "test", initial_public_keys);
    await getPublicKey(actor);
  }
}

async function handleMessage() {
  await synchronousPull(projectId, subscriptionVersionedFinalityProof);
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

  for (; ;) {
    // The subscriber pulls a specified number of messages.
    const [response] = await subClient.pull(request);

    // Process the messages.
    const ackIds: string[] = [];
    for (const message of response.receivedMessages ?? []) {
      console.log(`Received message: ${message.message?.data}`);
      const obj = JSON.parse(`${message.message?.data}`);

      // 1. update state
      // TODO: This section could be optimized as not need update state every time.
      console.log("Before update state:");
      let versionedFinalityProof = hexStringToUint8Array(
        obj.beefySignedCommitment
      );
      let authoritySetProof = obj.authoritySetProof.map(hexStringToUint8Array);
      let mmrLeaves = hexStringToUint8Array(obj.mmrLeaves);
      let mmrProof = hexStringToUint8Array(obj.mmrProof);

      // console.log(`versionedFinalityProof:  ${versionedFinalityProof}`);
      // console.log(`authoritySetProof: ${authoritySetProof}`);
      // console.log(`mmrLeaves: ${mmrLeaves}`);
      // console.log(`mmrProof: ${mmrProof}`);

      const result = await updateStateForCanister(
        actor,
        versionedFinalityProof,
        authoritySetProof,
        mmrLeaves,
        mmrProof
      );
      console.log("Update state result:", result);

      if (obj.messageProofs && obj.messageProofs.length) {
        for (let i = 0; i < obj.messageProofs.length; i++) {
          const messageProof = obj.messageProofs[i];
          console.log("messageProof:", messageProof);

          // 2. verify messages
          console.log("Before sign messages:");
          let messages = hexStringToUint8Array(
            messageProof.message.crossChainMessages
          );
          let encodedHeader = hexStringToUint8Array(
            messageProof.message.header
          );
          let encodedMmrLeaves = hexStringToUint8Array(messageProof.leaves);
          let encodedMmrProof = hexStringToUint8Array(messageProof.proof);
          const signature = await signMessages(
            actor,
            messages,
            encodedHeader,
            encodedMmrLeaves,
            encodedMmrProof
          );

          if (signature) {
            console.log("After sign messages, signature is: ", signature);

            // 3. publish signed messages
            await publishMessage(
              topicSignedMessage,
              JSON.stringify({
                encodedMessages: messages,
                verificationProxySignature: signature,
              })
            );
          } else {
            console.log("Sign messages error, error is: ", signature);
          }
        }
      }

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

      await subClient.acknowledge(ackRequest);
    }

    console.log("Done.");
  }
}

async function testUpdateState() {
  let s1 =
    "0x01046d6880b530155bc78772edf61ce96692a3dc0a5bdf5f4cd942767314b29dc280463be119000000000000000000000004e0040000000c3c1fa45e174988a5a29a7807ef7cc9fa2dc4249aa2443a4af8ad79149f347eb6218a2657f03aded7436a23d63517126cc98d2f22b1588b7171b7c290c042b1d801992f8fecacdb97b0ea3a8b814bd6354d79e99d5fd9b75a4ca1833388c2813f2b25237cf63bc36bb82a617a7145025900c94be7597a2e2dfd9dc76719850f7afd00bfebf2f9906282d3c426e97ed0eaa867120cbcf59f74878ccc6c5b85e2ffb16f47c282483e505f225490ad9bcecb7178be7d2aacdfb6407409e54e280cf5e19e00";
  let s2 = [
    "0x2145814fb41496b2881ca364a06e320fd1bf2fa7b94e1e37325cefbe2905651908f68aec7304bf37f340dae2ea20fb5271ee28a3128812b84a615da4789e458bde93c6c7e160154c8467b700c291a1d4da94ae9aaf1c5010003a6aa3e9b18657ab0400000000000000000000000000000050e04cc55ebee1cbce552f250e85c57b70b2e2625b",
    "0x2145814fb41496b2881ca364a06e320fd1bf2fa7b94e1e37325cefbe2905651908aeb47a269393297f4b0a3c9c9cfd00c7a4195255274cf39d83dabc2fcc9ff3d793c6c7e160154c8467b700c291a1d4da94ae9aaf1c5010003a6aa3e9b18657ab040000000000000001000000000000005025451a4de12dccc2d166922fa938e900fcc4ed24",
    "0x2145814fb41496b2881ca364a06e320fd1bf2fa7b94e1e37325cefbe290565190850bdd3ac4f54a04702a055c33303025b2038446c7334ed3b3341f310f052116f697ea2a8fe5b03468548a7a413424a6292ab44a82a6f5cc594c3fa7dda7ce40204000000000000000200000000000000505630a480727cd7799073b36472d9b1a6031f840b",
    "0x2145814fb41496b2881ca364a06e320fd1bf2fa7b94e1e37325cefbe29056519083eb799651607280e854bd2e42c1df1c8e4a6167772dfb3c64a813e40f6e87136697ea2a8fe5b03468548a7a413424a6292ab44a82a6f5cc594c3fa7dda7ce40204000000000000000300000000000000504bb32a4263e369acbb6c020ffa89a41fd9722894",
  ];
  let s3 =
    "0x0449010017000000f126e6251f6df464796796e2167e71517141d5042c72e1f5b678914cdaffadbd0100000000000000040000002145814fb41496b2881ca364a06e320fd1bf2fa7b94e1e37325cefbe2905651900";
  let s4 =
    "0x041700000000000000190000000000000014ecbb56fad1763cfcf85065a1e7d3e640f25c24db82c9d547bba4f8a31813799b9278b1352647cba599641add3192dadd29d957d3df08da96e95356eecfcb4f297236345e4e4ea051ac330d46d80d3e8c7ec6e686ef91eb7eb1f7413e375eabfb7a15d088eef383c859b75daad24f0742176a12b0aed30ab5cd069b777e9395545900ca2d5603cc78df844a46b9cf56f4c3d274569400cbf0c994c4c41a58f90d";

  let ss1 = hexStringToUint8Array(s1);
  let ss2 = s2.map(hexStringToUint8Array);
  let ss3 = hexStringToUint8Array(s3);
  let ss4 = hexStringToUint8Array(s4);
  const result = await updateStateForCanister(actor, ss1, ss2, ss3, ss4);
  console.log("after :");
  console.log(result);
}

async function testSignMessages() {
  let messages =
    "0x040400e90142000000307864343335393363373135666464333163363131343161626430346139396664363832326338353538383534636364653339613536383465376135366461323764100000007975616e6368616f2e746573746e6574000064a7b3b6e00d000000000000000000000000000000000000000000000000";
  let encodedHeader =
    "0x7394643b4e84fc3eb1966186927d733c6c8abdf56f7a9559870195cf99ec99914c56ea0c9afde0c4de4f2f6e5d124ae00bfc17ea81ce3fb53dd3d7b7e7da27f23ffba85c38007a337cfc45ec6e04f7fd03b815c1663d8acf2efbd795e984859f8e100642414245b501010100000026deb110000000001086a298e70633418902e9dad1793b60d9bf7017615709b25205f1a1626b0f0358478a801133a5a0b441692a633dee432410bf00fe4a295613a6da4dff39ab05d64440558b0ef9dc33450f05bfe684a5481894572dff49dbbd74a7e11cb9850c0080811a05884851c1dbf833a1d67c29ab696ac92ebac1da7d9c34c106d28a949cfa04424545468403d09e2ef41b15439b071206ab9e4bbac0d9ea249e720c95980c9a7ab0f23420d10542414245010150e8fe7ac1aac1bb65ba97fdffddbb12f6c7fcc91e88212b6f4da34a5c3c913ce0935cb163d265f58c900204bc9c5070c383f589a8c3a3dd56a29b625d05de83";
  let encodedMmrLeaves =
    "0x0449010013000000a92138977c1d23f02f6b51df11f3e1a8b42a6d5800d24d01942e787904212e060100000000000000040000002145814fb41496b2881ca364a06e320fd1bf2fa7b94e1e37325cefbe2905651900";
  let encodedMmrProof =
    "0x041300000000000000190000000000000014ecbb56fad1763cfcf85065a1e7d3e640f25c24db82c9d547bba4f8a31813799bcb2e83f7faa8c4dff84c30a61f05b512663cd4abe3019573e10407246fd7ae21618b7c72796828a9c7012009eefafb59e5e9a6a96577c4a755fd43596da6685a733ed3db28efc5a12975bd882c308d430f975590cbc68cfcb415a0306c71c0185900ca2d5603cc78df844a46b9cf56f4c3d274569400cbf0c994c4c41a58f90d";

  let m = hexStringToUint8Array(messages);
  let h = hexStringToUint8Array(encodedHeader);
  let l = hexStringToUint8Array(encodedMmrLeaves);
  let p = hexStringToUint8Array(encodedMmrProof);
  const result = await signMessages(actor, m, h, l, p);
  console.log("after sign:");
  console.log(result);
}

function hexStringToUint8Array(hexString: string): Uint8Array {
  const buffer = Buffer.from(hexString.slice(2), "hex");
  return new Uint8Array(buffer);
}

main().catch(console.error);
