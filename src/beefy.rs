use codec::Encode;
use core::marker::PhantomData;
use frame_support::Parameter;
use substrate_subxt::{module, system::System};
use substrate_subxt_proc_macro::Store;

use sp_runtime::traits::{MaybeSerializeDeserialize, Member};

#[module]
pub trait Beefy: System {
    type AuthorityId: Member + Parameter + Default + MaybeSerializeDeserialize;
}

#[derive(Clone, Debug, Eq, PartialEq, Store, Encode)]
pub struct AuthoritiesStore<T: Beefy> {
    #[store(returns = Vec<T::AuthorityId>)]
    /// Runtime marker.
    pub _runtime: PhantomData<T>,
}

#[derive(Clone, Debug, Eq, PartialEq, Store, Encode)]
pub struct ValidatorSetIdStore<T: Beefy> {
    #[store(returns = beefy_primitives::ValidatorSetId)]
    /// Runtime marker.
    pub _runtime: PhantomData<T>,
}
