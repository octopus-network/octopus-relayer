import {
  Header,
  Event,
  Hash,
  Digest,
  BlockNumber,
} from "@polkadot/types/interfaces";
import { DetectCodec } from "@polkadot/types/types";
export interface Commitment {
  height: number;
  commitment: string;
  tx_id?: string;
  need_completes?: string;
  status?: number;
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
  number: number;
  /// The state trie merkle root
  state_root: Hash;
  /// The merkle root of the extrinsics.
  extrinsics_root: Hash;
  /// A chain-specific digest of data useful for light clients or referencing auxiliary data.
  digest: Digest;
}

export interface SYNCEDBLOCK {
  height: number;
  type: number;
}

export interface MerkleProof {
  root: number[];
  proof: number[][];
  number_of_leaves: number;
  leaf_index: number;
  leaf: number[];
}

export interface MessageProof {
  messages: number[];
  header: number[];
  mmr_leaf: number[];
  mmr_proof: number[];
}

export interface LightClientState {
  signed_commitment: number[];
  validator_proofs: MerkleProof[];
  mmr_leaf: number[];
  mmr_proof: number[];
}
