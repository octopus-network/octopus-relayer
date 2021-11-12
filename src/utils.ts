import { TypeRegistry, createType } from "@polkadot/types";

export function decodeData(type: any, data: any): any {
  const registry = new TypeRegistry();
  registry.register(type);
  return createType(registry, Object.keys(type)[0], data);
}
