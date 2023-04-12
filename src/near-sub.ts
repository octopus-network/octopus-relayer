import { v1 } from "@google-cloud/pubsub";
import BN from "bn.js";

import { connect, keyStores, utils, Account } from "near-api-js";

import {
  nearSettings,
  appchainSetting,
  contracts,
  relayerNearAccount,
  projectId,
  subscriptionSignedMessage,
  subscriptionMessage,
} from "./constants";

let account: Account;
const { registryContract } = contracts;
const CONTRACT_NAME = `${appchainSetting.appchainId}.${registryContract}`;
const DEFAULT_FUNCTION_CALL_GAS = new BN("300000000000000");

async function initNearAccount() {
  const { nearEnv, nearNodeUrl, walletUrl, helperUrl } = nearSettings;
  const { id: relayerId, privateKey } = relayerNearAccount;

  const keyPair = utils.KeyPair.fromString(privateKey as string);

  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey(nearEnv, relayerId, keyPair);

  const near = await connect({
    networkId: nearEnv,
    keyStore,
    nodeUrl: nearNodeUrl as string,
    walletUrl,
    helperUrl,
  });
  account = await near.account(relayerId);
  return account;
}

interface MessageWithSignature {
  encoded_messages: number[];
  verification_proxy_signature: number[] | null;
}

async function main() {
  const isWitnessMode = await checkAnchorIsWitnessMode();
  if (isWitnessMode) {
    console.log("Witness mode!");
    await handleMessage();
  } else {
    console.log("Not witness mode!");
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
  account = await initNearAccount();
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

      let args = parseFunction(`${message.message?.data}`);
      console.log("args: ", args);

      try {
        const result = await account.functionCall({
          contractId: CONTRACT_NAME,
          methodName: "stage_and_apply_appchain_messages",
          args: args,
          gas: DEFAULT_FUNCTION_CALL_GAS,
          attachedDeposit: new BN("0"),
        });
        console.log("functionCall result:", result);
      } catch (e: any) {
        console.error("Call near function error", e);
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

async function checkAnchorIsWitnessMode(): Promise<Boolean> {
  try {
    account = await initNearAccount();
    const anchorSettings = await account.viewFunction(
      CONTRACT_NAME,
      "get_anchor_settings",
      {}
    );

    console.log("setting: ", anchorSettings);
    return anchorSettings ? anchorSettings.witness_mode : false;
  } catch (error) {
    console.error("checkAnchorIsWitnessMode error", error);
    return false;
  }
}

function parseSignedMessage(text: any): MessageWithSignature {
  const obj = JSON.parse(text);
  // console.log("encoded_messages: ", obj.encodedMessages);
  // console.log("signature: ", obj.verificationProxySignature);
  let messageWithSignature: MessageWithSignature = {
    encoded_messages: Object.values(obj.encodedMessages),
    verification_proxy_signature: Object.values(obj.verificationProxySignature),
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
