import type { H256 } from "@polkadot/types/interfaces/runtime";
import { MerkleTree } from "merkletreejs";
import { keccak256AsU8a, ethereumEncode } from "@polkadot/util-crypto";
import { u8aToU8a } from "@polkadot/util";
import { TypeRegistry, createType } from "@polkadot/types";

const registry = new TypeRegistry();

export interface MerkleProof {
  readonly root: H256;
  readonly proof: H256[];
  readonly number_of_leaves: number;
  readonly leaf_index: number;
  readonly leaf: string;
}

export function merkleProof(authorities: string[]) {
  const addresses = authorities.map((pk: string) => ethereumEncode(pk));
  console.log("addresses", addresses);

  const leaves = addresses.map((address: string) => keccak256AsU8a(address));
  const tree = new MerkleTree(leaves, keccak256AsU8a);

  const root: H256 = createType(registry, "H256", u8aToU8a(tree.getRoot()));

  const merkleProof = leaves.map((leaf: any, index: number) => {
    const hexProof: string[] = tree.getHexProof(leaf);
    const proof: H256[] = hexProof.map((hash) =>
      createType(registry, "H256", u8aToU8a(hash))
    );
    const mp: MerkleProof = {
      root: root,
      proof: proof,
      number_of_leaves: leaves.length,
      leaf_index: index,
      leaf: addresses[index],
    };
    return mp;
  });
  return merkleProof;
}
