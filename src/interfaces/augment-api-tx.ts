// Auto-generated via `yarn polkadot-types-from-chain`, do not edit
/* eslint-disable */

import type { Bytes, Compact, Option, Vec, bool, u32, u64, u8 } from '@polkadot/types';
import type { AnyNumber } from '@polkadot/types/types';
import type { AssetBalanceOf, AssetIdOf } from './octopus';
import type { AssetDestroyWitness, TAssetBalance } from '@polkadot/types/interfaces/assets';
import type { BabeEquivocationProof, NextConfigDescriptor } from '@polkadot/types/interfaces/babe';
import type { Extrinsic, Signature } from '@polkadot/types/interfaces/extrinsics';
import type { GrandpaEquivocationProof, KeyOwnerProof } from '@polkadot/types/interfaces/grandpa';
import type { Heartbeat } from '@polkadot/types/interfaces/imOnline';
import type { AccountId, AssetId, Balance, BalanceOf, BlockNumber, Call, ChangesTrieConfiguration, Header, KeyValue, LookupSource, Moment, Perbill, Percent, Weight } from '@polkadot/types/interfaces/runtime';
import type { Keys } from '@polkadot/types/interfaces/session';
import type { EraIndex, RewardDestination, ValidatorPrefs } from '@polkadot/types/interfaces/staking';
import type { Key } from '@polkadot/types/interfaces/system';
import type { ApiTypes, SubmittableExtrinsic } from '@polkadot/api/types';

declare module '@polkadot/api/types/submittable' {
  export interface AugmentedSubmittables<ApiType> {
    octopusAppchain: {
      burn: AugmentedSubmittable<(assetId: AssetIdOf | AnyNumber | Uint8Array, receiverId: Bytes | string | Uint8Array, amount: AssetBalanceOf | AnyNumber | Uint8Array) => SubmittableExtrinsic<ApiType>, [AssetIdOf, Bytes, AssetBalanceOf]>;
      mint: AugmentedSubmittable<(assetId: AssetIdOf | AnyNumber | Uint8Array, senderId: Bytes | string | Uint8Array, receiver: LookupSource | { Id: any } | { Index: any } | { Raw: any } | { Address32: any } | { Address20: any } | string | Uint8Array, amount: AssetBalanceOf | AnyNumber | Uint8Array) => SubmittableExtrinsic<ApiType>, [AssetIdOf, Bytes, LookupSource, AssetBalanceOf]>;
      /**
       * Submit a new observation.
       * 
       * If the set already exists in the Observations, then the only thing
       * to do is vote for this set.
       **/
      // submitObservation: AugmentedSubmittable<(payload: ObservationPayload | null, signature: Signature | string | Uint8Array) => SubmittableExtrinsic<ApiType>, [ObservationPayload, Signature]>;
    };
    templateModule: {
      /**
       * An example dispatchable that may throw a custom error.
       **/
      causeError: AugmentedSubmittable<() => SubmittableExtrinsic<ApiType>, []>;
      /**
       * An example dispatchable that takes a singles value as a parameter, writes the value to
       * storage and emits an event. This function must be dispatched by a signed extrinsic.
       **/
      doSomething: AugmentedSubmittable<(something: u32 | AnyNumber | Uint8Array) => SubmittableExtrinsic<ApiType>, [u32]>;
    };
  }

  export interface SubmittableExtrinsics<ApiType extends ApiTypes> extends AugmentedSubmittables<ApiType> {
    (extrinsic: Call | Extrinsic | Uint8Array | string): SubmittableExtrinsic<ApiType>;
  }
}
