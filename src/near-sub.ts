import { v1 } from "@google-cloud/pubsub";
import BN from "bn.js";

const { connect, keyStores } = require("near-api-js");
const path = require("path");
const homedir = require("os").homedir();

const CREDENTIALS_DIR = ".near-credentials";
// const CONTRACT_NAME = "barnacle-latest.registry.test_oct.testnet";
const CONTRACT_NAME = "andy-test-relayer.registry.test_oct.testnet";
// const ACCOUNT_ID = "test-relayer.testnet";
const ACCOUNT_ID = "oct-pallet-test.testnet";
const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);
const DEFAULT_FUNCTION_CALL_GAS = new BN("300000000000000");

const config = {
  keyStore,
  networkId: "testnet",
  // nodeUrl: "https://rpc.testnet.near.org",
  nodeUrl: "https://near-testnet.infura.io/v3/dabe9e95376540b083ae09909ea7c576",
};

const projectId = "octopus-dev-309403";
const topicVersionedFinalityProof =
  "projects/octopus-dev-309403/topics/test-appchain-versioned-finality-proof";
const topicMessage = "projects/octopus-dev-309403/topics/test-appchain-message";
const topicSignedMessage =
  "projects/octopus-dev-309403/topics/test-appchain-signed-message";
const topicUnsignedMessage =
  "projects/octopus-dev-309403/topics/test-appchain-unsigned-message";
const subscriptionMessage =
  "projects/octopus-dev-309403/subscriptions/test-appchain-message-sub";
const subscriptionSignedMessage =
  "projects/octopus-dev-309403/subscriptions/test-appchain-signed-message-sub";
const subscriptionUnsignedMessage =
  "projects/octopus-dev-309403/subscriptions/test-appchain-unsigned-message-sub";

interface MessageWithSignature {
  encoded_messages: number[];
  verification_proxy_signature: number[] | null;
}

async function main() {
  const isWitnessMode = await checkAnchorIsWitnessMode();
  if (isWitnessMode) {
    await handleMessage();
  } else {
    await handleVersionedFinalityProof();
  }
}

async function handleVersionedFinalityProof() {
  await synchronousPull(
    parseSignedMessage,
    projectId,
    subscriptionSignedMessage
  );
}

async function handleMessage() {
  await synchronousPull(parseUnsignedMessage, projectId, subscriptionMessage);
}

// Creates a client; cache this for further use.
const subClient = new v1.SubscriberClient();

export async function synchronousPull(
  parseFunction: (text: String) => MessageWithSignature,
  projectId: string,
  subscriptionNameOrId: string
) {
  const near = await connect({ ...config, keyStore });
  const account = await near.account(ACCOUNT_ID);
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
  for (const message of response.receivedMessages ?? []) {
    console.log(`Received message: ${message.message?.data}`);

    let args = parseFunction(`${message.message?.data}`);
    console.log(`args: ${args}`);

    const result = await account.functionCall({
      contractId: CONTRACT_NAME,
      methodName: "stage_and_apply_appchain_messages",
      args: args,
      gas: DEFAULT_FUNCTION_CALL_GAS,
      attachedDeposit: new BN("0"),
    });
    console.log(`functionCall result: ${result}`);

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

async function checkAnchorIsWitnessMode(): Promise<Boolean> {
  try {
    const near = await connect({ ...config, keyStore });
    const account = await near.account(ACCOUNT_ID);
    const anchorSettings = await account.viewFunction(
      CONTRACT_NAME,
      "get_anchor_settings",
      {}
    );

    // const contract = await near.Contract(account, CONTRACT_NAME, {
    //   viewMethods: ["get_anchor_settings"],
    //   changeMethods: [],
    //   sender: account.accountId,
    // });

    console.log("setting: ", anchorSettings);
    return anchorSettings ? anchorSettings.witness_mode : false;
  } catch (error) {
    console.error("checkAnchorIsWitnessMode error", error);
    return false;
  }
}

function parseSignedMessage(text: any): MessageWithSignature {
  const obj = JSON.parse(text);
  let messageWithSignature: MessageWithSignature = {
    //TODO: Need check
    encoded_messages: Array.from(Buffer.from(obj.encoded_messages, "hex")),
    verification_proxy_signature: Array.from(
      Buffer.from(obj.verification_proxy_signature, "hex")
    ),
  };

  return messageWithSignature;
}

function parseUnsignedMessage(text: any): MessageWithSignature {
  const obj = JSON.parse(text);
  let messageWithSignature: MessageWithSignature = {
    encoded_messages: Array.from(
      Buffer.from(obj.crossChainMessages.slice(2), "hex")
    ),
    verification_proxy_signature: null,
  };
  return messageWithSignature;
}

main().catch(console.error);
