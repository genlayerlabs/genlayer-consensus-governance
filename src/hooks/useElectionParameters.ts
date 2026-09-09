import { useCallback, useEffect, useState } from 'react'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { tryRead, type OptionalRead } from '@/lib/optionalRead'

const abi = GovernanceCouncilElectionsABI as never

export interface ElectionEconomics { candidateBond: bigint; registrationFee: bigint; storageFeePerByte: bigint }
export interface ElectionPeriods { registration: bigint; endorsement: bigint; preparation: bigint; voting: bigint }
export interface ElectionQuorums { quorumBps: number; quorumFloorBps: number; minSupportBps: number; refundFloorBps: number }
export interface RecallParameters { registration: bigint; endorsement: bigint; preparation: bigint; voting: bigint; cooldown: bigint; ratifyGrace: bigint }

export interface ElectionParameters {
  /** slateParameters() and recallParameters() predate CON-864 and always answer */
  slate?: { slateCap: number; alternates: number }
  recall?: RecallParameters
  /** the CON-864 getters: absent on a deployment that predates them */
  economics: OptionalRead<ElectionEconomics>
  periods: OptionalRead<ElectionPeriods>
  quorums: OptionalRead<ElectionQuorums>
  termLength: OptionalRead<bigint>
  loading: boolean
  refresh: () => Promise<void>
}

const pending = { unknown: new Error('not read yet') } as const

/**
 * The live §8 election parameters. The nomination economics are what a
 * nominate form needs to compute the exact msg.value; the rest is what a
 * visitor needs to read the rules without opening the spec.
 */
export function useElectionParameters(): ElectionParameters {
  const { book } = useContracts()
  const [state, setState] = useState<Omit<ElectionParameters, 'refresh'>>({ economics: pending, periods: pending, quorums: pending, termLength: pending, loading: false })

  const refresh = useCallback(async () => {
    const address = book?.elections
    if (!address) return
    setState((current) => ({ ...current, loading: true }))
    const read = (functionName: string) => publicClient.readContract({ address, abi, functionName } as never)
    const [slate, recall, economics, periods, quorums, termLength] = await Promise.all([
      read('slateParameters').then((value: any) => ({ slateCap: Number(value[0]), alternates: Number(value[1]) })).catch(() => undefined),
      read('recallParameters').then((value: any) => ({ registration: BigInt(value[0]), endorsement: BigInt(value[1]), preparation: BigInt(value[2]), voting: BigInt(value[3]), cooldown: BigInt(value[4]), ratifyGrace: BigInt(value[5]) })).catch(() => undefined),
      tryRead<any[]>({ address, abi, functionName: 'electionEconomics' }),
      tryRead<any[]>({ address, abi, functionName: 'electionPeriods' }),
      tryRead<any[]>({ address, abi, functionName: 'electionQuorums' }),
      tryRead<bigint | number>({ address, abi, functionName: 'termLength' }),
    ])
    setState({
      slate, recall, loading: false,
      economics: 'value' in economics ? { value: { candidateBond: BigInt(economics.value[0]), registrationFee: BigInt(economics.value[1]), storageFeePerByte: BigInt(economics.value[2]) } } : economics,
      periods: 'value' in periods ? { value: { registration: BigInt(periods.value[0]), endorsement: BigInt(periods.value[1]), preparation: BigInt(periods.value[2]), voting: BigInt(periods.value[3]) } } : periods,
      quorums: 'value' in quorums ? { value: { quorumBps: Number(quorums.value[0]), quorumFloorBps: Number(quorums.value[1]), minSupportBps: Number(quorums.value[2]), refundFloorBps: Number(quorums.value[3]) } } : quorums,
      termLength: 'value' in termLength ? { value: BigInt(termLength.value) } : termLength,
    })
  }, [book])

  useEffect(() => { void refresh() }, [refresh])
  return { ...state, refresh }
}
