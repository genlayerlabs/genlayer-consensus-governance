import { useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import type { Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import { publicClient } from '@/config/clients'
import { useWallet } from '@/config/WalletContext'
import { errorMessage } from '@/lib/governance'
import { explorerTx } from '@/lib/rpc'
import { Button } from './Button'

export function TransactionButton({ address, functionName, args, value, children, variant = 'primary', disabled, onConfirmed }: {
  address?: Address
  functionName: string
  args: readonly unknown[]
  value?: bigint
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  disabled?: boolean
  onConfirmed?: () => void | Promise<void>
}) {
  const { isConnected, writeContract } = useWallet()
  const [pending, setPending] = useState(false)
  const [hash, setHash] = useState<`0x${string}`>()
  const [error, setError] = useState('')
  const submit = async () => {
    if (!address) return
    setPending(true); setError(''); setHash(undefined)
    try {
      const transactionHash = await writeContract({ address, abi: GovernanceVotingABI, functionName, args, value })
      setHash(transactionHash)
      await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 })
      await onConfirmed?.()
    } catch (error) { setError(errorMessage(error)) }
    finally { setPending(false) }
  }
  return <div className="transaction-action"><Button variant={variant} onClick={() => void submit()} disabled={disabled || pending || !address || !isConnected}>{pending ? <><LoaderCircle className="spin" size={16} /> Confirming…</> : hash ? <><Check size={16} /> Confirmed</> : children}</Button>{hash && <a className="tx-link" href={explorerTx(hash)} target="_blank" rel="noreferrer">View transaction</a>}{error && <div className="error-box compact">{error}</div>}</div>
}
