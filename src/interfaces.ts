import {
  Header,
  Event,
  Hash,
  Digest,
  BlockNumber,
} from "@polkadot/types/interfaces";
export interface Commitment {
  height: number;
  commitment: string;
}

export interface Proof {
  leaf_index: number;
  leaf_count: number;
  items: Number[];
}

export interface HeaderPartial {
  /// The parent hash.
  parent_hash: Hash;
  /// The block number.
  number: Number;
  /// The state trie merkle root
  state_root: Hash;
  /// The merkle root of the extrinsics.
  extrinsics_root: Hash;
  /// A chain-specific digest of data useful for light clients or referencing auxiliary data.
  digest: Digest;
}
