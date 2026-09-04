import { deploymentConfig } from '@/config/chain'

/**
 * Append-only log cache in localStorage.
 *
 * `ProposalCreated` and `VoteCast` are immutable: a proposal cannot be
 * deleted and a vote cannot be recalled. So a range once scanned never needs
 * re-scanning — only the gap between the last scanned block and the head.
 * Without this, every visit re-walked the whole chain in cap-sized pages
 * (hundreds of requests before anything appeared).
 *
 * Entries are keyed by chain AND contract address, so switching the
 * AddressManager to another deployment set cannot serve one set's logs for
 * another.
 */

const VERSION = 'v1'
/**
 * Blocks near the head are withheld from the cache: a reorg would otherwise
 * persist logs that no longer exist, and nothing here ever re-validates a
 * cached range. Re-scanning this tail on each visit is a handful of blocks.
 */
const REORG_MARGIN = 32n

export interface CachedRange<T> {
  /** last block scanned INCLUSIVE; the next scan resumes at toBlock + 1 */
  toBlock: bigint
  records: T[]
}

function key(scope: string, address: string, id: string) {
  return `genlayer-gov-logs:${VERSION}:${deploymentConfig.chainId}:${address.toLowerCase()}:${scope}:${id}`
}

export function readCache<T>(scope: string, address: string, id: string, revive: (raw: any) => T): CachedRange<T> | undefined {
  try {
    const raw = localStorage.getItem(key(scope, address, id))
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return { toBlock: BigInt(parsed.toBlock), records: (parsed.records as any[]).map(revive) }
  } catch { return undefined }
}

export function writeCache<T>(scope: string, address: string, id: string, range: CachedRange<T>, serialize: (record: T) => any) {
  try {
    localStorage.setItem(key(scope, address, id), JSON.stringify({
      toBlock: range.toBlock.toString(),
      records: range.records.map(serialize),
    }))
  } catch { /* quota or private mode — the cache is an optimization, never a requirement */ }
}

/** The highest block safe to remember, given the reorg margin. */
export function cacheableHead(head: bigint): bigint {
  return head > REORG_MARGIN ? head - REORG_MARGIN : 0n
}
