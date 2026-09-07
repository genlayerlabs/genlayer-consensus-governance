import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import SecurityCouncilABI from '@/abi/SecurityCouncil.json'
import { contractCreationBlock } from '@/lib/deploymentBlock'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { cacheableHead, readCache, writeCache } from '@/lib/logCache'
import { isPresent, tryRead } from '@/lib/optionalRead'
import { blockTimestamp, scanLogs } from '@/lib/rpc'
import type { CouncilAction, CouncilApproval } from '@/lib/types'

interface CachedCreation {
  actionId: Hex
  actionType: number
  creator: Address
  actionData: Hex
  expiresAt: bigint
  transactionHash?: Hex
  blockNumber?: bigint
}

const abi = SecurityCouncilABI as never

/**
 * The council action log.
 *
 * Action ids are keccak digests keyed in a private mapping. Where the
 * deployment exposes `actionCount()` / `actionIdAt(i)` (CON-864) the list is
 * the contract's own, complete by construction, and `actionMeta` /
 * `actionPayload` / `actionStatus` supply everything but the creator. Where
 * it does not, an action can only be DISCOVERED from CouncilActionCreated,
 * and completeness holds only within the scanned range.
 *
 * The log is scanned in both cases: it is the only source of the creator and
 * the creation transaction, and of any action created BEFORE the index
 * existed (those are absent from it by construction). Everything mutable is
 * read live, because none of it is stable: `actionStatus` recounts valid
 * approvals on every call (departures can push an emergency action back
 * below threshold) and a membershipVersion bump silently kills every open
 * non-emergency action. Approvers have no getter at all for a pending
 * action — `approversOf` is keyed on the bound voting action id — so the
 * list is rebuilt from CouncilActionApproved logs.
 */
