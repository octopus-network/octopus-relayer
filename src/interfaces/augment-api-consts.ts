// Auto-generated via `yarn polkadot-types-from-chain`, do not edit
/* eslint-disable */

import type { Vec, u16, u32, u64 } from '@polkadot/types';
import type { Balance, BalanceOf, BlockNumber, Moment, RuntimeDbWeight, TransactionPriority } from '@polkadot/types/interfaces/runtime';
import type { SessionIndex } from '@polkadot/types/interfaces/session';
import type { EraIndex } from '@polkadot/types/interfaces/staking';
import type { RuntimeVersion } from '@polkadot/types/interfaces/state';
import type { WeightToFeeCoefficient } from '@polkadot/types/interfaces/support';
import type { BlockLength, BlockWeights } from '@polkadot/types/interfaces/system';
import type { ApiTypes } from '@polkadot/api/types';

declare module '@polkadot/api/types/consts' {
  export interface AugmentedConsts<ApiType> {
    octopusAppchain: {
      /**
       * A grace period after we send transaction.
       * 
       * To avoid sending too many transactions, we only attempt to send one
       * every `GRACE_PERIOD` blocks. We use Local Storage to coordinate
       * sending between distinct runs of this offchain worker.
       **/
      gracePeriod: BlockNumber & AugmentedConst<ApiType>;
      /**
       * A configuration for base priority of unsigned transactions.
       * 
       * This is exposed so that it can be tuned for particular runtime, when
       * multiple pallets send unsigned transactions.
       **/
      unsignedPriority: TransactionPriority & AugmentedConst<ApiType>;
    };
  }

  export interface QueryableConsts<ApiType extends ApiTypes> extends AugmentedConsts<ApiType> {
  }
}
