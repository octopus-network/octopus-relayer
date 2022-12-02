# octopus-relayer

## Preparation For test

```
// public

export NEAR_SETTINGS="{ \"nearEnv\": \"testnet\", \"nearNodeUrl\": \"https://near-testnet.infura.io/v3/dabe9e95376540b083ae09909ea7c576\", \"archivalNearNodeUrl\": \"https://archival-rpc.testnet.near.org/\", \"walletUrl\": \"https://wallet.testnet.near.org\", \"helperUrl\": \"https://helper.testnet.near.org\" }"

export CONTRACTS="{ \"registryContract\": \"registry.test_oct.testnet\", \"daoContractId\": \"council-keeper.registry.test_oct.testnet\", \"octTokenContractId\": \"oct.beta_oct_relay.testnet\" }"

export APPCHAIN_SETTINGS="{ \"barnacle0928\": { \"appchainId\": \"barnacle0928\", \"subqlEndpoint\": \"https://api.subquery.network/sq/octopus-appchains/barnacle\", \"wsRpcEndpoint\": \"wss://gateway.testnet.octopus.network/barnacle0928/9mw012zuf27soh7nrrq3a4p0s2ti3cyn\" }, \"barnacle-evm\": { \"appchainId\": \"barnacle-evm\", \"subqlEndpoint\": \"https://api.subquery.network/sq/octopus-appchains/barnacle\", \"wsRpcEndpoint\": \"wss://gateway.testnet.octopus.network/barnacle-evm/wj1hhcverunusc35jifki19otd4od1n5\" }}"


// private

export RELAYER_NEAR_ACCOUNT="{ \"id\": \"test-relayer.testnet\", \"privateKey\": \"...\" }"


// relayer-only

export APPCHAIN_ID=barnacle0928
export START_BLOCK_HEIGHT=1
export UPDATE_STATE_MIN_INTERVAL=60

```

```
$ yarn dev
```
