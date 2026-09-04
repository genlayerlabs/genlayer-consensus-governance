import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import GovernanceClassRegistryABI from '@/abi/GovernanceClassRegistry.json'
import { publicClient } from '@/config/clients'
import { CLASS_NAMES, normalizeClassParams } from '@/lib/governance'
import type { ClassParams, ProposalSummary } from '@/lib/types'

export interface RaiseClassOption {
  classId: number
  name: string
  eligible: boolean
  /** why not, in the caller's words — shown on the disabled option */
  blockedBy?: string
  params?: ClassParams
}

/**
 * Which classes a proposal can actually be raised to.
 *
 * raiseClassEffects enforces three separate things and reverts with three
 * different errors, none of which the composer could see before submitting:
 * the class must exist (thresholdDen != 0, else UnknownClass), it must be
 * STRICTLY stricter (isAtLeastAsStrict and not the same class, else
 * NotStricter — a same-class raise would only restart preparation, which
 * would be an indefinite delay lever), and EVERY operation in the payload
 * must be permitted under it (else OperationNotPermitted, naming an index).
 *
 * All three are readable, so the list is computed rather than guessed, and an
 * ineligible class is shown disabled with the reason instead of being hidden
 * — a member should see that Charter exists and why it is not on offer.
 */
export function useRaiseClassOptions(classRegistry?: Address, proposal?: ProposalSummary) {
  const [options, setOptions] = useState<RaiseClassOption[]>([])
  const [loading, setLoading] = useState(false)

  const proposalId = proposal?.core.id
  const currentClass = proposal?.core.classId

  useEffect(() => {
    if (!classRegistry || !proposal || proposalId === undefined || currentClass === undefined) { setOptions([]); return }
    let cancelled = false
    setLoading(true)
    const read = (functionName: string, args: readonly unknown[]) =>
      publicClient.readContract({ address: classRegistry, abi: GovernanceClassRegistryABI, functionName, args } as never)

    Promise.all(CLASS_NAMES.map(async (name, classId): Promise<RaiseClassOption> => {
      try {
        const params = normalizeClassParams(await read('classParams', [classId]))
        if (!params.thresholdDen) return { classId, name, eligible: false, blockedBy: 'not a registered class' }
        if (classId === currentClass) return { classId, name, eligible: false, blockedBy: 'the proposal is already this class', params }
        const stricter = await read('isAtLeastAsStrict', [classId, currentClass]) as boolean
        if (!stricter) return { classId, name, eligible: false, blockedBy: 'not stricter than the current class', params }
        // isPermittedFor threads the proposal id through so the upgradeAndCall
        // drain rule can exclude this proposal — isPermitted would answer a
        // slightly different question than the one raiseClass asks.
        const permitted = await Promise.all(proposal.operations.map((operation) =>
          read('isPermittedFor', [classId, operation, proposalId]) as Promise<boolean>))
        const failed = permitted.indexOf(false)
        if (failed !== -1) return { classId, name, eligible: false, blockedBy: `operation ${failed + 1} is not permitted under it`, params }
        return { classId, name, eligible: true, params }
      } catch (error) {
        return { classId, name, eligible: false, blockedBy: error instanceof Error && /UnknownClass/.test(error.message) ? 'not a registered class' : 'could not be checked' }
      }
    })).then((result) => { if (!cancelled) setOptions(result) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [classRegistry, proposal, proposalId, currentClass])

  return { options, loading }
}
