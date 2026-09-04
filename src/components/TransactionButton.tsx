import { useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import type { Abi, Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import { publicClient } from '@/config/clients'
import { useWallet } from '@/config/WalletContext'
import { errorMessage, throttleBackoffMs } from '@/lib/governance'
import { explorerTx } from '@/lib/rpc'
import { Button } from './Button'

export function TransactionButton({ address, abi, functionName, args, value, children, variant = 'primary', disabled, onConfirmed }: {
  address?: Address
  /** defaults to GovernanceVoting; pass another ABI to call a different contract
   *  (a validator wallet's govCastVote passthrough, for instance) */
  abi?: Abi
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
  const [retrying, setRetrying] = useState(0)
  const submit = async () => {
    if (!address) return
    setPending(true); setError(''); setHash(undefined); setRetrying(0)
    try {
      let transactionHash: `0x${string}` | undefined
      // The testnet node throttles eth_sendRawTransaction under load and
      // answers with the delay it wants. Honour it rather than making the user
      // read an error and click again — but only a few times, and only for
      // THIS refusal: anything else is a real answer about the call.
      // The signature is consumed by the failed send, so each retry re-prompts
      // the wallet; the button says so while it is waiting.
      for (let attempt = 0; ; attempt += 1) {
        try {
          transactionHash = await writeContract({ address, abi: (abi ?? GovernanceVotingABI) as Abi, functionName, args, value })
          break
        } catch (sendError) {
          const backoff = throttleBackoffMs(sendError)
          if (backoff === undefined || attempt >= 2) throw sendError
          setRetrying(attempt + 1)
          await new Promise((resolve) => setTimeout(resolve, Math.max(backoff, 250) + 150))
        }
      }
      setRetrying(0)
      setHash(transactionHash)
      await publicClient.waitForTransactionReceipt({ hash: transactionHash!, confirmations: 1 })
      await onConfirmed?.()
    } catch (error) { setError(errorMessage(error)) }
    finally { setPending(false); setRetrying(0) }
  }
  return <div className="transaction-action"><Button variant={variant} onClick={() => void submit()} disabled={disabled || pending || !address || !isConnected}>{pending ? <><LoaderCircle className="spin" size={16} /> {retrying > 0 ? `Node busy — retry ${retrying} of 2…` : 'Confirming…'}</> : hash ? <><Check size={16} /> Confirmed</> : children}</Button>{hash && <a className="tx-link" href={explorerTx(hash)} target="_blank" rel="noreferrer">View transaction</a>}{error && <div className="error-box compact">{error}</div>}</div>
}
