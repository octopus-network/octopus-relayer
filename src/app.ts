import { ApiPromise, WsProvider } from "@polkadot/api";
import { Header } from "@polkadot/types/interfaces";
import { connect, keyStores, utils, Account } from "near-api-js";
import BN from "bn.js";
import { decodeAddress, encodeAddress } from "@polkadot/keyring";

import types from "./types";
import { dbRunAsync, dbAllAsync, initDb } from "./db";
import { RawProof, Proof } from "./interfaces";

const relayId = 'dev-oct-relay.testnet';

const DEFAULT_GAS = new BN('300000000000000');
const MINIMUM_DEPOSIT = new BN('1250000000000000000000');

const {
  APPCHAIN_ID,
  APPCHAIN_TOKEN_ID,
  RELAYER_PRIVATE_KEY,
  APPCHAIN_ENDPOINT,
  NEAR_NODE_URL,
  NEAR_WALLET_URL,
  NEAR_HELPER_URL,
} = process.env;

console.log("APPCHAIN_ID", APPCHAIN_ID);
console.log("APPCHAIN_TOKEN_ID", APPCHAIN_TOKEN_ID);
console.log("RELAYER_PRIVATE_KEY", RELAYER_PRIVATE_KEY);
console.log("APPCHAIN_ENDPOINT", APPCHAIN_ENDPOINT);
console.log("NEAR_NODE_URL", NEAR_NODE_URL);
console.log("NEAR_WALLET_URL", NEAR_WALLET_URL);
console.log("NEAR_HELPER_URL", NEAR_HELPER_URL);

if (!APPCHAIN_ID || !APPCHAIN_TOKEN_ID || !RELAYER_PRIVATE_KEY || !APPCHAIN_ENDPOINT) {
  console.log("[EXIT] Missing parameters!");
  process.exit(0);
}

async function init() {
  initDb();
  const wsProvider = new WsProvider(APPCHAIN_ENDPOINT);
  const appchain = await ApiPromise.create({
    provider: wsProvider,
    types,
  });

  const keyPair = utils.KeyPair.fromString(RELAYER_PRIVATE_KEY as string);

  const keyStore = new keyStores.InMemoryKeyStore();
  keyStore.setKey("testnet", "test-relayer.testnet", keyPair);

  const near = await connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: NEAR_NODE_URL as string,
    walletUrl: NEAR_WALLET_URL,
    helperUrl: NEAR_HELPER_URL,
  });
  const account = await near.account("test-relayer.testnet");
  return { appchain, account };
}

async function unlockOnNear(
  assetId: string,
  account: Account,
  sender: string,
  receiver_id: string,
  amount: string
) {
  console.log('unlock on near:', assetId, sender, receiver_id, amount);
  
  const contractId = assetId ? relayId : APPCHAIN_TOKEN_ID as string;
  const methodName = assetId ? 'unlock_token' : 'mint';

  const args = assetId ? {
    appchain_id: APPCHAIN_ID,
    token_id: 'usdc.testnet',
    sender,
    receiver_id,
    amount: amount,
  } : {
    account_id: receiver_id,
    amount
  }
  
  const result = await account.functionCall({
    contractId,
    methodName,
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: MINIMUM_DEPOSIT,
  });

  console.log(result);
}

async function listenEvents(appchain: ApiPromise, account: Account) {
  appchain.query.system.events((events) => {
    // Loop through the Vec<EventRecord>
    events.forEach((record) => {
      // Extract the phase, event and the event types
      const { event, phase } = record;
      const types = event.typeDef;
      
      if (event.section == "octopusAppchain") {
        const { data } = event;
        if (event.method == "Burned") {
          const assetId = data[0].toString();
          const sender = Buffer.from(decodeAddress(data[1] as any)).toString(
            "hex"
          ) as string;
          const receiver_id = Buffer.from(data[2] as any, "hex").toString("utf8");
          const amount = data[3].toString();

          unlockOnNear(assetId, account, sender, receiver_id, amount);
        } else if (event.method == "Locked") {
          const sender = Buffer.from(decodeAddress(data[0] as any)).toString(
            "hex"
          ) as string;
          
          const receiver_id = Buffer.from(data[1] as any, "hex").toString("utf8");
          const amount = data[2].toString();

          unlockOnNear('', account, sender, receiver_id, amount);

        }
        
      }
    });
  });

  appchain.rpc.chain.subscribeFinalizedHeads(async (header) => {
    // console.log("new finalized header: " + header);

    // Find the commitment to store it.
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitment = log.asOther.toString();
        const data = await get_offchain_data_for_commitment(
          appchain,
          commitment
        );
        console.log("data", data);
        const messages = Buffer.from(data.toString().slice(2), "hex").toString(
          "ascii"
        );
        console.log("messages", messages);
        await pushProofQueue(
          header.number.toNumber(),
          JSON.stringify(header),
          data.toString()
        );
      }
    });

    // handle poofs
    const proofQueue = await getProofQueue();
    proofQueue.forEach((proof) => {
      if (header.number.toNumber() === proof.height + 1) {
        console.log("handle poof", proof);
        // let leaf_proof = get_leaf_poof(h.height);
        // let mmr_root = get_mmr_root(h.height);
        // send_unlock_tx(m, h, leaf_proof, mmr_root);
        removeProofQueue(proof.height);
      }
    });
  });
}

async function pushProofQueue(
  height: number,
  header: String,
  encoded_message: String
): Promise<any> {
  console.log("new proof height", height);
  return await dbRunAsync(
    "insert into proof_queue(height, header, encoded_message) values(?, ?, ?)",
    [height, header, encoded_message]
  );
}

async function getProofQueue(): Promise<Proof[]> {
  const rawQueue: RawProof[] = await dbAllAsync("select * from proof_queue");
  return rawQueue.map(({ height, header, encoded_message }) => ({
    height,
    header: JSON.parse(header),
    encoded_message,
  }));
}

async function removeProofQueue(height: number) {
  return await dbRunAsync(`delete from proof_queue where height = ${height}`);
}

async function get_offchain_data_for_commitment(
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

async function start() {
  const { appchain, account } = await init();
  listenEvents(appchain, account);
}

start().catch((error) => {
  console.error(error);
  process.exit(-1);
});
