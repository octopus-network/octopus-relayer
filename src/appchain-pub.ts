import { ApiPromise, WsProvider } from "@polkadot/api";
import colors from "colors";

import { publishMessage, synchronousPull } from "./pubsub";
import { merkleProof } from "./merkletree";

import { projectId, topicVersionedFinalityProof, topicMessage, topicUnsignedMessage, subscriptionUnsignedMessage, appchainSetting } from "./constants";

async function main() {
  const wsProvider = new WsProvider(appchainSetting.wsRpcEndpoint);
  const api = await ApiPromise.create({
    provider: wsProvider,
    types: {
      BeefySignedCommitment: {
        version: "u8",
        commitment: "BeefyCommitment",
        signatures_from: "Bytes",
        validator_set_len: "u32",
        signatures_compact: "Vec<EcdsaSignature>",
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
    console.log(`versionedFinalityProof: ${beefySignedCommitment}`);
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

    const leavesProof = await api.rpc.mmr.generateProof(
      [leafIndex],
      blockNumber, // TODO
      hash
    );
    console.log(colors.red(`leavesProof: ${leavesProof}`));

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
    console.log(
      colors.red(`versionedFinalityProof: ${beefySignedCommitment.toHex()}`)
    );

    let authoritySetProofs: any[] = [];
    authoritySetProofs = authoritySetProof.map((p) => {
      const hex = p.toHex();
      console.log(colors.red(`authoritySetProof: ${hex}`));
      return hex;
    });

    await publishMessage(
      topicVersionedFinalityProof,
      JSON.stringify({
        beefySignedCommitment: beefySignedCommitment.toHex(),
        authoritySetProof: authoritySetProofs,
        mmrLeaves: leavesProof.leaves,
        mmrProof: leavesProof.proof,
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
        console.log(colors.red(`crossChainMessages: ${crossChainMessages}`));
        console.log(colors.red(`header: ${header.toHex()}`));
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
