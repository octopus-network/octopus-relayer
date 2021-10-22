// Auto-generated via `yarn polkadot-types-from-defs`, do not edit
/* eslint-disable */

export default {
  BeefyKey: "[u8; 33]",
  SessionKeys5B: "(AccountId, AccountId, AccountId, AccountId, BeefyKey)",
  Validator: {
    id: "AccountId",
    weight: "u128",
  },
  ValidatorSet: {
    sequence_number: "u32",
    set_id: "u32",
    validators: "Vec<Validator>",
  },
  BurnEvent: {
    sequence_number: "u32",
    sender_id: "Vec<u8>",
    receiver: "AccountId",
    amount: "u128",
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
      UpdateValidatorSet: "(ValidatorSet<AccountId>)",
      Burn: "(BurnEvent<AccountId>)",
      LockAsset: "(LockEvent<AccountId>)",
    },
  },
  ObservationsPayload: {
    public: "[u8; 33]",
    block_number: "BlockNumber",
    next_fact_sequence: "u32",
    observations: "Vec<Observation<AccountId>>",
  },
  Message: {
    nonce: "u64",
    payload_type: "PayloadType",
    payload: "Vec<u8>",
  },
  PayloadType: {
    _enum: {
      Lock: "(Lock)",
      BurnAsset: "(BurnAsset)",
      PlanNewEra: "(PlanNewEra)",
      EraPayout: "(EraPayout)",
    },
  },
};
