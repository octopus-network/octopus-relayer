import fetch from "isomorphic-fetch";
import {Actor, HttpAgent, Identity} from "@dfinity/agent";
import {Ed25519KeyIdentity} from "@dfinity/identity";
import {idlFactory} from "./factory/idl";
import {_SERVICE as Service} from "./factory/idl.d";
import {
  MessageProof,
} from './interfaces'


// // local
// const host = "http://127.0.0.1:4943";
// const canisterId = "t6rzw-2iaaa-aaaaa-aaama-cai";

// mainnet
const host = "https://ic0.app";    
const canisterId = "3udup-lqaaa-aaaan-qc5ua-cai";

const aliceIdentity = Ed25519KeyIdentity.generate();


const createActor = async (identity: Identity): Promise<Service> => {
  const agent = new HttpAgent({host, fetch, identity});

  const actor = Actor.createActor<Service>(idlFactory, {
    canisterId: canisterId,
    agent
  });

  // Fetch root key for certificate validation during development
  await agent.fetchRootKey().catch(err => {
    console.error("Unable to fetch root key. Check to ensure that your local replica is running");
    throw err;
  });

  return actor;
};

export async function newActor(): Promise<Service> {
    // It should be modified to read a real identity later.
    const aliceActor = await createActor(aliceIdentity);
    return aliceActor
}

export async function setIcpClient(actor: Service, chainId: string, initialPublicKeys: string []) {
    const ret = await actor.set_client(chainId, initialPublicKeys);
    console.log("after set client: ", ret);
}

export async function forceSetIcpClient(actor: Service, chainId: string, initialPublicKeys: string []) {
    const ret = await actor.force_set_client(chainId, initialPublicKeys);
    console.log("after force set client: ", ret);
}

export async function updateState(actor: Service, state: Uint8Array) {
    console.log("before update state, data: %o", state);
    const ret = await actor.update_state(state);
    console.log("after update state: ", ret);
}

export async function getPublicKey(actor: Service): Promise<number[]> {
    const result = await actor.public_key();
    console.log("public key: ", result);
    return (result as any).Ok.public_key;
}

export async function signMessages(actor: Service, swp: MessageProof): Promise<number[]> {
    const result = await actor.sign_messages(
      new Uint8Array(swp.encoded_messages), 
      new Uint8Array(swp.header), 
      new Uint8Array(swp.mmr_leaf), 
      new Uint8Array(swp.mmr_proof));

    console.log("signature is: ", result);
    return (result as any).Ok;
}