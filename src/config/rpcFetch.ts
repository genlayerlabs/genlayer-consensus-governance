// The public Orbit RPC allows only a few requests per second and answers the
// rest with HTTP 429. Space requests out and retry the ones it still rejects,
// so a page loads slowly instead of failing with "RPC Request failed".
const MIN_GAP_MS = 250
const MAX_RETRIES = 4
const RETRY_BASE_MS = 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let nextSlot = 0

async function waitForSlot() {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + MIN_GAP_MS
  if (slot > now) await sleep(slot - now)
}

export async function rpcFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await waitForSlot()
    const response = await fetch(input, init)
    if (response.status !== 429 || attempt >= MAX_RETRIES) return response
    await sleep(RETRY_BASE_MS * 2 ** attempt)
  }
}

// Queued requests wait for their slot, so allow more than viem's 10s default.
export const RPC_TIMEOUT_MS = 60_000

// Aggregate the reads of one render into a few eth_calls. The chain has no
// Multicall3 deployment, so use viem's deployless variant, which ships the
// aggregator as init code: keep batches small (batchSize counts calldata
// bytes) to stay under the init-code limit.
export const MULTICALL_BATCH = { deployless: true, wait: 20, batchSize: 256 }
