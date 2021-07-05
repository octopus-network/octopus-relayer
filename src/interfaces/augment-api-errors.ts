// Auto-generated via `yarn polkadot-types-from-chain`, do not edit
/* eslint-disable */

import type { ApiTypes } from '@polkadot/api/types';

declare module '@polkadot/api/types/errors' {
  export interface AugmentedErrors<ApiType> {
    octopusAppchain: {
      /**
       * Next fact sequence overflow.
       **/
      NextFactSequenceOverflow: AugmentedError<ApiType>;
      /**
       * No CurrentValidatorSet.
       **/
      NoCurrentValidatorSet: AugmentedError<ApiType>;
      /**
       * Nonce overflow.
       **/
      NonceOverflow: AugmentedError<ApiType>;
      /**
       * Must be a validator.
       **/
      NotValidator: AugmentedError<ApiType>;
      /**
       * Wrong Asset Id.
       **/
      WrongAssetId: AugmentedError<ApiType>;
      /**
       * The set id of new validator set was wrong.
       **/
      WrongSetId: AugmentedError<ApiType>;
    };
    templateModule: {
      /**
       * Error names should be descriptive.
       **/
      NoneValue: AugmentedError<ApiType>;
      /**
       * Errors should have helpful documentation associated with them.
       **/
      StorageOverflow: AugmentedError<ApiType>;
    };
  }

  export interface DecoratedErrors<ApiType extends ApiTypes> extends AugmentedErrors<ApiType> {
  }
}
