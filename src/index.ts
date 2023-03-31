import { ApiPromise, WsProvider } from "@polkadot/api";
import { publishMessage } from "./pubsub";

import { merkleProof } from "./merkletree";

const topicNameOrId = "projects/octopus-dev-309403/topics/test-appchain";

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
    },
  });

  const finalizedHead = await api.rpc.beefy.getFinalizedHead();
  console.log(`appchain publisher started at ${finalizedHead}.`);

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

    const authoritySetProof = merkleProof(authorities.toJSON() as string[]);
    console.log(`authoritySetProof: ${JSON.stringify(authoritySetProof)}`);

    const mmrProof = await api.rpc.mmr.generateProof(
      [leafIndex],
      blockNumber, // TODO
      hash
    );
    console.log(`mmrProof: ${mmrProof}`);

    if (JSON.stringify(authorities) !== JSON.stringify(nextAuthorities)) {
      // TODO
    }
    await publishMessage(
      topicNameOrId,
      JSON.stringify({
        beefySignedCommitment: beefySignedCommitment,
        authoritySetProof: authoritySetProof,
        mmrProof: mmrProof,
      })
    );
  });
}

main().then(() => console.log("completed"));
