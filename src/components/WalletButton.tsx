import { LogOut, Wallet } from 'lucide-react'
import { genlayerTestnet } from '@/config/chain'
import { useWallet } from '@/config/WalletContext'
import { shortAddress } from '@/lib/governance'
import { Button } from './Button'

export function WalletButton() {
  const { address, isConnected, chainId, connect, disconnect, switchAccount, switchChain, connecting, switching, isAvailable, error } = useWallet()
  if (isConnected && chainId !== genlayerTestnet.id) {
    return <Button onClick={() => void switchChain()} disabled={switching} title={error}>{switching ? 'Switching…' : 'Switch network'}</Button>
  }
  // Clicking the address re-opens the wallet's account picker: switching
  // accounts is the common intent, and it is unreachable through "Connect
  // wallet" because eth_requestAccounts resolves silently with the account
  // already permitted. Disconnect stays available as its own control.
  if (isConnected) return <span className="wallet-actions">
    <Button variant="secondary" onClick={() => void switchAccount()} disabled={connecting} title="Switch account">{connecting ? 'Switching…' : shortAddress(address)}</Button>
    <Button variant="ghost" onClick={() => void disconnect()} title="Disconnect wallet"><LogOut size={15} /></Button>
  </span>
  return <Button onClick={() => void connect()} disabled={connecting || !isAvailable} title={error ?? (!isAvailable ? 'No injected browser wallet found' : undefined)}><Wallet size={16} /> {connecting ? 'Connecting…' : 'Connect wallet'}</Button>
}
