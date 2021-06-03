use codec::Decode;
use substrate_subxt::{module, system::System};
use substrate_subxt_proc_macro::Event;

#[module]
pub trait OctopusAppchain: System {}

#[derive(Clone, Debug, Eq, PartialEq, Event, Decode)]
pub struct BurnedEvent<T: OctopusAppchain> {
    pub asset_id: u32, //AssetIdOf<T>,
    pub sender: <T as System>::AccountId,
    pub receiver_id: Vec<u8>,
    pub amount: u64, //AssetBalanceOf<T>,
}
