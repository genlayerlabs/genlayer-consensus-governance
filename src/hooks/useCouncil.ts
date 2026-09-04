import { useCallback, useEffect, useState } from 'react'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
import SecurityCouncilABI from '@/abi/SecurityCouncil.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import type { CouncilMember, CouncilOverview, FreezeState } from '@/lib/types'

/**
 * Roster, thresholds and freeze state for the Security Council.
 *
 * Everything here is a direct read — `members()` returns the whole roster in
 * one call, so no log scan and no enumeration workaround is needed. The
 * publicClient batches multicall, so the whole Promise.all collapses into few
 * requests.
 */
export function useCouncil() {
  const { currentSet } = useContracts()
  const [overview, setOverview] = useState<CouncilOverview>()
  const [freeze, setFreeze] = useState<FreezeState>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!currentSet?.council) { setOverview(undefined); setFreeze(undefined); return }
    const council = currentSet.council
    const clock = currentSet.clock
    setLoading(true); setError(undefined)
    try {
      const read = (address: `0x${string}`, abi: unknown, functionName: string, args: unknown[] = []) =>
        publicClient.readContract({ address, abi, functionName, args } as never)

      const [rawMembers, counts, rawThresholds, version, actionable, activation, accept] = await Promise.all([
        read(council, SecurityCouncilABI, 'members'),
        read(council, SecurityCouncilABI, 'seatCount'),
        read(council, SecurityCouncilABI, 'thresholds'),
        read(council, SecurityCouncilABI, 'membershipVersion'),
        read(council, SecurityCouncilABI, 'actionableSeatCount'),
        read(council, SecurityCouncilABI, 'activationWindow'),
        read(council, SecurityCouncilABI, 'acceptWindow'),
      ]) as [any[], [number, number], [number, number, { soft: number; hard: number }], bigint | number, number, bigint | number, bigint | number]

      // The array INDEX is the seat id — every event and every seat-keyed call
      // uses it, and there is no address→seat getter to cross-check against.
      const members: CouncilMember[] = rawMembers.map((entry: any, seat: number) => ({
        seat,
        address: entry.addr,
        cohortId: Number(entry.cohortId),
        termEnd: Number(entry.termEnd),
        electionId: BigInt(entry.electionId),
        status: Number(entry.status),
      }))

      setOverview({
        members,
        seated: Number(counts[0]),
        target: Number(counts[1]),
        actionable: Number(actionable),
        membershipVersion: BigInt(version as never),
        thresholds: {
          standard: Number(rawThresholds[0]),
          emergency: Number(rawThresholds[1]),
          freezeSoft: Number(rawThresholds[2].soft),
          freezeHard: Number(rawThresholds[2].hard),
        },
        // BigInt(): viem decodes uint48 as a NUMBER, so these are not bigints
        // however they are annotated — arithmetic on them throws otherwise.
        activationWindow: BigInt(activation as never),
        acceptWindow: BigInt(accept as never),
      })

      if (clock) {
        const [stop, generation, windowUsed, softCap, hardCap, hardCooldown, budget] = await Promise.all([
          read(clock, GovernanceClockABI, 'stopState'),
          read(clock, GovernanceClockABI, 'freezeGeneration'),
          read(clock, GovernanceClockABI, 'windowFrozenSeconds'),
          read(clock, GovernanceClockABI, 'SOFT_CAP'),
          read(clock, GovernanceClockABI, 'HARD_CAP'),
          read(clock, GovernanceClockABI, 'HARD_COOLDOWN'),
          read(clock, GovernanceClockABI, 'WINDOW_BUDGET'),
        ]) as [any[], bigint | number, bigint | number, bigint | number, bigint | number, bigint | number, bigint | number]
        setFreeze({
          freezeActive: Boolean(stop[0]),
          freezeKind: Number(stop[1]),
          freezeEnd: BigInt(stop[2] as never),
          maintenanceActive: Boolean(stop[3]),
          frozenTotal: BigInt(stop[4] as never),
          generation: BigInt(generation as never),
          windowUsed: BigInt(windowUsed as never),
          windowBudget: BigInt(budget as never),
          softCap: BigInt(softCap as never),
          hardCap: BigInt(hardCap as never),
          hardCooldown: BigInt(hardCooldown as never),
        })
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [currentSet])

  useEffect(() => { void refresh() }, [refresh])
  return { overview, freeze, loading, error, refresh }
}
