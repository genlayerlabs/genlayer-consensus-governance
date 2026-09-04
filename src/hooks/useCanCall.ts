import { useEffect, useRef, useState } from 'react'
import type { Abi, Address } from 'viem'
import { publicClient } from '@/config/clients'
import { errorMessage } from '@/lib/governance'

/**
 * Ask the chain whether the connected account may make a call, by simulating
 * it and watching for a revert.
 *
 * The GLF roles have NO getters — `GovernanceVoting` carries
 * `setGLFVetoSigner` and `setGLFMember`, both of which write a private slot
 * and emit nothing, so neither the signer nor the member set is readable or
 * recoverable from logs. A simulation is the only honest way to know: it runs
 * the real authorisation check against real state and costs one eth_call.
 *
 * Three outcomes, and the difference matters. `true` means the call would
 * succeed now. `false` means it reverted, which is a fact about this account
 * AND this moment — a state change or a role rotation flips it. `undefined`
 * means we have not learned anything: no account, no target, still in flight,
 * or the node failed for its own reasons. Callers must not read `undefined`
 * as a denial, or an RPC hiccup would silently hide a button its owner is
 * entitled to press.
 */
export function useCanCall(params: {
  address?: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  account?: Address
  enabled?: boolean
}) {
  const { address, abi, functionName, account, enabled = true } = params
  // Args are held in a ref and only their shape drives the effect: a fresh
  // array literal on every render would otherwise re-simulate forever.
  const args = useRef(params.args)
  args.current = params.args
  const argsKey = JSON.stringify(params.args, (_key, value) => typeof value === 'bigint' ? value.toString() : value)
  const [allowed, setAllowed] = useState<boolean>()
  const [reason, setReason] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!enabled || !address || !account) { setAllowed(undefined); setReason(''); return }
    let cancelled = false
    setChecking(true)
    publicClient
      .simulateContract({ address, abi, functionName, args: args.current, account } as never)
      .then(() => { if (!cancelled) { setAllowed(true); setReason('') } })
      .catch((error: unknown) => {
        if (cancelled) return
        // A revert answers the question; a transport failure does not.
        const name = (error as { name?: string })?.name ?? ''
        const reverted = name === 'ContractFunctionExecutionError' || name === 'ContractFunctionRevertedError'
        setAllowed(reverted ? false : undefined)
        setReason(reverted ? errorMessage(error).split('\n')[0] : '')
      })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [address, abi, functionName, argsKey, account, enabled])

  return { allowed, checking, reason }
}
