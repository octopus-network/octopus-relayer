use beefy_light_client::{validator_set, Commitment, Payload, SignedCommitment};
use beefy_primitives::ecdsa::AuthoritySignature as BeefySignature;
use codec::Decode;
use substrate_subxt::{system::System, BlockNumber, Client, ClientBuilder, EventSubscription};

mod beefy;
mod octopus;
mod runtime;
use beefy::{AuthoritiesStoreExt, ValidatorSetIdStoreExt};
use octopus::BurnedEvent;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();

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

    let client = ClientBuilder::<runtime::AppchainRuntime>::new()
        .set_url("ws://127.0.0.1:9944")
        .build()
        .await?;

    let client1 = client.clone();
    let task1 = tokio::spawn(async move {
        let _ = subscribe_events(client1).await;
    });

    let task2 = tokio::spawn(async {
        let _ = run(client).await;
    });
    let _ = tokio::join!(task1, task2);
    Ok(())
}

async fn subscribe_events(
    client: Client<runtime::AppchainRuntime>,
) -> Result<(), Box<dyn std::error::Error>> {
    let sub = client.subscribe_events().await?;
    let decoder = client.events_decoder();
    let mut sub = EventSubscription::<runtime::AppchainRuntime>::new(sub, decoder);
    sub.filter_event::<BurnedEvent<_>>();
    while let Some(raw_event) = sub.next().await {
        if let Err(err) = raw_event {
            println!("raw_event error: {:?}", err);
            continue;
        }
        let raw_event = raw_event.unwrap();
        let event = BurnedEvent::<runtime::AppchainRuntime>::decode(&mut &raw_event.data[..]);
        if let Ok(e) = event {
            println!("Burned success: value: {:?}", e.amount);
        } else {
            println!("Failed to decode OctopusAppchain Event");
        }
    }
    Ok(())
}

async fn run(client: Client<runtime::AppchainRuntime>) -> Result<(), Box<dyn std::error::Error>> {
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
