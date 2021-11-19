import { TypeRegistry, createType } from "@polkadot/types";
import { DetectCodec } from "@polkadot/types/types";

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
  return Array.from(Buffer.from(data.toHex().slice(2), "hex"));
}
