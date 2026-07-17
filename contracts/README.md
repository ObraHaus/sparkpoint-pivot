## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

The Base Sepolia (84532) core deploy is `script/DeploySepolia.s.sol` — it deploys, in one broadcast, a `TimelockController` (guardian + governance) then `CapRegistry` + `KillSwitch` + `AaveV3Adapter` + `SparkPointVault` wired to the Base Sepolia Aave v3 market, and writes the resulting addresses to `deployments/<chainid>/addresses.json`.

```shell
# Custody addresses (Base Sepolia Aave v3 market) MUST be set:
$ export USDC=… AAVE_POOL=… AUSDC=…
# Optional: TIMELOCK_MIN_DELAY (default 60s testnet), FEE_RECIPIENT (default deployer), PERF_FEE_BPS (default 1000).
$ forge script script/DeploySepolia.s.sol:DeploySepolia \
    --rpc-url <base_sepolia_rpc> --private-key <deployer_key> --broadcast
```

**Deterministic (CREATE2) addresses.** Every contract is deployed with `new X{ salt: SALT }(…)` where `SALT = keccak256("sparkpoint-core-v1")`, so the address is a pure function of **(deployer, salt, init-code)**:

- Redeploying the **same bytecode + constructor args** from the **same deployer** lands at the **same address** — no address churn across redeploys (proved by `test/DeployDeterminism.t.sol`).
- Because the address also depends on the constructor args, a **different Aave market / USDC / deployer** yields a **different** address (a genuinely different deployment).
- **CREATE2 changes only the deploy method, never the runtime bytecode** — the vault remains the exact test-suite build and stays **immutable + non-custodial**. It does **not** make any contract upgradeable. Bump the salt tag **only** to intentionally mint a fresh, distinct set of addresses.
- Deterministic via Foundry's canonical CREATE2 factory (`0x4e59…4956C`, present on Base Sepolia).

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
