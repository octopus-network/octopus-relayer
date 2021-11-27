const {
  APPCHAIN_ID,
  ANCHOR_CONTRACT_ID,
  RELAYER_PRIVATE_KEY,
  APPCHAIN_ENDPOINT,
  START_BLOCK_HEIGHT,
  UPDATE_STATE_MIN_INTERVAL,
  NEAR_NODE_URL,
  NEAR_WALLET_URL,
  NEAR_HELPER_URL,
} = process.env;

console.log("APPCHAIN_ID", APPCHAIN_ID);
console.log("ANCHOR_CONTRACT_ID", ANCHOR_CONTRACT_ID);
console.log("RELAYER_PRIVATE_KEY", RELAYER_PRIVATE_KEY);
console.log("APPCHAIN_ENDPOINT", APPCHAIN_ENDPOINT);
console.log("START_BLOCK_HEIGHT", START_BLOCK_HEIGHT);
console.log("UPDATE_STATE_MIN_INTERVAL", UPDATE_STATE_MIN_INTERVAL);
console.log("NEAR_NODE_URL", NEAR_NODE_URL);
console.log("NEAR_WALLET_URL", NEAR_WALLET_URL);
console.log("NEAR_HELPER_URL", NEAR_HELPER_URL);

if (
  !APPCHAIN_ID ||
  !ANCHOR_CONTRACT_ID ||
  !RELAYER_PRIVATE_KEY ||
  !APPCHAIN_ENDPOINT ||
  !START_BLOCK_HEIGHT
) {
  console.log("[EXIT] Missing parameters!");
  process.exit(0);
}
export const appchainId = APPCHAIN_ID;
export const anchorContractId = ANCHOR_CONTRACT_ID;
export const relayerPrivateKey = RELAYER_PRIVATE_KEY;
export const appchainEndpoint = APPCHAIN_ENDPOINT;
export const updateStateMinInterval = UPDATE_STATE_MIN_INTERVAL
  ? Number(UPDATE_STATE_MIN_INTERVAL)
  : 0.1;
export const nearNodeUrl = NEAR_NODE_URL;
export const nearWalletUrl = NEAR_WALLET_URL;
export const nearHelperUrl = NEAR_HELPER_URL;
