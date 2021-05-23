use crate::beefy::Beefy;
use beefy_primitives::ecdsa::AuthorityId as BeefyId;
use sp_runtime::{
    generic::Header,
    traits::{BlakeTwo256, IdentifyAccount, Verify},
    MultiSignature, OpaqueExtrinsic,
};
use substrate_subxt::{
    balances::{AccountData, Balances, BalancesEventTypeRegistry},
    contracts::{Contracts, ContractsEventTypeRegistry},
    extrinsic::DefaultExtra,
    register_default_type_sizes,
    session::{Session, SessionEventTypeRegistry},
    staking::{Staking, StakingEventTypeRegistry},
    sudo::{Sudo, SudoEventTypeRegistry},
    system::{System, SystemEventTypeRegistry},
    BasicSessionKeys, EventTypeRegistry, Runtime,
};

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct AppchainRuntime;

impl Staking for AppchainRuntime {}

impl Runtime for AppchainRuntime {
    type Signature = MultiSignature;
    type Extra = DefaultExtra<Self>;

    fn register_type_sizes(event_type_registry: &mut EventTypeRegistry<Self>) {
        event_type_registry.with_system();
        event_type_registry.with_balances();
        event_type_registry.with_session();
        event_type_registry.with_staking();
        event_type_registry.with_contracts();
        event_type_registry.with_sudo();
        event_type_registry.register_type_size::<pallet_octopus_appchain::ValidatorSet<<Self as System>::AccountId>>("ValidatorSet<AccountId>");
        register_default_type_sizes(event_type_registry);
    }
}

impl System for AppchainRuntime {
    type Index = u32;
    type BlockNumber = u32;
    type Hash = sp_core::H256;
    type Hashing = BlakeTwo256;
    type AccountId = <<MultiSignature as Verify>::Signer as IdentifyAccount>::AccountId;
    type Address = sp_runtime::MultiAddress<Self::AccountId, u32>;
    type Header = Header<Self::BlockNumber, BlakeTwo256>;
    type Extrinsic = OpaqueExtrinsic;
    type AccountData = AccountData<<Self as Balances>::Balance>;
}

impl Balances for AppchainRuntime {
    type Balance = u128;
}

impl Session for AppchainRuntime {
    type ValidatorId = <Self as System>::AccountId;
    type Keys = BasicSessionKeys;
}

impl Contracts for AppchainRuntime {}

impl Sudo for AppchainRuntime {}

impl Beefy for AppchainRuntime {
    type AuthorityId = BeefyId;
}
