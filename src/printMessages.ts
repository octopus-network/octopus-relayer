import decodeMessages from 'messages-decoder'
import { ApiPromise } from '@polkadot/api'
import { WsProvider2 } from './utils'
import { getCommitments, getOffchainDataForCommitment } from './commitments'
import { appchainSetting } from './constants'
import util from 'util'

async function print() {
  console.log('print')
  const wsProvider = new WsProvider2(appchainSetting.wsRpcEndpoint)
  const appchain = await ApiPromise.create({
    provider: wsProvider,
  })
  const commitments = await getCommitments()
  const cs = await Promise.all(
    commitments.map(async (c) => {
      let encoded_messages = await getOffchainDataForCommitment(
        appchain,
        c.commitment
      )
      if (encoded_messages.length === 0) {
        const prefixBuffer = Buffer.from('commitment', 'utf8')
        const key = '0x' + prefixBuffer.toString('hex') + c.commitment.slice(2)
        encoded_messages = await getOffchainDataForCommitment(appchain, key)
      }
      const decoded_messages: any = decodeMessages(encoded_messages)
      return { ...c, decoded_messages: decoded_messages }
    })
  )
  const decoded = cs.map(
    ({
      height,
      commitment,
      created_at,
      updated_at,
      tx_id,
      status,
      decoded_messages,
    }: any) => ({
      height,
      commitment,
      created_at: new Date(created_at).toLocaleString(),
      updated_at: new Date(`${updated_at}.000Z`).toLocaleString(),
      tx_id,
      status,
      decoded_messages,
    })
  )
  console.log('==============================')
  console.log('=======Decoded messages=======')
  console.log(
    util.inspect(decoded, {
      showHidden: false,
      depth: null,
      colors: true,
      maxArrayLength: null,
    })
  )
  console.log('==============================')
}

print()
