import { connect, keyStores, utils, Account } from 'near-api-js'
import BN from 'bn.js'
import {
  LightClientState,
  MessageProof,
  MessageProofWithLightClientState,
} from './interfaces'

const DEFAULT_GAS = new BN('300000000000000')

import {
  nearSettings,
  appchainSetting,
  contracts,
  relayerNearAccount,
} from './constants'

let account: Account

const { registryContract } = contracts
const anchorContractId = `${appchainSetting.appchainId}.${registryContract}`

export async function initNearRpc() {
  const { nearEnv, nearNodeUrl, walletUrl, helperUrl } = nearSettings
  const { id: relayerId, privateKey } = relayerNearAccount

  const keyPair = utils.KeyPair.fromString(privateKey as string)

  const keyStore = new keyStores.InMemoryKeyStore()
  keyStore.setKey(nearEnv, relayerId, keyPair)

  const near = await connect({
    networkId: nearEnv,
    keyStore,
    nodeUrl: nearNodeUrl as string,
    walletUrl,
    helperUrl,
  })
  account = await near.account(relayerId)
  return account
}

export async function relayMessages(args: MessageProof) {
  console.log('relayMessages-----------------------')
  console.log('\x1b[34m%s\x1b[0m', JSON.stringify(args))
  console.log('------------------------------------')
  return await account.functionCall({
    contractId: anchorContractId as string,
    methodName: 'verify_and_stage_appchain_messages',
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN('0'),
  })
}

export async function relayMessagesWithAllProofs(
  args: MessageProofWithLightClientState
) {
  console.log('relayMessagesWithAllProofs-----------------------')
  console.log('\x1b[34m%s\x1b[0m', JSON.stringify(args))
  console.log('------------------------------------')
  return await account.functionCall({
    contractId: anchorContractId as string,
    methodName: 'process_appchain_messages_with_all_proofs',
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN('0'),
  })
}

export async function updateState(args: LightClientState) {
  console.log('updateState========================')
  console.log('\x1b[32m%s\x1b[0m', JSON.stringify(args))
  console.log('===================================')
  return await account.functionCall({
    contractId: anchorContractId as string,
    methodName: 'start_updating_state_of_beefy_light_client',
    args,
    gas: DEFAULT_GAS,
    attachedDeposit: new BN('0'),
  })
}

export async function getLatestCommitmentBlockNumber() {
  const latest_commitment = await account.viewFunction(
    anchorContractId as string,
    'get_latest_commitment_of_appchain',
    {}
  )
  return latest_commitment ? latest_commitment.block_number : 0
}

export async function processAppchainMessages() {
  const result: any = await account.functionCall({
    contractId: anchorContractId as string,
    methodName: 'process_appchain_messages',
    args: {},
    gas: DEFAULT_GAS,
    attachedDeposit: new BN('0'),
  })
  let returnVal: any = null
  const returnValBase64 = result.status.SuccessValue
  if (returnValBase64) {
    returnVal = JSON.parse(
      Buffer.from(returnValBase64, 'base64').toString('utf8')
    )
  }
  console.log('returnVal: ', returnVal.Error)
  // const isOk = returnVal === "Ok";
  return { result, returnVal }
}

export async function checkAnchorIsWitnessMode() {
  try {
    const anchorSettings = await getAnchorSettings()
    return anchorSettings
      ? anchorSettings.beefy_light_client_witness_mode
      : false
  } catch (error) {
    console.error('checkAnchorIsWitnessMode error', error)
    return false
  }
}

export async function checkAnchorMessagesNeedProcess() {
  try {
    const anchorStatus = await getAnchorStatus()
    if (anchorStatus) {
      const {
        max_nonce_of_staged_appchain_messages,
        latest_applied_appchain_message_nonce,
      } = anchorStatus.permissionless_actions_status
      return (
        max_nonce_of_staged_appchain_messages >
        latest_applied_appchain_message_nonce
      )
    }
    return false
  } catch (error) {
    console.error('checkAnchorIsWitnessMode error', error)
    return false
  }
}

export async function tryComplete(methodName: string) {
  console.log('tryComplete', methodName)
  const tryCompleteResult: any = await account.functionCall({
    contractId: anchorContractId as string,
    methodName,
    args: {},
    gas: DEFAULT_GAS,
    attachedDeposit: new BN('0'),
  })
  let returnVal = ''
  const returnValBase64 = tryCompleteResult.status.SuccessValue
  if (returnValBase64) {
    returnVal = JSON.parse(
      Buffer.from(returnValBase64, 'base64').toString('utf8')
    )
  }
  console.log('tryComplete returnVal: ', returnVal)
  const isOk = returnVal === 'Ok'
  return isOk
}

export async function getAnchorSettings() {
  const anchorSettings = await account.viewFunction(
    anchorContractId as string,
    'get_anchor_settings',
    {}
  )
  return anchorSettings
}

export async function getAnchorStatus() {
  const anchorStatus = await account.viewFunction(
    anchorContractId as string,
    'get_anchor_status',
    {}
  )
  return anchorStatus
}
