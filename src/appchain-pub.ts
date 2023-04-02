import { ApiPromise, WsProvider } from "@polkadot/api";
import { publishMessage, synchronousPull } from "./pubsub";

import { merkleProof } from "./merkletree";

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

async function main() {
  const wsProvider = new WsProvider("ws://127.0.0.1:9944");
  const api = await ApiPromise.create({
    provider: wsProvider,
    types: {
      BeefySignedCommitment: {
        version: "u8",
        commitment: "BeefyCommitment",
        signatures: "Vec<Option<EcdsaSignature>>",
      },
      MerkleProof: {
        root: "H256",
        proof: "Vec<H256>",
        number_of_leaves: "u64",
        leaf_index: "u64",
        leaf: "Bytes",
      },
    },
  });

  const finalizedHead = await api.rpc.beefy.getFinalizedHead();
  console.log(`appchain publisher started at ${finalizedHead}.`);

  await Promise.all([handleVersionedFinalityProof(api), handleMessage(api)]);
}

async function handleVersionedFinalityProof(api: ApiPromise) {
  console.log("in handleVersionedFinalityProof");
  await api.rpc.beefy.subscribeJustifications(async (beefySignedCommitment) => {
    console.log(`beefySignedCommitment: ${beefySignedCommitment}`);
    const blockNumber = beefySignedCommitment.commitment.blockNumber;
    const leafIndex = Number(blockNumber) - 1;

    const hash = await api.rpc.chain.getBlockHash(blockNumber);
    console.log(`blockNumber: ${blockNumber} blockHash: ${hash}`);
    const apiAt = await api.at(hash);

    const [
      validatorSetId,
      authorities,
      nextAuthorities,
      authoritySetRoot,
      validatorSet,
    ] = await Promise.all([
      apiAt.query.beefy.validatorSetId(),
      apiAt.query.beefy.authorities(),
      apiAt.query.beefy.nextAuthorities(),
      apiAt.call.beefyMmrApi.authoritySetProof(),
      apiAt.call.beefyApi.validatorSet(),
    ]);
    console.log(
      `current validatorSetId: ${validatorSetId}, authorities: ${authorities}`
    );
    console.log(`authoritySetRoot: ${authoritySetRoot}`);
    console.log(`nextAuthorities: ${nextAuthorities}`);
    console.log(`validatorSet: ${validatorSet}`);

    const authoritySetProof = merkleProof(
      api,
      authorities.toJSON() as string[]
    );

    const mmrProof = await api.rpc.mmr.generateProof(
      [leafIndex],
      blockNumber, // TODO
      hash
    );
    console.log(`mmrProof: ${mmrProof}`);

    if (JSON.stringify(authorities) !== JSON.stringify(nextAuthorities)) {
      // TODO
    }

    const messageProofs = await synchronousPull(
      api,
      projectId,
      subscriptionUnsignedMessage,
      Number(blockNumber),
      hash
    );

    // for testing
    console.log(`hex beefySignedCommitment: ${beefySignedCommitment.toHex()}`);
    for (const p of authoritySetProof) {
      console.log(`hex authoritySetProof: ${p.toHex()}`);
    }
    console.log(`hex mmrProof: ${mmrProof.toHex()}`);
    for (const p of messageProofs ?? []) {
      console.log(`hex MmrLeafBatchProof: ${p.proof.toHex()}`);
    }

    await publishMessage(
      topicVersionedFinalityProof,
      JSON.stringify({
        beefySignedCommitment: beefySignedCommitment,
        authoritySetProof: authoritySetProof,
        mmrProof: mmrProof,
        messageProofs: messageProofs,
      })
    );
  });
}

async function handleMessage(api: ApiPromise) {
  console.log("in handleMessage");
  const unsubscribe = await api.rpc.chain.subscribeFinalizedHeads((header) => {
    header.digest.logs.forEach(async (log) => {
      if (log.isOther) {
        const commitmentHash = log.asOther.toString();
        const crossChainMessages = await api.rpc.offchain.localStorageGet(
          "PERSISTENT",
          commitmentHash
        );
        console.log(`commitmentHash: ${commitmentHash}`);
        console.log(`crossChainMessages: ${crossChainMessages}`);
        console.log(`header: ${header.toHex()}`);
        await publishMessage(
          topicUnsignedMessage,
          JSON.stringify({
            blockNumber: header.number.toNumber(),
            commitmentHash: commitmentHash,
            crossChainMessages: crossChainMessages,
            header: header.toHex(),
          })
        );
        await publishMessage(
          topicMessage,
          JSON.stringify({
            blockNumber: header.number.toNumber(),
            commitmentHash: commitmentHash,
            crossChainMessages: crossChainMessages,
          })
        );
      }
    });
  });
}

main().catch(console.error);
