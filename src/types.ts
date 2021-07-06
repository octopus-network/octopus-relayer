// Auto-generated via `yarn polkadot-types-from-defs`, do not edit
/* eslint-disable */

export default {
  Validator: {
    id: "AccountId",
    weight: "u128",
  },
  ValidatorSet: {
    sequence_number: "u32",
    set_id: "u32",
    validators: "Vec<Validator>",
  },
  LockEvent: {
    sequence_number: "u32",
    token_id: "Vec<u8>",
    sender_id: "Vec<u8>",
    receiver: "AccountId",
    amount: "u128",
  },
  AssetIdOf: "u32",
  AssetBalanceOf: "u128",
  TAssetBalance: "u128",
  Observation: {
    _enum: {
      UpdateValidatorSet: "(ValidatorSet)",
      LockToken: "(LockEvent)",
    },
  },
};