console.log("Hello world!");

import { ApiPromise, WsProvider } from "@polkadot/api";
import { publishMessage } from "./pubsub";

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

  const [finalizedHead, validatorSetId, authorities, nextAuthorities] =
    await Promise.all([
      api.rpc.beefy.getFinalizedHead(),
      api.query.beefy.validatorSetId(),
      api.query.beefy.authorities(),
      api.query.beefy.nextAuthorities(),
    ]);
  console.log(
    `current finalizedHead: ${finalizedHead}, validatorSetId: ${validatorSetId}, authorities: ${authorities}`
  );
  console.log(`nextAuthorities: ${nextAuthorities}`);

  let validatorSet = await api.call.beefyApi.validatorSet();
  console.log(`validatorSet: ${validatorSet}`);

  await api.rpc.beefy.subscribeJustifications(async (beefySignedCommitment) => {
    console.log(`beefySignedCommitment: ${beefySignedCommitment}`);
    let blockNumber = beefySignedCommitment.commitment.blockNumber;
    let leafIndex = Number(blockNumber) - 1;

    const hash = await api.rpc.chain.getBlockHash(blockNumber);
    console.log(`blockNumber: ${blockNumber} blockHash: ${hash}`);

    let proof = await api.rpc.mmr.generateProof(
      [leafIndex],
      blockNumber, // TODO
      hash
    );
    console.log(`proof: ${proof}`);

    let authoritySetProof = await api.call.beefyMmrApi.authoritySetProof();
    console.log(`authoritySetProof: ${authoritySetProof}`);
    await publishMessage(
      "projects/octopus-dev-309403/topics/test-appchain",
      "b"
    );
  });
}

main().then(() => console.log("completed"));
