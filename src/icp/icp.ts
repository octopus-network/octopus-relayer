import fetch from "isomorphic-fetch";
import { Actor, HttpAgent, Identity } from "@dfinity/agent";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { idlFactory } from "./idl";
import { _SERVICE as Service } from "./idl.d";

// // local
// const host = "http://127.0.0.1:4943";
// const canisterId = "wxns6-qiaaa-aaaaa-aaaqa-cai";

// mainnet
const host = "https://ic0.app";
const canisterId = "3udup-lqaaa-aaaan-qc5ua-cai";

const aliceIdentity = Ed25519KeyIdentity.generate();

const createActor = async (identity: Identity): Promise<Service> => {
  const agent = new HttpAgent({ host, fetch, identity });

  const actor = Actor.createActor<Service>(idlFactory, {
    canisterId: canisterId,
    agent,
  });

  // Fetch root key for certificate validation during development
  await agent.fetchRootKey().catch((err) => {
    console.error(
      "Unable to fetch root key. Check to ensure that your local replica is running"
    );
    throw err;
  });

  return actor;
};

export async function newActor(): Promise<Service> {
  // It should be modified to use a real identity later.
  const aliceActor = await createActor(aliceIdentity);
  return aliceActor;
}

export async function setIcpClient(
  actor: Service,
  chainId: string,
  initialPublicKeys: string[]
) {
  const ret = await actor.set_client(chainId, initialPublicKeys);
  console.log("after set client: ", ret);
}

export async function resetIcpClient(
  actor: Service,
  chainId: string,
  initialPublicKeys: string[]
) {
  const ret = await actor.reset_client(chainId, initialPublicKeys);
  console.log("after reset client: ", ret);
}

export async function updateState(
  actor: Service,
  versionedFinalityProof: Uint8Array,
  authoritySetProof: Array<Uint8Array>,
  mmrLeaves: Uint8Array,
  mmrProof: Uint8Array
): Promise<{ Ok: null } | { Err: string }> {
  console.log("before update state");
  const ret = await actor.update_state(
    versionedFinalityProof,
    authoritySetProof,
    mmrLeaves,
    mmrProof
  );
  console.log("after update state: ", ret);
  return ret;
}

export async function getPublicKey(actor: Service): Promise<number[]> {
  const result = await actor.public_key();
  console.log("public key: ", result);
  return (result as any).Ok.public_key;
}

export async function signMessages(
  actor: Service,
  messages: Uint8Array,
  header: Uint8Array,
  mmrLeaf: Uint8Array,
  mmrProof: Uint8Array
): Promise<number[]> {
  const result = await actor.sign_messages(messages, header, mmrLeaf, mmrProof);

  console.log("signature is: ", result);
  return (result as any).Ok;
}
