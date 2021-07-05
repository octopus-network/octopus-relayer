// Auto-generated via `yarn polkadot-types-from-defs`, do not edit
/* eslint-disable */

import type { Bytes, Enum, Struct, Vec, u128, u32 } from '@polkadot/types';
import type { AccountId } from '@polkadot/types/interfaces/runtime';

/** @name AssetBalanceOf */
export interface AssetBalanceOf extends u128 {}

/** @name AssetIdOf */
export interface AssetIdOf extends u32 {}

/** @name LockEvent */
export interface LockEvent extends Struct {
  readonly sequence_number: u32;
  readonly token_id: Bytes;
  readonly sender_id: Bytes;
  readonly receiver: AccountId;
  readonly amount: u128;
}

/** @name Observation */
export interface Observation extends Enum {
  readonly isUpdateValidatorSet: boolean;
  readonly asUpdateValidatorSet: ValidatorSet;
  readonly isLockToken: boolean;
  readonly asLockToken: LockEvent;
}

/** @name Validator */
export interface Validator extends Struct {
  readonly id: AccountId;
  readonly weight: u128;
}

/** @name ValidatorSet */
export interface ValidatorSet extends Struct {
  readonly sequence_number: u32;
  readonly set_id: u32;
  readonly validators: Vec<Validator>;
}

export type PHANTOM_OCTOPUS = 'octopus';
