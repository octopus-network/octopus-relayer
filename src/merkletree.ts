import type { H256 } from "@polkadot/types/interfaces/runtime";
import { MerkleTree } from "merkletreejs";
import { keccak256AsU8a, ethereumEncode } from "@polkadot/util-crypto";
import { u8aToU8a } from "@polkadot/util";
import { ApiPromise } from "@polkadot/api";

export function merkleProof(api: ApiPromise, authorities: string[]) {
  const leaves = authorities.map((pk: string) => ethereumEncode(pk));
  console.log("leaves", leaves);
  let options = {
    hashLeaves: true,
    sortPairs: true,
  };
  const tree = new MerkleTree(leaves, keccak256AsU8a, options);
  const root: H256 = api.createType("H256", u8aToU8a(tree.getRoot()));
  const merkleProof = leaves.map((leaf: string, index: number) => {
    const hexProof: string[] = tree.getHexProof(
      Buffer.from(keccak256AsU8a(leaf))
    );
    const proof: H256[] = hexProof.map((hash) =>
      api.createType("H256", u8aToU8a(hash))
    );
    const mp = api.createType("MerkleProof", {
      root: root,
      proof: proof,
      number_of_leaves: leaves.length,
      leaf_index: index,
      leaf: leaves[index],
    });
    console.log(`authoritySetProof: ${mp}`);
    return mp;
  });
  return merkleProof;
}
