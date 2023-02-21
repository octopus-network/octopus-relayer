import { TypeRegistry, createType } from "@polkadot/types";
import { DetectCodec } from "@polkadot/types/types";
import { WsProvider } from "@polkadot/api";
import { LRUCache } from '@polkadot/rpc-provider/lru';

export class WsProvider2 extends WsProvider {
  readonly #callCache = new LRUCache(1);
  getCallCache() {
    return this.#callCache;
  }
}

export function decodeData(type: any, data: any): DetectCodec<any, any> {
  const registry = new TypeRegistry();
  registry.register(type);
  return createType(registry, Object.keys(type)[0], data);
}

export function logJSON(desc: string, data: any): any {
  const dataFormatted =
    data !== null && typeof data === "object" ? JSON.stringify(data) : data;
  return console.log(desc, dataFormatted);
}

export function toNumArray(data: DetectCodec<any, any>): number[] {
  if (typeof data === "string") {
    return hexStringToNumArray(data);
  } else {
    return hexStringToNumArray(data.toString());
  }
}

function hexStringToNumArray(hex: string): number[] {
  const hexString = hex.slice(0, 2) === "0x" ? hex.slice(2) : hex;
  return Array.from(Buffer.from(hexString, "hex"));
}


export function decodeV1SignedCommitment(hashString: string) {
  const decodedSignedCommitment = decodeData(
    {
      BeefySignedCommitment: {
        commitment: "BeefyCommitment",
        signatures: "Vec<Signature>",
      },
      BeefyId: '[u8; 33]',
      BeefyCommitment: {
        payload: 'BeefyPayload',
        blockNumber: 'BlockNumber',
        validatorSetId: 'ValidatorSetId'
      },
      BeefyNextAuthoritySet: {
        id: 'u64',
        len: 'u32',
        root: 'H256'
      },
      Signature: "[u8; 65]",
      BeefyPayload: 'Vec<(BeefyPayloadId, Vec<u8>)>',
      MmrRootHash: 'H256',
      ValidatorSetId: 'u64',
      BeefyPayloadId: "[u8; 2]"
    }, "0x" + hashString.slice(4)
  );
  return decodedSignedCommitment;
}