// Auto-generated via `yarn polkadot-types-from-chain`, do not edit
/* eslint-disable */

import type { Bytes, Vec, bool, u32, u8 } from '@polkadot/types';
import type { AssetBalanceOf, AssetIdOf, ValidatorSet } from './octopus';
import type { TAssetBalance } from '@polkadot/types/interfaces/assets';
import type { BalanceStatus } from '@polkadot/types/interfaces/balances';
import type { AuthorityId } from '@polkadot/types/interfaces/consensus';
import type { AuthorityList } from '@polkadot/types/interfaces/grandpa';
import type { AccountId, AssetId, Balance, Hash } from '@polkadot/types/interfaces/runtime';
import type { IdentificationTuple, SessionIndex } from '@polkadot/types/interfaces/session';
import type { EraIndex } from '@polkadot/types/interfaces/staking';
import type { DispatchError, DispatchInfo, DispatchResult } from '@polkadot/types/interfaces/system';
import type { ApiTypes } from '@polkadot/api/types';

declare module '@polkadot/api/types/events' {
  export interface AugmentedEvents<ApiType> {
    octopusAppchain: {
      Burned: AugmentedEvent<ApiType, [AssetIdOf, AccountId, Bytes, AssetBalanceOf]>;
      Minted: AugmentedEvent<ApiType, [AssetIdOf, Bytes, AccountId, AssetBalanceOf]>;
      /**
       * Event generated when a new voter votes on a validator set.
       * \[validator_set, voter\]
       **/
      NewVoterFor: AugmentedEvent<ApiType, [ValidatorSet, AccountId]>;
    };
    templateModule: {
      /**
       * Event documentation should end with an array that provides descriptive names for event
       * parameters. [something, who]
       **/
      SomethingStored: AugmentedEvent<ApiType, [u32, AccountId]>;
    };
  }

  export interface DecoratedEvents<ApiType extends ApiTypes> extends AugmentedEvents<ApiType> {
  }
}
