import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import { useContracts } from '@/config/ContractsContext'
import { isPresent, tryRead } from '@/lib/optionalRead'

export interface GlfRole {
  /** the GLF veto signer, when the deployment exposes glfVetoSigner() */
  signer?: Address
  /** whether `account` is the signer / a Charter-registered member; undefined without an account */
  isSigner?: boolean
  isMember?: boolean
  /**
   * 'getter'  — read from glfVetoSigner()/glfMembers(): authoritative
   * 'absent'  — the getters revert on this deployment: the caller falls back
   *             to simulating the gated call (useCanCall)
   * 'unknown' — the node did not answer: fall back, and say so
   * 'pending' — still reading
   */
  source: 'getter' | 'absent' | 'unknown' | 'pending'
}

/**
 * The GLF roles, read rather than inferred.
 *
 * Before CON-864 the roles lived in write-only private slots, so the only way
 * to know whether the connected account could veto or extend was to simulate
 * the call. The getters make it a plain read that every visitor can see,
 * wallet or not; the simulation stays as the fallback for a deployment that
 * predates them.
 */
export function useGlfRole(account?: Address): GlfRole {
  const { voting } = useContracts()
  const [role, setRole] = useState<GlfRole>({ source: 'pending' })

  useEffect(() => {
    if (!voting) { setRole({ source: 'pending' }); return }
    let cancelled = false
    void (async () => {
      const signer = await tryRead<Address>({ address: voting, abi: GovernanceVotingABI as never, functionName: 'glfVetoSigner' })
      if (cancelled) return
      if (!isPresent(signer)) { setRole({ source: 'absent' in signer ? 'absent' : 'unknown' }); return }
      let isMember: boolean | undefined
      if (account) {
        const member = await tryRead<boolean>({ address: voting, abi: GovernanceVotingABI as never, functionName: 'glfMembers', args: [account] })
        if (cancelled) return
        isMember = isPresent(member) ? member.value : undefined
      }
      setRole({
        source: 'getter', signer: signer.value, isMember,
        isSigner: account ? signer.value.toLowerCase() === account.toLowerCase() : undefined,
      })
    })()
    return () => { cancelled = true }
  }, [voting, account])

  return role
}
