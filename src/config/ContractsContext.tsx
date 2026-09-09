import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getAddress, isAddress, type Address, type Hex } from 'viem'
import AddressManagerABI from '@/abi/AddressManager.json'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
import { publicClient } from './clients'
import { deploymentConfig } from './chain'
import { ZERO_ADDRESS } from '@/lib/governance'
import { isPresent, tryRead } from '@/lib/optionalRead'
import { resolveGovernanceIdentities, type BookEntry, type GovernanceIdentities, type GovernanceKey, type SealStatus } from '@/lib/sealedIdentities'

const STORAGE_KEY = 'genlayer-governance-address-manager'

interface GovernanceContracts {
  addressManager?: Address
  /** the book's GovernanceVoting — the entry point most hooks start from */
  voting?: Address
  /** the book's GovernanceVotingPower */
  votingPower?: Address
  /** the VestingFactory the AddressManager names, when it names one (CON-864 #8) */
  vestingFactory?: Address
  /**
   * The nine governance identities, resolved from the sealed AddressManager
   * by key (CON-865, spec §1.3). Fixed for the life of the deployment once
   * the book is sealed: there is no ContractSet, no activation and no
   * migration any more, so this is read once per AddressManager choice.
   */
  book?: GovernanceIdentities
  /** the same nine, row by row, for the sealed-identities view */
  bookEntries?: BookEntry[]
  /** what the AddressManager says about its seal; undefined where it has no `isSealed()` */
  seal?: SealStatus
  stopState?: {
    freezeActive: boolean
    freezeKind: number
    freezeEnd: number
    maintenanceActive: boolean
    frozenTotal: bigint
  }
  loading: boolean
  error?: string
  setAddressManager: (value: string) => void
  refresh: () => Promise<void>
}

const Context = createContext<GovernanceContracts | undefined>(undefined)

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
      const readKey = (key: GovernanceKey | 'VestingFactory') =>
        publicClient.readContract({ address: addressManager, abi: AddressManagerABI, functionName: 'getAddress', args: [key] }) as Promise<Address>
      // getAddress answers zero for a key that was never set: for the three
      // optional members that is "never selected"; for VestingFactory it
      // means a deployment with no vesting identities to offer.
      const [{ identities: book, entries: bookEntries }, vestingFactoryKey, sealed, commitment] = await Promise.all([
        resolveGovernanceIdentities(readKey),
        readKey('VestingFactory'),
        // Feature-detected: the seal views arrived with CON-865. A book that
        // predates them still resolves; it simply cannot vouch for itself.
        tryRead<boolean>({ address: addressManager, abi: AddressManagerABI as never, functionName: 'isSealed' }),
        tryRead<Hex>({ address: addressManager, abi: AddressManagerABI as never, functionName: 'manifestCommitment' }),
      ])
      const vestingFactory = vestingFactoryKey === ZERO_ADDRESS ? undefined : vestingFactoryKey
      const seal = isPresent(sealed) ? { sealed: sealed.value, manifestCommitment: isPresent(commitment) ? commitment.value : undefined } : undefined
      const stop = await publicClient.readContract({ address: book.clock, abi: GovernanceClockABI, functionName: 'stopState' }) as any
      setState({
        addressManager, voting: book.voting, votingPower: book.votingPower, vestingFactory, book, bookEntries, seal,
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
