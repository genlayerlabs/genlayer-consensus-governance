# GenLayer Governance POC

Frontend-only, on-chain-only proof of concept for GenLayer proposal governance. The application reads governance state and logs directly from a configured GenLayer RPC and submits every write from the connected browser wallet.

> This is a learning and contract-integration POC, not the production governance portal. It has no availability SLA or formal frontend security audit. Verify addresses, decoded calldata, hashes, and wallet prompts before signing.

## Phase 1 journeys

- Browse proposals discovered from bounded `ProposalCreated` log scans.
- Search, filter, sort, and incrementally load proposals without an indexer.
- Inspect the complete on-chain description and ordered operation payload, with local commitment verification.
- Understand For, Against, Abstain, snapshot GES, quorum, For floor, and exact rational approval independently.
- Inspect lifecycle, veto/Risk Review influence, pinned `contractsHash`, timelock, execution window, and retry state.
- Scan `VoteCast` logs in bounded, adaptive RPC ranges; filter voters and retain partial results after RPC errors.
- Connect an injected wallet, view snapshot voting power, vote with an optional on-chain reason, settle, execute/retry, and expire.
- Build executable proposals or RFCs with class rules, payload permissions, byte limits, account eligibility, bond, and `eth_call` preflight checks.

Dedicated Security Council/election management and delegation management are Phase 2 ([CON-862](https://linear.app/genlayer-labs/issue/CON-862)). Proposal-level effects from those systems remain visible in Phase 1.

## Architecture and trust model

There is no backend, server runtime, database, hosted indexer, IPFS dependency, analytics service, or off-chain governance workflow.

```text
Browser ── eth_call / eth_getLogs ──> configured RPC ──> governance contracts
   │
   └──── injected wallet transactions ───────────────> configured chain
```

The AddressManager is the only deployment entry point. The app resolves `GovernanceVoting`, obtains its current `contractsHash`, and verifies the active nine-address `ContractSet`. Each proposal's historical GES, voting power, and permission context is then resolved from its pinned set. Vendored ABIs make the static build deterministic; their source is recorded in [`src/abi/provenance.json`](src/abi/provenance.json).

Fetched governance state stays in memory. The browser may remember only the user's non-secret AddressManager preference. The chain remains the source of truth.

## Local setup

Requirements: Node.js 22 and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set `VITE_ADDRESS_MANAGER` after a governance stack is deployed, or enter the address through the header control. All `VITE_*` values are public build-time configuration; never add private keys or write-capable RPC credentials.

Validation:

```bash
npm run lint
npm test
npm run build
```

## Deployment configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_CHAIN_ID` | Wallet/RPC chain ID | `4221` |
| `VITE_CHAIN_NAME` | Displayed network name | `GenLayer Testnet` |
| `VITE_RPC_URL` | Public JSON-RPC endpoint | GenLayer testnet RPC |
| `VITE_EXPLORER_URL` | Transaction/address links | GenLayer testnet explorer |
| `VITE_ADDRESS_MANAGER` | Governance deployment entry point | blank |
| `VITE_DEPLOYMENT_START_BLOCK` | Lower bound for log scans | `0` |

No governance AddressManager is checked in yet because the contract cut has not been deployed. The UI labels that capability honestly and remains useful as a deployment-selectable read-only client rather than displaying mock proposals.

## GitHub Pages

The Vite base path is `/genlayer-consensus-governance/`, routing uses URL hashes, and [the Pages workflow](.github/workflows/deploy-pages.yml) builds and deploys `main`. In repository settings, select **GitHub Actions** as the Pages source. A fresh checkout uses `npm ci`, runs lint/tests/build, and publishes only the static `dist/` artifact.

## Current limitations

- Proposal discovery starts at the configured block and depends on RPC log limits. Adaptive chunking, progress, retry, and partial results are shown.
- The contracts do not expose enumerable GLF membership, so the UI does not claim a connected account can veto or extend a veto window. It explains the role-gated action instead.
- Known ABI decoding is currently limited to signatures entered by the proposer. Stored operations always retain a raw selector, arguments, value, calldata, and verified payload commitment.
- Creation-time staking epoch validation is authoritative only in the `propose` preflight because the pinned governance `ContractSet` does not include the staking router.
- L1 bridge progress is represented in the proposal lifecycle, but a deployed bridge/executor and its live events are required for transaction-specific L1 status.
- Reorganizations are handled by confirmed receipt waits and explicit refresh. The POC does not persist a local cache.

## Contract source

The initial ABI cut is `genlayerlabs/genlayer-consensus` PR #1553 at commit `c592217870ea964b9fd7511253f8c498df9fae52`. Refresh the vendored ABIs and provenance together whenever the contract dependency cut changes.
