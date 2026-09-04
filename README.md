# GenLayer Governance POC

Frontend-only, on-chain-only proof of concept for GenLayer governance. The application reads governance state and logs directly from a configured GenLayer RPC and submits every write from the connected browser wallet.

> This is a learning and contract-integration POC, not the production governance portal. It has no availability SLA or formal frontend security audit. Verify addresses, decoded calldata, hashes, and wallet prompts before signing.

Live: [genlayerlabs.github.io/genlayer-consensus-governance](https://genlayerlabs.github.io/genlayer-consensus-governance/) — defaults to `deployment_gov3` on the GenLayer testnet.

## Phase 1 — proposals ([CON-861](https://linear.app/genlayer-labs/issue/CON-861))

- Browse every proposal, enumerated by walking ids upward until `state(id)` reverts `UnknownProposal` — complete without an indexer, and immune to the log-range cap that a scan is subject to.
- Search, filter and sort proposals; a previous visit's index paints the list immediately while ids are re-read.
- Inspect the complete on-chain description and ordered operation payload, with local commitment verification.
- Understand For, Against, Abstain, snapshot GES, quorum, For floor, and exact rational approval independently.
- Inspect lifecycle, veto/Risk Review influence, pinned `contractsHash`, timelock, execution window, and retry state.
- Scan `VoteCast` logs in bounded, adaptive RPC ranges; filter voters and retain partial results after RPC errors.
- Connect an injected wallet, view snapshot voting power, vote with an optional on-chain reason, settle, execute/retry, and expire.
- Vote as the connected account **or through a validator wallet you own** — wallets below the snapshot threshold are listed and disabled rather than hidden.
- Build executable proposals or RFCs with class rules, payload permissions, byte limits, account eligibility, bond, and `eth_call` preflight checks.

## Phase 2 — council, delegation, elections ([CON-862](https://linear.app/genlayer-labs/issue/CON-862))

**Security Council.** Roster with seat, cohort, term and status; thresholds and membership version; the governance clock's freeze state and remaining freeze budget. Create an action, approve it to threshold, and execute it:

- The proposal an action targets is picked from the ones it can legally target — `DesignateSpam` and `RaiseClass` list Pending proposals, `VoidProposal` lists Active, `RiskReview` lists Risk Review and Timelock. Three of the four are enforced where the action *executes*, so an unfiltered pick would be approved by five members before reverting.
- `RaiseClass` computes its target classes from `classParams`, `isAtLeastAsStrict` and a per-operation `isPermittedFor` check; ineligible classes are listed disabled with the reason.
- Execute is gated on a simulation. An approved action can already be dead — `DesignateSpam` needs the proposal Pending, and voting opening mid-approval kills it with no event — so the card says the action can no longer execute rather than offering a button that reverts.
- The action log names the proposal each action targets and lists every approver with the time their approval landed, derived from the block of each `CouncilActionApproved`.

**GLF actions on a proposal.** Approve Risk Review, veto with a ground and rationale, extend the veto window. The GLF roles have no getters, so the account is probed by simulating the call: allowed gets the button alone, refused gets an explanation, and an unanswerable probe shows both — an RPC failure must never read as a denial.

**Delegation.** A directory of every address that can hold voting power, built from paged staking views rather than logs, with your own delegation panel above it. Clicking an address fills the delegate field. The per-position `MIN_ENTRY_VALUE` floor is pre-flighted before the transaction: several small positions cannot be combined to clear it, and the panel says so instead of letting the call revert.

**Elections.** Bootstrap, cohort, special, recall and runoff elections with slate, winners, alternates and candidate roll. Exactly one crank is offered per phase — Open endorsement in Nomination, Seal slate in Preparation, Cast ballot in Voting, Settle from Succeeded — because `startEndorsement` is idempotent and a simulation cannot tell a duplicate from a first call. Claim bond is simulated and shown only when there is something to claim.

## Phase 3 — blocked on contract changes ([CON-864](https://linear.app/genlayer-labs/issue/CON-864))

Things the UI cannot do because the value it needs is not readable and cannot be recovered from logs. These need contract additions, not frontend work:

| What | Why | Needed |
| --- | --- | --- |
| Nominate a candidate | `nominate` demands an exact `msg.value` of bond + registration fee + manifesto storage; none of the three has a getter and their setter emits nothing | `electionEconomics()` |
| Live phase countdown, turnout, quorum | No `elections(uint256)` struct getter; turnout exists only after settlement | `elections(uint256)` |
| Gate the GLF buttons without simulating | `setGLFVetoSigner` / `setGLFMember` write private slots and emit nothing | `glfVetoSigner()`, `glfMembers(address)` |
| A provably complete action log | `actions` and `actionNonce` are private; actions are discoverable only from logs | `actionCount()`, `actionIdAt(uint256)` |
| The full candidate roll | `electionSlate` returns only the sealed top set | `candidatesOf(uint256)` |
| Count proposals in one call | No `proposalCount()`; ids are probed instead | `proposalCount()` |
| Historical election parameters | Five setters emit no events, so past values are unrecoverable | events on the setters |
| Vote stake held in a Vesting contract | Not a contract gap — the passthroughs and `VestingFactory.getVesting` exist. `VestingFactory` is simply not registered in gov3's AddressManager | register it |

## Architecture and trust model

There is no backend, server runtime, database, hosted indexer, IPFS dependency, analytics service, or off-chain governance workflow.

```text
Browser ── eth_call / eth_getLogs ──> configured RPC ──> governance contracts
   │
   └──── injected wallet transactions ───────────────> configured chain
```

The AddressManager is the only deployment entry point. The app resolves `GovernanceVoting`, obtains its current `contractsHash`, and verifies the active nine-address `ContractSet`. Each proposal's historical GES, voting power, and permission context is then resolved from its pinned set. Vendored ABIs make the static build deterministic; their source is recorded in [`src/abi/provenance.json`](src/abi/provenance.json).

### What is cached, and what never is

The browser caches **identity, never state**: which ids exist, which logs were emitted, which block a contract was created in. Everything a decision depends on — status, tallies, approval counts, voting power — is re-read on every render, because a roster change can invalidate an approval and a settle can change an outcome with no event of its own.

Log scans are floored at the target contract's creation block, found by a parallel `eth_getCode` search and then cached permanently per address. On `deployment_gov3` that turns a walk from genesis into nine `eth_getLogs` requests. The floor is exact rather than guessed: nothing can hide below a block where the contract did not exist.

## Local setup

Requirements: Node.js 22 and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

All `VITE_*` values are public build-time configuration; never add private keys or write-capable RPC credentials.

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
| `VITE_ADDRESS_MANAGER` | Governance deployment entry point | `deployment_gov3` |
| `VITE_DEPLOYMENT_START_BLOCK` | Lower bound for log scans | `0` |
| `VITE_MAX_BLOCK_RANGE` | Largest `eth_getLogs` window the RPC accepts | `10000` |

A visitor's own AddressManager choice lives in `localStorage` and always wins; the configured value is the fallback for someone who has never chosen one. Keep `VITE_DEPLOYMENT_START_BLOCK` at `0` when the AddressManager can be switched at runtime — a floor above another deployment's history would silently hide it, and the creation-block search makes the setting largely unnecessary.

## GitHub Pages

The Vite base path is `/genlayer-consensus-governance/`, routing uses URL hashes, and [the Pages workflow](.github/workflows/deploy-pages.yml) builds and deploys `main`. In repository settings, select **GitHub Actions** as the Pages source. A fresh checkout uses `npm ci`, runs lint/tests/build, and publishes only the static `dist/` artifact.

## Current limitations

- Council actions and election candidates are rebuilt from logs within a scanned range, because neither contract exposes enumeration. Completeness cannot be proven — see Phase 3.
- Known ABI decoding is limited to signatures entered by the proposer. Stored operations always retain a raw selector, arguments, value, calldata, and verified payload commitment.
- Creation-time staking epoch validation is authoritative only in the `propose` preflight, because the pinned governance `ContractSet` does not include the staking router.
- L1 bridge progress is represented in the proposal lifecycle, but a deployed bridge/executor and its live events are required for transaction-specific L1 status.
- The delegate directory is the union of joined validators and their delegators — a superset of everyone who can hold voting power, but it truncates at the paged-read ceiling and says so when it does.
- Reorganizations are handled by confirmed receipt waits and explicit refresh; cached logs carry a reorg margin below the head.
- Seat lifecycle actions, recall triggering, escrowed bond claims and the emergency path are readable but unbuilt. Nothing blocks them; they were out of scope for the POC.

## Contract source

The initial ABI cut is `genlayerlabs/genlayer-consensus` PR #1553 at commit `c592217870ea964b9fd7511253f8c498df9fae52`. Refresh the vendored ABIs and provenance together whenever the contract dependency cut changes.
