const {
  NEAR_SETTINGS,
  CONTRACTS,
  APPCHAIN_SETTINGS,
  RELAYER_NEAR_ACCOUNT,

  APPCHAIN_ID,
  START_BLOCK_HEIGHT,
  UPDATE_STATE_MIN_INTERVAL,
} = process.env;

console.log("NEAR_SETTINGS", NEAR_SETTINGS);
console.log("CONTRACTS", CONTRACTS);
console.log("APPCHAIN_SETTINGS", APPCHAIN_SETTINGS);
console.log("RELAYER_NEAR_ACCOUNT", RELAYER_NEAR_ACCOUNT);

console.log("APPCHAIN_ID", APPCHAIN_ID);
console.log("START_BLOCK_HEIGHT", START_BLOCK_HEIGHT);
console.log("UPDATE_STATE_MIN_INTERVAL", UPDATE_STATE_MIN_INTERVAL);

if (
  !NEAR_SETTINGS ||
  !CONTRACTS ||
  !APPCHAIN_SETTINGS ||
  !RELAYER_NEAR_ACCOUNT ||
  !START_BLOCK_HEIGHT ||
  !UPDATE_STATE_MIN_INTERVAL
) {
  console.log("[EXIT] Missing parameters!");
  process.exit(0);
}

export const nearSettings = JSON.parse(NEAR_SETTINGS);
export const contracts = JSON.parse(CONTRACTS);
const appchainSettings = JSON.parse(APPCHAIN_SETTINGS);
export const appchainSetting = appchainSettings[APPCHAIN_ID as string]
console.log("appchainSetting", appchainSetting)
export const relayerNearAccount = JSON.parse(RELAYER_NEAR_ACCOUNT);


export const updateStateMinInterval = UPDATE_STATE_MIN_INTERVAL
  ? Number(UPDATE_STATE_MIN_INTERVAL)
  : 0.1;
