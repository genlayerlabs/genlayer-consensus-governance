import { Wallet } from 'lucide-react'
import { genlayerTestnet } from '@/config/chain'
import { useWallet } from '@/config/WalletContext'
import { shortAddress } from '@/lib/governance'
import { Button } from './Button'

export function WalletButton() {
  const { address, isConnected, chainId, connect, disconnect, switchChain, connecting, switching, isAvailable, error } = useWallet()
  if (isConnected && chainId !== genlayerTestnet.id) {
    return <Button onClick={() => void switchChain()} disabled={switching} title={error}>{switching ? 'Switching…' : 'Switch network'}</Button>
  }
  if (isConnected) return <Button variant="secondary" onClick={() => disconnect()} title="Disconnect wallet">{shortAddress(address)}</Button>
  return <Button onClick={() => void connect()} disabled={connecting || !isAvailable} title={error ?? (!isAvailable ? 'No injected browser wallet found' : undefined)}><Wallet size={16} /> {connecting ? 'Connecting…' : 'Connect wallet'}</Button>
}
