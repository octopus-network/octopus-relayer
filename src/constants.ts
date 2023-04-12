import * as dotenv from "dotenv";

dotenv.config();

const {
    PROJECTID,
    SUB_VFP,
    SUB_MSG,
    SUB_SIGNED_MSG,
    SUB_UNSIGNED_MSG,
    TOPIC_VFP,
    TOPIC_MSG,
    TOPIC_SIGNED_MSG,
    TOPIC_UNSIGNED_MSG,
    NEAR_SETTINGS,
    CONTRACTS,
    APPCHAIN_SETTINGS,
    RELAYER_NEAR_ACCOUNT,
    APPCHAIN_ID,
} = process.env

if (
    !PROJECTID ||
    !SUB_VFP ||
    !SUB_MSG ||
    !SUB_SIGNED_MSG ||
    !SUB_UNSIGNED_MSG ||
    !TOPIC_VFP ||
    !TOPIC_MSG ||
    !TOPIC_SIGNED_MSG ||
    !TOPIC_UNSIGNED_MSG ||
    !NEAR_SETTINGS ||
    !CONTRACTS ||
    !APPCHAIN_SETTINGS ||
    !RELAYER_NEAR_ACCOUNT
) {
    console.log('[EXIT] Missing parameters!')
    process.exit(0)
}

const PROJECTS = `projects/${PROJECTID}`;
const appchainSettings = JSON.parse(APPCHAIN_SETTINGS);

export const projectId = PROJECTID;
export const topicVersionedFinalityProof = `${PROJECTS}${TOPIC_VFP}`;
console.log('topicVersionedFinalityProof', topicVersionedFinalityProof);
export const topicMessage = `${PROJECTS}${TOPIC_MSG}`;
export const topicSignedMessage = `${PROJECTS}${TOPIC_SIGNED_MSG}`;
export const topicUnsignedMessage = `${PROJECTS}${TOPIC_UNSIGNED_MSG}`;
export const subscriptionVersionedFinalityProof = `${PROJECTS}${SUB_VFP}`;
export const subscriptionMessage = `${PROJECTS}${SUB_MSG}`;
export const subscriptionSignedMessage = `${PROJECTS}${SUB_SIGNED_MSG}`;
export const subscriptionUnsignedMessage = `${PROJECTS}${SUB_UNSIGNED_MSG}`;

export const nearSettings = JSON.parse(NEAR_SETTINGS)
export const contracts = JSON.parse(CONTRACTS)
export const appchainSetting = appchainSettings[APPCHAIN_ID as string];
console.log('appchainSetting', appchainSetting);
export const relayerNearAccount = JSON.parse(RELAYER_NEAR_ACCOUNT)

// TODO: support multiple appchains
export const initial_public_keys = [
    "0x0329a845da6531bc089b0e92baa52fa976dcd496337f25b03924898ffb6bcbe604",
    "0x0338a1d90b056fd6290fa080f296277b128ab0c002efe88802665cf74d15865745",
    "0x0320a6555b0846cdf352b4abb5dec4879c4d2379630213908603b758a88d5ef9f8",
    "0x025ac06ac3658a0ec3c82599a98435293139c294fae3476ea01dccef8efe77a9b0",
];