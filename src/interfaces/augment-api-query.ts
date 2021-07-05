// Auto-generated via `yarn polkadot-types-from-chain`, do not edit
/* eslint-disable */

import type { Bytes, Option, Vec, bool, u32, u64 } from '@polkadot/types';
import type { AnyNumber, ITuple, Observable } from '@polkadot/types/types';
import type { AssetIdOf, Observation, Validator, ValidatorSet } from './octopus';
import type { AssetApproval, AssetBalance, AssetDetails, AssetMetadata } from '@polkadot/types/interfaces/assets';
import type { UncleEntryItem } from '@polkadot/types/interfaces/authorship';
import type { BabeAuthorityWeight, BabeEpochConfiguration, MaybeRandomness, NextConfigDescriptor, Randomness } from '@polkadot/types/interfaces/babe';
import type { AccountData, BalanceLock, ReserveData } from '@polkadot/types/interfaces/balances';
import type { BeefyId, ValidatorSetId } from '@polkadot/types/interfaces/beefy';
import type { AuthorityId } from '@polkadot/types/interfaces/consensus';
import type { SetId, StoredPendingChange, StoredState } from '@polkadot/types/interfaces/grandpa';
import type { AuthIndex } from '@polkadot/types/interfaces/imOnline';
import type { AccountId, AssetId, Balance, BalanceOf, BlockNumber, Hash, KeyTypeId, Moment, Perbill, Releases, Slot, ValidatorId } from '@polkadot/types/interfaces/runtime';
import type { Keys, SessionIndex } from '@polkadot/types/interfaces/session';
import type { ActiveEraInfo, EraIndex, EraRewardPoints, Exposure, Forcing, Nominations, RewardDestination, SlashingSpans, SpanIndex, SpanRecord, StakingLedger, UnappliedSlash, ValidatorPrefs } from '@polkadot/types/interfaces/staking';
import type { AccountInfo, ConsumedWeight, DigestOf, EventIndex, EventRecord, LastRuntimeUpgradeInfo, Phase } from '@polkadot/types/interfaces/system';
import type { Multiplier } from '@polkadot/types/interfaces/txpayment';
import type { ApiTypes } from '@polkadot/api/types';

declare module '@polkadot/api/types/storage' {
  export interface AugmentedQueries<ApiType> {
    beefy: {
      /**
       * The current authorities set
       **/
      authorities: AugmentedQuery<ApiType, () => Observable<Vec<BeefyId>>, []>;
      /**
       * Authorities set scheduled to be used with the next session
       **/
      nextAuthorities: AugmentedQuery<ApiType, () => Observable<Vec<BeefyId>>, []>;
      /**
       * The current validator set id
       **/
      validatorSetId: AugmentedQuery<ApiType, () => Observable<ValidatorSetId>, []>;
    };
    octopusAppchain: {
      appchainId: AugmentedQuery<ApiType, () => Observable<Bytes>, []>;
      assetIdByName: AugmentedQuery<ApiType, (arg: Bytes | string | Uint8Array) => Observable<AssetIdOf>, [Bytes]>;
      /**
       * The current set of validators of this appchain.
       **/
      currentValidatorSet: AugmentedQuery<ApiType, () => Observable<Option<ValidatorSet>>, []>;
      // messageQueue: AugmentedQuery<ApiType, () => Observable<Vec<Message>>, []>;
      nextFactSequence: AugmentedQuery<ApiType, () => Observable<u64>, []>;
      nextValidatorSet: AugmentedQuery<ApiType, () => Observable<Option<ValidatorSet>>, []>;
      nonce: AugmentedQuery<ApiType, () => Observable<u64>, []>;
      observations: AugmentedQuery<ApiType, (arg: u32 | AnyNumber | Uint8Array) => Observable<Vec<Observation>>, [u32]>;
      observing: AugmentedQuery<ApiType, (arg: Observation | { UpdateValidatorSet: any } | { LockToken: any } | string | Uint8Array) => Observable<Vec<Validator>>, [Observation]>;
    };
    templateModule: {
      something: AugmentedQuery<ApiType, () => Observable<Option<u32>>, []>;
    };
  }

  export interface QueryableStorage<ApiType extends ApiTypes> extends AugmentedQueries<ApiType> {
  }
}
