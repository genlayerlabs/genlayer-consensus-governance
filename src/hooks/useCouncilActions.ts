import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import SecurityCouncilABI from '@/abi/SecurityCouncil.json'
import { deploymentConfig } from '@/config/chain'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { cacheableHead, readCache, writeCache } from '@/lib/logCache'
import { scanLogs } from '@/lib/rpc'
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

/**
 * The council action log.
 *
 * `actions` is a private mapping, `actionNonce` has no getter and there is no
 * id list, so an action can only be DISCOVERED from CouncilActionCreated.
 * Everything else about it is then read live, because none of it is stable:
 * `actionStatus` recounts valid approvals on every call (departures can push
 * an emergency action back below threshold) and a membershipVersion bump
 * silently kills every open non-emergency action.
 *
 * So: creations are cached (immutable), status and approvers are not.
 * Approvers in particular have no getter at all for a pending action —
 * `approversOf` is keyed on the bound voting action id, not this one — so the
 * list is rebuilt from CouncilActionApproved logs.
 */
/** Block timestamps, kept for the life of the tab. A mined block's timestamp
 *  never changes, so this is the one thing here safe to memoise outright. */
const blockTimes = new Map<string, bigint>()

async function timestampOf(blockNumber?: bigint): Promise<bigint | undefined> {
  if (blockNumber === undefined) return undefined
  const key = blockNumber.toString()
  const hit = blockTimes.get(key)
  if (hit !== undefined) return hit
  try {
    const block = await publicClient.getBlock({ blockNumber })
    blockTimes.set(key, block.timestamp)
    return block.timestamp
  } catch { return undefined }
}

export function useCouncilActions() {
  const { currentSet } = useContracts()
  const { address } = useWallet()
  const [actions, setActions] = useState<CouncilAction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState('')
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

      const head = await publicClient.getBlockNumber()
      const from = cached && cached.toBlock > 0n ? cached.toBlock + 1n : deploymentConfig.deploymentStartBlock
      indexedTo.current = cached?.toBlock

      if (from <= head) {
        const created = await scanLogs({
          address: council, abi: SecurityCouncilABI as never, eventName: 'CouncilActionCreated' as never,
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
          scanLogs({ address: council, abi: SecurityCouncilABI as never, eventName: 'CouncilActionApproved' as never, fromBlock: earliest, toBlock: head }),
          scanLogs({ address: council, abi: SecurityCouncilABI as never, eventName: 'CouncilActionExecuted' as never, fromBlock: earliest, toBlock: head }),
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
          .map(async (blockNumber) => { times.set(blockNumber.toString(), await timestampOf(blockNumber)) }))
        for (const entry of rawApprovals) {
          approvalsById.set(entry.id, [...(approvalsById.get(entry.id) ?? []), {
            address: entry.address,
            at: times.get(entry.blockNumber.toString()),
            transactionHash: entry.transactionHash,
          }])
        }
        for (const log of executed as any[]) executedIds.add(String(log.args.actionId).toLowerCase())
      }

      const rows = await Promise.all([...known.values()].map(async (entry): Promise<CouncilAction> => {
        let status = 0
        let approvals = 0
        try {
          const live = await publicClient.readContract({
            address: council, abi: SecurityCouncilABI, functionName: 'actionStatus', args: [entry.actionId],
          } as never) as [number, number, bigint | number]
          status = Number(live[0])
          approvals = Number(live[1])
        } catch { /* an unknown id reads as None; keep the log-derived row */ }
        const id = entry.actionId.toLowerCase()
        return {
          ...entry,
          status,
          approvals,
          approvers: approvalsById.get(id) ?? [],
          executed: executedIds.has(id),
        }
      }))

      rows.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : (a.blockNumber ?? 0n) > (b.blockNumber ?? 0n) ? -1 : 1))
      setActions(rows)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false); setProgress('') }
  }, [currentSet])

  useEffect(() => { void refresh() }, [refresh])
  // Approving is the point of this page, and who may approve depends on the
  // connected account — a wallet switch has to re-read the log, or the member
  // who just approved still sees the tally they had before switching.
  useEffect(() => { if (address) void refresh() }, [address, refresh])
  return { actions, loading, error, progress, refresh }
}
