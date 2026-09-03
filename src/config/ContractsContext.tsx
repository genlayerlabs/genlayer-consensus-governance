import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getAddress, isAddress, type Address, type Hex } from 'viem'
import AddressManagerABI from '@/abi/AddressManager.json'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
import { publicClient } from './clients'
import { deploymentConfig } from './chain'
import type { ContractSet } from '@/lib/types'
import { ZERO_ADDRESS } from '@/lib/governance'

const STORAGE_KEY = 'genlayer-governance-address-manager'

interface GovernanceContracts {
  addressManager?: Address
  voting?: Address
  votingPower?: Address
  currentContractsHash?: Hex
  currentSet?: ContractSet
  stopState?: {
    freezeActive: boolean
    freezeKind: number
    freezeEnd: number
    maintenanceActive: boolean
    frozenTotal: bigint
  }
  migrationActive?: boolean
  loading: boolean
  error?: string
  setAddressManager: (value: string) => void
  refresh: () => Promise<void>
}

const Context = createContext<GovernanceContracts | undefined>(undefined)

function normalizeSet(value: any): ContractSet {
  return {
    voting: value.voting, votingPower: value.votingPower, gesRegistry: value.gesRegistry,
    classRegistry: value.classRegistry, clock: value.clock, executor: value.executor,
    l1Bridge: value.l1Bridge, council: value.council, elections: value.elections,
  }
}

export function ContractsProvider({ children }: { children: ReactNode }) {
  const [addressManager, setAddressManagerState] = useState<Address | undefined>(() => {
    const value = localStorage.getItem(STORAGE_KEY)
    const configured = value || deploymentConfig.addressManager
    return configured && isAddress(configured) ? getAddress(configured) : undefined
  })
  const [state, setState] = useState<Omit<GovernanceContracts, 'setAddressManager' | 'refresh'>>({ loading: false })

  const refresh = useCallback(async () => {
    if (!addressManager) {
      setState({ loading: false })
      return
    }
    setState((current) => ({ ...current, loading: true, error: undefined, addressManager }))
    try {
      const bytecode = await publicClient.getBytecode({ address: addressManager })
      if (!bytecode) throw new Error('No contract is deployed at this AddressManager address.')
      const [voting, votingPower] = await Promise.all(['GovernanceVoting', 'GovernanceVotingPower'].map((key) =>
        publicClient.readContract({ address: addressManager, abi: AddressManagerABI, functionName: 'getAddress', args: [key] }) as Promise<Address>,
      ))
      if (voting === ZERO_ADDRESS || votingPower === ZERO_ADDRESS) throw new Error('This AddressManager does not contain the governance voting contracts.')
      const currentContractsHash = await publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'currentContractsHash' }) as Hex
      const setValue = await publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'contractSet', args: [currentContractsHash] })
      const currentSet = normalizeSet(setValue)
      if (currentSet.voting.toLowerCase() !== voting.toLowerCase()) throw new Error('The active ContractSet does not match the resolved GovernanceVoting contract.')
      const [stop, migrationActive] = await Promise.all([
        publicClient.readContract({ address: currentSet.clock, abi: GovernanceClockABI, functionName: 'stopState' }) as Promise<any>,
        publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'migrationInProgress' }) as Promise<boolean>,
      ])
      setState({
        addressManager, voting, votingPower, currentContractsHash, currentSet, migrationActive,
        stopState: {
          freezeActive: stop[0], freezeKind: Number(stop[1]), freezeEnd: Number(stop[2]),
          maintenanceActive: stop[3], frozenTotal: stop[4],
        },
        loading: false,
      })
    } catch (error) {
      setState({ addressManager, loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }, [addressManager])

  useEffect(() => { void refresh() }, [refresh])

  const setAddressManager = (value: string) => {
    if (!value.trim()) {
      localStorage.removeItem(STORAGE_KEY)
      setAddressManagerState(undefined)
      return
    }
    if (!isAddress(value)) throw new Error('Enter a valid AddressManager address.')
    const address = getAddress(value)
    localStorage.setItem(STORAGE_KEY, address)
    setAddressManagerState(address)
  }

  const context = useMemo(() => ({ ...state, setAddressManager, refresh }), [state, refresh])
  return <Context.Provider value={context}>{children}</Context.Provider>
}

// The provider and its colocated hook intentionally share this module.
// eslint-disable-next-line react-refresh/only-export-components
export function useContracts() {
  const value = useContext(Context)
  if (!value) throw new Error('useContracts must be used inside ContractsProvider')
  return value
}
