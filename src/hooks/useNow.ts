import { useEffect, useState } from 'react'

/** Unix seconds, re-read every `intervalMs`, for countdowns that must move without a refresh. */
export function useNow(intervalMs = 30_000): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
  useEffect(() => {
    const timer = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
