use beefy_light_client::{validator_set, Commitment, Payload, SignedCommitment};
use beefy_primitives::ecdsa::AuthoritySignature as BeefySignature;
use codec::Decode;
use substrate_subxt::{system::System, BlockNumber, ClientBuilder};

mod beefy;
mod runtime;
use beefy::{AuthoritiesStoreExt, ValidatorSetIdStoreExt};

fn main() {
    let mut lc = beefy_light_client::new();
    lc.import(SignedCommitment {
        commitment: Commitment {
            payload: Payload::new(1),
            block_number: 2,
            validator_set_id: 0,
        },
        signatures: vec![Some(validator_set::Signature::ValidFor(0.into()))],
    })
    .unwrap();

    let result = lc.verify_proof(beefy_light_client::merkle_tree::Proof::ValidFor(
        1.into(),
        (),
    ));
    println!("verify result: {:?}", result);
    let result = async_std::task::block_on(run());
    println!("result: {:?}", result);
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let client = ClientBuilder::<runtime::AppchainRuntime>::new()
        .set_url("ws://127.0.0.1:9944")
        .build()
        .await?;
    let mut commitments = client.subscribe_justifications().await?;
    while let Some(commitment) = commitments.next().await {
        let decoded: beefy_primitives::SignedCommitment<
            <runtime::AppchainRuntime as System>::BlockNumber,
            beefy_primitives::MmrRootHash,
            BeefySignature,
        > = Decode::decode(&mut &*commitment.0).unwrap();
        println!("commitment: {:?}", decoded);
        let set_id = client.validator_set_id(None).await.unwrap();
        println!("set_id: {:?}", set_id);
        let authorities = client.authorities(None).await.unwrap();
        println!("authorities: {:?}", authorities);
        let hash = client
            .block_hash(Some(BlockNumber::from(decoded.commitment.block_number)))
            .await
            .unwrap();
        let proof = client
            .generate_proof(decoded.commitment.block_number.into(), Some(hash.unwrap()))
            .await;
        println!("proof: {:?}", proof);
    }
    Ok(())
}
