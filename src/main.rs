use beefy_light_client::{validator_set, Commitment, Payload, SignedCommitment};
use beefy_primitives::ecdsa::AuthoritySignature as BeefySignature;
use borsh::{BorshDeserialize, BorshSerialize};
use codec::{Decode, Encode};
use sp_core::{offchain::StorageKind, Bytes, H256};
use sp_runtime::DigestItem;
use substrate_subxt::{system::System, BlockNumber, Client, ClientBuilder, EventSubscription};

mod beefy;
mod octopus;
mod runtime;
use beefy::{AuthoritiesStoreExt, ValidatorSetIdStoreExt};
use octopus::BurnedEvent;

#[derive(Encode, Decode, Debug)]
pub struct Message {
    nonce: u64,
    payload: Vec<u8>,
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct XTransferPayload {
    pub token_id: Vec<u8>,
    pub sender: Vec<u8>,
    pub receiver_id: Vec<u8>,
    pub amount: u128,
}

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
        let _ = subscribe_finalized_blocks(client1).await;
    });

    let task2 = tokio::spawn(async {
        let _ = run(client).await;
    });
    let _ = tokio::join!(task1, task2);
    Ok(())
}

async fn subscribe_finalized_blocks(
    client: Client<runtime::AppchainRuntime>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut blocks = client.subscribe_finalized_blocks().await?;
    while let Some(header) = blocks.next().await {
        println!("new finalized header {:?}", header);
        if let Some(commitment) = header.digest.log(DigestItem::as_other) {
            // identify it is a commitment
            println!("commitment: {:?}", hex::encode(commitment));
            let data = get_offchain_data_for_commitment(&client, commitment.to_vec())
                .await
                .unwrap()
                .unwrap();
            println!("data: {:?}", data);
            let messages: Vec<Message> = Decode::decode(&mut &*data).unwrap();
            println!("messages: {:?}", messages);
            for message in messages.iter() {
                let decoded_message = XTransferPayload::try_from_slice(&message.payload).unwrap();
                println!("decoded_message: {:?}", decoded_message);
            }
        }
    }
    Ok(())
}

async fn get_offchain_data_for_commitment(
    client: &Client<runtime::AppchainRuntime>,
    commitment: Vec<u8>,
) -> Result<Option<Bytes>, Box<dyn std::error::Error>> {
    let hash = H256::from_slice(&commitment[..]);
    let key = (b"commitment", hash).encode();
    let data = client
        .local_storage_get(StorageKind::PERSISTENT, key.into())
        .await?;
    Ok(data)
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
