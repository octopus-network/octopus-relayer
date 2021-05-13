use beefy_light_client::{validator_set, Commitment, Payload, SignedCommitment};

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
    println!("result: {:?}", result);
}
