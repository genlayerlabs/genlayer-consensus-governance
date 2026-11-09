import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getAddress, isAddress, type Address, type Hex } from 'viem'
import AddressManagerABI from '@/abi/AddressManager.json'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
import { publicClient } from './clients'
import { deploymentConfig } from './chain'
import { ZERO_ADDRESS } from '@/lib/governance'
import { isPresent, tryRead } from '@/lib/optionalRead'
import { resolveGovernanceIdentities, type BookEntry, type GovernanceIdentities, type GovernanceKey, type SealStatus } from '@/lib/sealedIdentities'
import { fetchNetworksIndex, pickDeployment, storedValue, type NetworkDeployment } from './networksRepo'

/** The AddressManager in use: a genlayer-networks folder's, or one typed by the visitor. */
const STORAGE_KEY = 'genlayer-governance-address-manager'
/** Folder name of the genlayer-networks deployment in use; absent for a typed AddressManager. */
const DEPLOYMENT_STORAGE_KEY = 'genlayer-governance-deployment'

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
  /** Folders of genlayerlabs/genlayer-networks, newest first */
  deployments: NetworkDeployment[]
  /** Folder name of the selected deployment; undefined for a typed AddressManager */
  selectedDeployment?: string
  deploymentsLoading: boolean
  deploymentsError?: string
  /** Use a genlayer-networks folder */
  selectDeployment: (name: string) => void
  /** Use a typed AddressManager (or clear with an empty string) */
  setAddressManager: (value: string) => void
  /** Re-read the folder list from genlayer-networks, bypassing caches */
  refreshDeployments: () => void
  refresh: () => Promise<void>
}

const Context = createContext<GovernanceContracts | undefined>(undefined)

export function ContractsProvider({ children }: { children: ReactNode }) {
  // What the browser remembers: a folder name and/or an AddressManager. The folder
  // wins while it still exists in genlayer-networks; a stored address without a
  // folder is one the visitor typed. Nothing stored: the newest folder, once the
  // list has loaded (deploymentConfig.addressManager only when the list cannot be read).
  const [selectedDeployment, setSelectedDeployment] = useState<string | undefined>(
    () => storedValue.get(DEPLOYMENT_STORAGE_KEY) ?? undefined,
  )
  const [addressManager, setAddressManagerState] = useState<Address | undefined>(() => {
    const value = storedValue.get(STORAGE_KEY)
    return value && isAddress(value) ? getAddress(value) : undefined
  })
  const [deployments, setDeployments] = useState<NetworkDeployment[]>([])
  const [deploymentsLoading, setDeploymentsLoading] = useState(true)
  const [deploymentsError, setDeploymentsError] = useState<string | undefined>()
  const [indexGeneration, setIndexGeneration] = useState(0)
  const fresh = useRef(false)

  useEffect(() => {
    let cancelled = false
    const opts = { fresh: fresh.current }
    fresh.current = false
    setDeploymentsLoading(true)
    setDeploymentsError(undefined)
    fetchNetworksIndex(opts)
      .then((index) => {
        if (cancelled) return
        setDeployments(index.deployments)
        // An address stored without a folder (typed, or chosen before the folder
        // list existed) is adopted as its folder when one lists that
        // AddressManager, and left alone otherwise.
        const storedAddress = storedValue.get(STORAGE_KEY)
        const typed = !selectedDeployment && !!storedAddress
        const matching = typed
          ? index.deployments.find((d) => d.addressManager.toLowerCase() === storedAddress!.toLowerCase())
          : undefined
        if (typed && !matching) return
        const deployment = pickDeployment(index, matching?.name ?? selectedDeployment)
        if (!deployment) {
          setDeploymentsError('genlayer-networks lists no deployment folder')
          return
        }
        const address = getAddress(deployment.addressManager)
        storedValue.set(DEPLOYMENT_STORAGE_KEY, deployment.name)
        storedValue.set(STORAGE_KEY, address)
        setSelectedDeployment(deployment.name)
        setAddressManagerState(address)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDeploymentsError(error instanceof Error ? error.message : String(error))
        // Without the list, fall back to the configured AddressManager for a first visit.
        if (!storedValue.get(STORAGE_KEY) && deploymentConfig.addressManager && isAddress(deploymentConfig.addressManager)) {
          setAddressManagerState(getAddress(deploymentConfig.addressManager))
        }
      })
      .finally(() => {
        if (!cancelled) setDeploymentsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexGeneration])

  const [state, setState] = useState<Pick<GovernanceContracts, 'addressManager' | 'voting' | 'votingPower' | 'vestingFactory' | 'book' | 'bookEntries' | 'seal' | 'stopState' | 'loading' | 'error'>>({ loading: false })

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

  const selectDeployment = (name: string) => {
    const deployment = deployments.find((d) => d.name === name)
    if (!deployment) throw new Error(`Unknown deployment folder: ${name}`)
    const address = getAddress(deployment.addressManager)
    storedValue.set(DEPLOYMENT_STORAGE_KEY, deployment.name)
    storedValue.set(STORAGE_KEY, address)
    setSelectedDeployment(deployment.name)
    setAddressManagerState(address)
  }

  const setAddressManager = (value: string) => {
    if (!value.trim()) {
      storedValue.set(DEPLOYMENT_STORAGE_KEY, null)
      storedValue.set(STORAGE_KEY, null)
      setSelectedDeployment(undefined)
      setAddressManagerState(undefined)
      return
    }
    if (!isAddress(value)) throw new Error('Enter a valid AddressManager address.')
    const address = getAddress(value)
    // A typed address that matches a listed folder is that folder.
    const match = deployments.find((d) => d.addressManager.toLowerCase() === address.toLowerCase())
    storedValue.set(DEPLOYMENT_STORAGE_KEY, match ? match.name : null)
    storedValue.set(STORAGE_KEY, address)
    setSelectedDeployment(match?.name)
    setAddressManagerState(address)
  }

  const refreshDeployments = () => {
    fresh.current = true
    setIndexGeneration((g) => g + 1)
  }

  const context = useMemo(
    () => ({ ...state, deployments, selectedDeployment, deploymentsLoading, deploymentsError, selectDeployment, setAddressManager, refreshDeployments, refresh }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, deployments, selectedDeployment, deploymentsLoading, deploymentsError, refresh],
  )
  return <Context.Provider value={context}>{children}</Context.Provider>
}

// The provider and its colocated hook intentionally share this module.
// eslint-disable-next-line react-refresh/only-export-components
export function useContracts() {
  const value = useContext(Context)
  if (!value) throw new Error('useContracts must be used inside ContractsProvider')
  return value
}
