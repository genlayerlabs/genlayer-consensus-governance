# GenLayer Governance POC

Frontend-only, on-chain-only proof of concept for GenLayer governance. The application reads governance state and logs directly from a configured GenLayer RPC and submits every write from the connected browser wallet.

> This is a learning and contract-integration POC, not the production governance portal. It has no availability SLA or formal frontend security audit. Verify addresses, decoded calldata, hashes, and wallet prompts before signing.

Live: [genlayerlabs.github.io/genlayer-consensus-governance](https://genlayerlabs.github.io/genlayer-consensus-governance/) — defaults to `deployment_gov3` on the GenLayer testnet. Since the CON-865 cut the app expects a deployment whose AddressManager names the nine governance identities by key (below); `deployment_gov3` predates that model and needs a fresh, sealed bootstrap before this build can read it.

## Phase 1 — proposals ([CON-861](https://linear.app/genlayer-labs/issue/CON-861))

- Browse every proposal, enumerated by `proposalCount()` where the deployment exposes it and otherwise by walking ids upward until `state(id)` reverts `UnknownProposal` — complete without an indexer either way, and immune to the log-range cap that a scan is subject to.
- Search, filter and sort proposals; a previous visit's index paints the list immediately while ids are re-read.
- Inspect the complete on-chain description and ordered operation payload, with local commitment verification.
- Understand For, Against, Abstain, snapshot GES, quorum, For floor, and exact rational approval independently.
- Inspect lifecycle, veto/Risk Review influence, timelock, execution window, and retry state.
- Scan `VoteCast` logs in bounded, adaptive RPC ranges; filter voters and retain partial results after RPC errors.
- Connect an injected wallet, view snapshot voting power, vote with an optional on-chain reason, settle, execute/retry, and expire.
- Vote as the connected account, **through a validator wallet you own, or through your Vesting contract** — identities that cannot vote are listed and disabled with the reason rather than hidden. The same picker delegates and casts election ballots.
- Build executable proposals or RFCs with class rules, payload permissions, byte limits, account eligibility, bond, and `eth_call` preflight checks.

## Phase 2 — council, delegation, elections ([CON-862](https://linear.app/genlayer-labs/issue/CON-862))

**Security Council.** Roster with seat, cohort, term and status; thresholds and membership version; the governance clock's freeze state and remaining freeze budget. Create an action, approve it to threshold, and execute it:

- The proposal an action targets is picked from the ones it can legally target — `DesignateSpam` and `RaiseClass` list Pending proposals, `VoidProposal` lists Active, `RiskReview` lists Risk Review and Timelock. Three of the four are enforced where the action *executes*, so an unfiltered pick would be approved by five members before reverting.
- `RaiseClass` computes its target classes from `classParams`, `isAtLeastAsStrict` and a per-operation `isPermittedFor` check; ineligible classes are listed disabled with the reason.
- Execute is gated on a simulation. An approved action can already be dead — `DesignateSpam` needs the proposal Pending, and voting opening mid-approval kills it with no event — so the card says the action can no longer execute rather than offering a button that reverts.
- The action log names the proposal each action targets and lists every approver with the time their approval landed, derived from the block of each `CouncilActionApproved`. Where the deployment exposes `actionCount()`, the list is the contract's own and an open action bound to an older membership version is flagged stale instead of offering an Approve that would revert.

**GLF actions on a proposal.** Approve Risk Review, veto with a ground and rationale, extend the veto window. The roles are read from `glfVetoSigner()` and `glfMembers()` where the deployment exposes them, and the signer is shown to every visitor. Where it does not, the account is probed by simulating the call: allowed gets the button alone, refused gets an explanation, and an unanswerable probe shows both — an RPC failure must never read as a denial.

**Delegation.** A directory of every address that can hold voting power, built from paged staking views rather than logs, with your own delegation panel above it. Clicking an address fills the delegate field. The per-position `MIN_ENTRY_VALUE` floor is pre-flighted before the transaction: several small positions cannot be combined to clear it, and the panel says so instead of letting the call revert.

**Elections.** Bootstrap, cohort, special, recall and runoff elections with slate, winners, alternates and candidate roll. Nominate with the exact bond + fee + storage cost, endorse candidates and withdraw a candidacy where the economics are readable. Where the deployment exposes the election struct, the phase boundaries are computed from its unfrozen offsets and the clock's frozen total — the contract's own arithmetic — and shown with a countdown, alongside turnout against the settle-time quorum and what settle will record. Exactly one crank is offered per phase — Open endorsement in Nomination, Seal slate in Preparation, Cast ballot in Voting, Settle from Succeeded — because `startEndorsement` is idempotent and a simulation cannot tell a duplicate from a first call. Claim bond is simulated and shown only when there is something to claim.

## Phase 3 — contract-dependent features ([CON-864](https://linear.app/genlayer-labs/issue/CON-864))

Things the UI could not do because the value it needs was not readable and cannot be recovered from logs. The contract side is [genlayer-consensus#1563](https://github.com/genlayerlabs/genlayer-consensus/pull/1563); the UI adopts each view with feature detection, so the same build serves a deployment with and without it.

| What | Why | Needed | UI status |
| --- | --- | --- | --- |
| Nominate a candidate | `nominate` demands an exact `msg.value` of bond + registration fee + manifesto storage; none of the three had a getter and their setter emitted nothing | `electionEconomics()` | nominate form with the cost to the wei and a preflight that self-corrects from `WrongPayment`; endorse and withdraw on the roll |
| Live phase countdown, turnout, quorum | No `elections(uint256)` struct getter; turnout existed only after settlement | `elections(uint256)` | exact bounds with a countdown, turnout and the settle-time quorum where exposed; otherwise the projections recorded at start |
| Gate the GLF buttons without simulating | `setGLFVetoSigner` / `setGLFMember` wrote private slots and emitted nothing | `glfVetoSigner()`, `glfMembers(address)` | read where exposed; otherwise simulated |
| A provably complete action log | `actions` and `actionNonce` are private; actions were discoverable only from logs | `actionCount()`, `actionIdAt(uint256)`, `actionMeta(bytes32)` | enumerated where exposed, with a stale-roster flag from `actionMeta`; logs still supply creators and pre-index actions; otherwise log-built and labelled |
| The full candidate roll | `electionSlate` returns only the sealed top set | `candidatesOf(uint256)`, `candidateOf(uint256,address)` | the contract's roll where exposed, with manifestos on demand; otherwise rebuilt from logs and labelled |
| Count proposals in one call | No `proposalCount()`; ids were probed instead | `proposalCount()` | read where exposed; otherwise probed |
| Historical election parameters | Seven setters emitted no events, so past values were unrecoverable | events on the setters, plus `electionPeriods()`, `electionQuorums()`, `termLength()` | parameters panel with a change history scanned on demand |
| Vote stake held in a Vesting contract | Not a contract gap — the passthroughs and `VestingFactory.getVesting` exist. `VestingFactory` is simply not registered in gov3's AddressManager | register it (carried by the upgrade proposal) | the vesting appears in "Vote as", "Delegate as" and "Ballot as" where the factory is registered; validator wallets the vesting owns are listed disabled, since Vesting has no passthrough for their votes |

### Sealed identities ([genlayer-consensus#1572](https://github.com/genlayerlabs/genlayer-consensus/pull/1572), CON-865)

The `ContractSet` lookup API — `registerContractSet`, `activateContractSet`, `contractSet(hash)`, `currentContractsHash`, `migrationInProgress` and the migration coordinator — is gone. The nine governance identities are keys of a sealed `AddressManager` instead, and the UI resolves them the way the contracts do, one `getAddress(key)` each (`src/lib/sealedIdentities.ts`):

| Key | Role | Required |
| --- | --- | --- |
| `Governance` | executor | yes |
| `GovernanceVoting` | proposals and votes | yes |
| `GovernanceVotingPower` | voting-power ledger | yes |
| `GovernanceGESRegistry` | GES registry | yes |
| `GovernanceClassRegistry` | class rules and permissions | yes |
| `GovernanceClock` | freezes and maintenance | yes |
| `SecurityCouncil` | council | optional |
| `GovernanceCouncilElections` | elections | optional |
| `GovernanceL1Bridge` | L1 bridge | optional |

A zero answer for an optional key means the deployment never selected that member — the council, elections and L1 views say so rather than reading a zero address. A zero for a required key is refused with the missing keys named. The AddressManager dialog lists the nine keys with their resolved addresses and, where the book exposes `isSealed()` / `manifestCommitment()`, whether it is sealed; the migration banner, the "no migration" submission criterion and the per-proposal "pinned contract set" are gone with the API. Nothing is pinned per proposal any more: a sealed book cannot change, so the environment a proposal was created under is the one it settles and executes under.

## Architecture and trust model

There is no backend, server runtime, database, hosted indexer, IPFS dependency, analytics service, or off-chain governance workflow.

```text
Browser ── eth_call / eth_getLogs ──> configured RPC ──> governance contracts
   │
   └──── injected wallet transactions ───────────────> configured chain
```

The AddressManager is the only deployment entry point. The app resolves the nine governance identities from it by key (see *Sealed identities* above) and every read and write goes to those addresses; a proposal's GES, voting power and permission context come from the same contracts, because on a sealed book there is nothing else they could come from. Vendored ABIs make the static build deterministic; their source is recorded in [`src/abi/provenance.json`](src/abi/provenance.json).

Views added after a deployment shipped are feature-detected (`src/lib/optionalRead.ts`): the view is tried first; a revert selects the log or probe fallback the UI has always had; a transport error keeps the fallback and is reported as "could not read", never as "not available on this deployment".

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

- Council actions are rebuilt from logs within a scanned range where `actionCount()` is absent, and election candidates where `candidatesOf` is absent or empty. Completeness cannot be proven on that path, and the page says so — see Phase 3. Even with the index, an action's creator comes only from its `CouncilActionCreated` log.
- Known ABI decoding is limited to signatures entered by the proposer. Stored operations always retain a raw selector, arguments, value, calldata, and verified payload commitment.
- Creation-time staking epoch validation is authoritative only in the `propose` preflight; the UI reads the staking router from the AddressManager's `Staking` key for the delegate directory only.
- L1 bridge progress is represented in the proposal lifecycle, but a deployed bridge/executor and its live events are required for transaction-specific L1 status.
- The delegate directory is the union of joined validators and their delegators — a superset of everyone who can hold voting power, but it truncates at the paged-read ceiling and says so when it does.
- Reorganizations are handled by confirmed receipt waits and explicit refresh; cached logs carry a reorg margin below the head.
- `execute` and `executeAction` are sent with an explicit gas limit (twice the estimate, at least 1.5M). `GovernanceVoting.execute` catches its own batch failure, so the wallet's estimate is the gas at which the batch runs out and is caught, and a multi-operation proposal sent with it records `ProposalExecutionFailed` instead of executing.
- Seat lifecycle actions, recall triggering, escrowed bond claims and the emergency path are readable but unbuilt. Nothing blocks them; they were out of scope for the POC.
- A validator wallet owned by a Vesting contract can be voted by nobody from a browser: Vesting exposes passthroughs for its own weight, none for its wallets'. Such wallets are listed disabled with that reason.

## Contract source

The initial ABI cut is `genlayerlabs/genlayer-consensus` PR #1553 at commit `c592217870ea964b9fd7511253f8c498df9fae52`. The CON-864 cut (PR #1563, commit `1351ca344990baef677e081e68e6050e4fb0330c`) adds views and events only. The CON-865 cut (PR #1572, commit `e9dc6029ca84ae3578db709d1b4b02eb189c564d`) removes the `ContractSet` API and adds `addressManager()` / `protocolComponentId()` on every governance contract and the seal views on `AddressManager`; the ten governance/AddressManager ABIs are from that commit. Refresh the vendored ABIs and provenance together whenever the contract dependency cut changes.
