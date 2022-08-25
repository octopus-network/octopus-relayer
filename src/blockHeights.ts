import { SYNCEDBLOCK } from "./interfaces";
import { dbAllAsync, upsertLastSyncedBlocks } from "./db";
const { START_BLOCK_HEIGHT } = process.env;
import { ApiPromise, WsProvider } from "@polkadot/api";

let latestFinalizedHeight = 0;

export async function updateSyncedBlock(height: number): Promise<any> {
  await upsertLastSyncedBlocks({ height, type: 1 });
}

export function getLatestFinalizedHeight() {
  return latestFinalizedHeight;
}

export async function syncFinalizedHeights(appchain: ApiPromise) {
  try {
    const latestFinalizedHead = await appchain.rpc.chain.getFinalizedHead();
    const latestFinalizedHeader = await appchain.rpc.chain.getHeader(latestFinalizedHead);
    latestFinalizedHeight = latestFinalizedHeader.number.toNumber();
  } catch (error) {
    console.log("syncFinalizedHeights error", error)
  }
  setTimeout(() => { syncFinalizedHeights(appchain) }, 6000);
}

export async function getNextHeight(): Promise<number> {
  const data: SYNCEDBLOCK[] = await dbAllAsync(
    "SELECT * FROM last_synced_blocks WHERE type == ?",
    [1]
  );
  if (data.length > 0) {
    const lastSyncedBlock = data[0];
    return lastSyncedBlock.height + 1;
  } else {
    return Number(START_BLOCK_HEIGHT) + 1;
  }
}
