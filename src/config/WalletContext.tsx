import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createWalletClient, custom, getAddress, numberToHex, type Abi, type Address, type Hex } from 'viem'
import { genlayerTestnet } from './chain'

interface InjectedProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, listener: (...args: any[]) => void) => void
  removeListener?: (event: string, listener: (...args: any[]) => void) => void
}

interface WalletState {
  address?: Address
  chainId?: number
  isConnected: boolean
  isAvailable: boolean
  connecting: boolean
  switching: boolean
  error?: string
  connect: () => Promise<void>
  disconnect: () => void | Promise<void>
  switchAccount: () => Promise<void>
  switchChain: () => Promise<void>
  writeContract: (request: { address: Address; abi: Abi | readonly unknown[]; functionName: string; args: readonly unknown[]; value?: bigint }) => Promise<Hex>
}

const WalletContext = createContext<WalletState | undefined>(undefined)

function injected() {
  return (window as typeof window & { ethereum?: InjectedProvider }).ethereum
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address>()
  const [chainId, setChainId] = useState<number>()
  const [connecting, setConnecting] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string>()
  const provider = injected()

  const sync = useCallback(async () => {
    const current = injected()
    if (!current) return
    const [accounts, chain] = await Promise.all([current.request({ method: 'eth_accounts' }) as Promise<string[]>, current.request({ method: 'eth_chainId' }) as Promise<string>])
    setAddress(accounts[0] ? getAddress(accounts[0]) : undefined)
    setChainId(Number.parseInt(chain, 16))
  }, [])

  useEffect(() => {
    void sync()
    const current = injected()
    const accountsChanged = (accounts: string[]) => setAddress(accounts[0] ? getAddress(accounts[0]) : undefined)
    const chainChanged = (chain: string) => setChainId(Number.parseInt(chain, 16))
    current?.on?.('accountsChanged', accountsChanged)
    current?.on?.('chainChanged', chainChanged)
    return () => { current?.removeListener?.('accountsChanged', accountsChanged); current?.removeListener?.('chainChanged', chainChanged) }
  }, [sync])

  const connect = async () => {
    const current = injected()
    if (!current) { setError('No injected EIP-1193 wallet was found. Install or enable a browser wallet.'); return }
    setConnecting(true); setError(undefined)
    try { await current.request({ method: 'eth_requestAccounts' }); await sync() }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setConnecting(false) }
  }

  /**
   * Re-open the wallet's account picker.
   *
   * `eth_requestAccounts` resolves silently with the already-permitted
   * account, so "Connect wallet" could never reach a DIFFERENT one — the
   * only escape was editing site permissions by hand. `wallet_requestPermissions`
   * re-prompts, which is the account-switch affordance.
   */
  const switchAccount = async () => {
    const current = injected()
    if (!current) { setError('No injected EIP-1193 wallet was found. Install or enable a browser wallet.'); return }
    setConnecting(true); setError(undefined)
    try {
      await current.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
      await sync()
    } catch (error: any) {
      // 4001 is the user closing the picker — not a failure worth reporting.
      if (error?.code !== 4001) setError(error instanceof Error ? error.message : String(error))
    } finally { setConnecting(false) }
  }

  const disconnect = async () => {
    // Clearing local state alone leaves the site permitted, so the next
    // connect silently reattaches the same account. Revoke where supported
    // (best-effort: not every wallet implements wallet_revokePermissions).
    const current = injected()
    try { await current?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }) } catch { /* unsupported */ }
    setAddress(undefined); setError(undefined)
  }

  const switchChain = async () => {
    const current = injected()
    if (!current) return
    setSwitching(true); setError(undefined)
    try {
      await current.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(genlayerTestnet.id) }] })
      await sync()
    } catch (error: any) {
      if (error?.code !== 4902) { setError(error instanceof Error ? error.message : String(error)); setSwitching(false); return }
      try {
        await current.request({ method: 'wallet_addEthereumChain', params: [{ chainId: numberToHex(genlayerTestnet.id), chainName: genlayerTestnet.name, nativeCurrency: genlayerTestnet.nativeCurrency, rpcUrls: genlayerTestnet.rpcUrls.default.http, blockExplorerUrls: genlayerTestnet.blockExplorers ? [genlayerTestnet.blockExplorers.default.url] : [] }] })
        await sync()
      } catch (nested) { setError(nested instanceof Error ? nested.message : String(nested)) }
    } finally { setSwitching(false) }
  }

  const writeContract: WalletState['writeContract'] = async (request) => {
    const current = injected()
    if (!current || !address) throw new Error('Connect an injected wallet before submitting a transaction.')
    if (chainId !== genlayerTestnet.id) throw new Error(`Switch the wallet to ${genlayerTestnet.name}.`)
    const walletClient = createWalletClient({ account: address, chain: genlayerTestnet, transport: custom(current as any) })
    return walletClient.writeContract({ ...request, abi: request.abi as Abi } as any)
  }

  const value = { address, chainId, isConnected: !!address, isAvailable: !!provider, connecting, switching, error, connect, disconnect, switchAccount, switchChain, writeContract }
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

// The provider and its colocated hook intentionally share this module.
// eslint-disable-next-line react-refresh/only-export-components
export function useWallet() {
  const value = useContext(WalletContext)
  if (!value) throw new Error('useWallet must be used inside WalletProvider')
  return value
}
