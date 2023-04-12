## octopus-relayer

### Environments

The needed environments:

```bash
PROJECTID=octopus-dev-309403
SUB_VFP="/subscriptions/test-appchain-versioned-finality-proof-sub"
SUB_MSG="/subscriptions/test-appchain-message-sub"
SUB_SIGNED_MSG="/subscriptions/test-appchain-signed-message-sub"
SUB_UNSIGNED_MSG="/subscriptions/test-appchain-unsigned-message-sub"
TOPIC_VFP="/topics/test-appchain-versioned-finality-proof"
TOPIC_MSG="/topics/test-appchain-message"
TOPIC_SIGNED_MSG="/topics/test-appchain-signed-message"
TOPIC_UNSIGNED_MSG="/topics/test-appchain-unsigned-message"
APPCHAIN_SETTINGS={ "barnacle-latest": { "appchainId": "barnacle-latest", "subqlEndpoint": "", "wsRpcEndpoint": "wss://gateway.testnet.octopus.network/barnacle-latest/ubmp83h7khynzohqzlumb3focllbh12e" }}
APPCHAIN_ID=barnacle-latest
NEAR_SETTINGS={ "nearEnv": "testnet", "nearNodeUrl": "https://near-testnet.infura.io/v3/dabe9e95376540b083ae09909ea7c576", "archivalNearNodeUrl": "https://archival-rpc.testnet.near.org/", "walletUrl": "https://wallet.testnet.near.org", "helperUrl": "https://helper.testnet.near.org" }
CONTRACTS={ "registryContract": "registry.test_oct.testnet", "daoContractId": "council-keeper.registry.test_oct.testnet", "octTokenContractId": "oct.beta_oct_relay.testnet" }
RELAYER_NEAR_ACCOUNT={ "id": "test-relayer.testnet", "privateKey": "" }
```