export function useCouncilActions() {
  const { currentSet } = useContracts()
  const { address } = useWallet()
  const [actions, setActions] = useState<CouncilAction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState('')
  /** true when the list came from actionCount/actionIdAt */
  const [complete, setComplete] = useState(false)
  const [indexUnknown, setIndexUnknown] = useState(false)
  const indexedTo = useRef<bigint | undefined>(undefined)

  const refresh = useCallback(async () => {
    const council = currentSet?.council
    if (!council) { setActions([]); return }
    setLoading(true); setError(undefined)
    try {
      const revive = (raw: any): CachedCreation => ({
        ...raw,
        expiresAt: BigInt(raw.expiresAt),
        blockNumber: raw.blockNumber === undefined ? undefined : BigInt(raw.blockNumber),
      })
      const cached = readCache<CachedCreation>('council-actions', council, 'all', revive)
      const known = new Map<string, CachedCreation>()
      for (const entry of cached?.records ?? []) known.set(entry.actionId.toLowerCase(), entry)

      // The index first: one read for the count, one batched round for the
      // ids, and the rows can paint before any log arrives.
      const count = await tryRead<bigint>({ address: council, abi, functionName: 'actionCount' })
      const indexed = new Map<string, { actionId: Hex; actionType: number; actionData: Hex; expiresAt: bigint; rosterVersion: bigint; status: number; approvals: number }>()
      if (isPresent(count)) {
        const ids = await Promise.all(Array.from({ length: Number(count.value) }, (_unused, index) =>
          publicClient.readContract({ address: council, abi, functionName: 'actionIdAt', args: [BigInt(index)] } as never) as Promise<Hex>))
        await Promise.all(ids.map(async (actionId) => {
          const [meta, payload, live] = await Promise.all([
            publicClient.readContract({ address: council, abi, functionName: 'actionMeta', args: [actionId] } as never) as Promise<any[]>,
            publicClient.readContract({ address: council, abi, functionName: 'actionPayload', args: [actionId] } as never) as Promise<Hex>,
            publicClient.readContract({ address: council, abi, functionName: 'actionStatus', args: [actionId] } as never) as Promise<any[]>,
          ])
          indexed.set(actionId.toLowerCase(), {
            actionId, actionType: Number(meta[0]), rosterVersion: BigInt(meta[1]), actionData: payload,
            status: Number(live[0]), approvals: Number(live[1]), expiresAt: BigInt(live[2]),
          })
        }))
      }
      setComplete(isPresent(count))
      setIndexUnknown('unknown' in count)

      const head = await publicClient.getBlockNumber()
      // The council cannot have emitted anything before it existed, so its
      // creation block is an exact floor — ~25 eth_getCode calls once, against
      // ~2,060 capped getLogs requests on every cold visit.
      const from = cached && cached.toBlock > 0n ? cached.toBlock + 1n : await contractCreationBlock(council)
      indexedTo.current = cached?.toBlock

      if (from <= head) {
        const created = await scanLogs({
          address: council, abi, eventName: 'CouncilActionCreated' as never,
          fromBlock: from, toBlock: head,
          onProgress: ({ from: at, head: end, requests }) =>
            setProgress(`Scanned to block ${at.toLocaleString()} of ${end.toLocaleString()} · ${requests} request${requests === 1 ? '' : 's'}`),
        })
        for (const log of created as any[]) {
          known.set(String(log.args.actionId).toLowerCase(), {
            actionId: log.args.actionId,
            actionType: Number(log.args.actionType),
            creator: log.args.creator,
            actionData: log.args.actionData,
            expiresAt: BigInt(log.args.expiresAt),
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
          })
        }
        const safeTo = cacheableHead(head)
        if (safeTo >= from) {
          writeCache<CachedCreation>('council-actions', council, 'all', { toBlock: safeTo, records: [...known.values()] }, (entry) => ({
            ...entry,
            expiresAt: entry.expiresAt.toString(),
            blockNumber: entry.blockNumber?.toString(),
          }))
        }
      }

      // Approvals and executions are cheap to re-scan from the earliest known
      // action, and must not be cached: an approval can be invalidated by a
      // roster change without any event of its own.
      const earliest = [...known.values()].reduce<bigint | undefined>(
        (min, entry) => (entry.blockNumber !== undefined && (min === undefined || entry.blockNumber < min) ? entry.blockNumber : min),
        undefined,
      )
      const approvalsById = new Map<string, CouncilApproval[]>()
      const executedIds = new Set<string>()
      if (earliest !== undefined) {
        const [approved, executed] = await Promise.all([
          scanLogs({ address: council, abi, eventName: 'CouncilActionApproved' as never, fromBlock: earliest, toBlock: head }),
          scanLogs({ address: council, abi, eventName: 'CouncilActionExecuted' as never, fromBlock: earliest, toBlock: head }),
        ])
        // One getBlock per DISTINCT block, deduped across every action and
        // cached for the tab. A 9-seat council cannot produce enough approvals
        // for this to be worth batching.
        const rawApprovals = (approved as any[]).map((log) => ({
          id: String(log.args.actionId).toLowerCase(),
          address: log.args.approver as Address,
          blockNumber: log.blockNumber as bigint,
          transactionHash: log.transactionHash as Hex,
        }))
        const times = new Map<string, bigint | undefined>()
        await Promise.all([...new Set(rawApprovals.map((entry) => entry.blockNumber))]
          .map(async (blockNumber) => { times.set(blockNumber.toString(), await blockTimestamp(blockNumber)) }))
        for (const entry of rawApprovals) {
          approvalsById.set(entry.id, [...(approvalsById.get(entry.id) ?? []), {
            address: entry.address,
            at: times.get(entry.blockNumber.toString()),
            transactionHash: entry.transactionHash,
          }])
        }
        for (const log of executed as any[]) executedIds.add(String(log.args.actionId).toLowerCase())
      }

      // Union of the index and the log: an indexed action outside the scanned
      // logs has no creator; a logged action outside the index (created before
      // it existed) reads its status live, as before.
      const ids = new Set<string>([...indexed.keys(), ...known.keys()])
      const rows = await Promise.all([...ids].map(async (id): Promise<CouncilAction> => {
        const fromIndex = indexed.get(id)
        const fromLog = known.get(id)
        let status = fromIndex?.status ?? 0
        let approvals = fromIndex?.approvals ?? 0
        if (!fromIndex) {
          try {
            const live = await publicClient.readContract({ address: council, abi, functionName: 'actionStatus', args: [fromLog!.actionId] } as never) as [number, number, bigint | number]
            status = Number(live[0]); approvals = Number(live[1])
          } catch { /* an unknown id reads as None; keep the log-derived row */ }
        }
        return {
          actionId: fromIndex?.actionId ?? fromLog!.actionId,
          actionType: fromIndex?.actionType ?? fromLog!.actionType,
          actionData: fromIndex?.actionData ?? fromLog!.actionData,
          expiresAt: fromIndex?.expiresAt ?? fromLog!.expiresAt,
          rosterVersion: fromIndex?.rosterVersion,
          creator: fromLog?.creator,
          transactionHash: fromLog?.transactionHash,
          blockNumber: fromLog?.blockNumber,
          source: fromIndex ? 'index' : 'log',
          status, approvals,
          approvers: approvalsById.get(id) ?? [],
          executed: executedIds.has(id) || status === 3,
        }
      }))

      // newest first: by creation block where known, index order otherwise
      const order = new Map([...indexed.keys()].map((id, index) => [id, index]))
      rows.sort((a, b) => {
        if (a.blockNumber !== undefined && b.blockNumber !== undefined && a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1
        return (order.get(b.actionId.toLowerCase()) ?? -1) - (order.get(a.actionId.toLowerCase()) ?? -1)
      })
      setActions(rows)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false); setProgress('') }
  }, [currentSet])

  useEffect(() => { void refresh() }, [refresh])
  // Approving is the point of this page, and who may approve depends on the
  // connected account — a wallet switch has to re-read the log, or the member
  // who just approved still sees the tally they had before switching.
  useEffect(() => { if (address) void refresh() }, [address, refresh])
  return { actions, loading, error, progress, complete, indexUnknown, refresh }
}
