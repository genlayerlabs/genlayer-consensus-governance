import { useEffect, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import type { Abi, Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import { publicClient } from '@/config/clients'
import { useWallet } from '@/config/WalletContext'
import { errorMessage, throttleBackoffMs } from '@/lib/governance'
import { explorerTx } from '@/lib/rpc'
import { Button } from './Button'

export function TransactionButton({ address, abi, functionName, args, value, gasHeadroom = false, children, variant = 'primary', disabled, onConfirmed }: {
  address?: Address
  /** defaults to GovernanceVoting; pass another ABI to call a different contract
   *  (a validator wallet's govCastVote passthrough, for instance) */
  abi?: Abi
  functionName: string
  args: readonly unknown[]
  value?: bigint
  /**
   * Send with an explicit gas limit well above the node's estimate. Needed for
   * calls that CATCH their own failure — GovernanceVoting.execute runs the
   * operation batch in a self-call and records a failure instead of
   * reverting — because eth_estimateGas then finds the smallest gas at which
   * the outer call survives, which is exactly the gas at which the inner
   * batch runs out and is caught. Sent that way, the proposal reads
   * ProposalExecutionFailed and stays Queued. Seen on gov3 proposal 7.
   */
  gasHeadroom?: boolean
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  disabled?: boolean
  onConfirmed?: () => void | Promise<void>
}) {
  const { address: account, isConnected, writeContract } = useWallet()
  const [pending, setPending] = useState(false)
  const [hash, setHash] = useState<`0x${string}`>()
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(0)

  // "Confirmed" is a fact about the account that sent it. On a wallet switch
  // it becomes a lie — the new account has not done this, and on a council
  // action it is precisely the account whose turn it is to act. Clear the
  // result so the button offers itself again.
  useEffect(() => { setHash(undefined); setError(''); setRetrying(0) }, [account])
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
      let gas: bigint | undefined
      if (gasHeadroom) {
        // Twice the estimate, never under 1.5M: the estimate is the wrong
        // number by construction (see gasHeadroom), only its order of
        // magnitude is useful. Unused gas is refunded.
        try {
          const estimate = await publicClient.estimateContractGas({ address, abi: (abi ?? GovernanceVotingABI) as Abi, functionName, args, value, account } as never)
          gas = estimate * 2n > 1_500_000n ? estimate * 2n : 1_500_000n
        } catch { gas = 1_500_000n }
      }
      for (let attempt = 0; ; attempt += 1) {
        try {
          transactionHash = await writeContract({ address, abi: (abi ?? GovernanceVotingABI) as Abi, functionName, args, value, gas })
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
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash!, confirmations: 1 })
      // waitForTransactionReceipt resolves for a REVERTED transaction too — it
      // waits for mining, not for success. Without this check the button said
      // "Confirmed" over a failed council execution, which is the one place a
      // false success is most expensive: the action stays unconsumed and the
      // member walks away believing it landed.
      if (receipt.status !== 'success') {
        // The receipt carries no reason, so replay the same call at head to
        // recover one — the state that rejected it is still the live state.
        let reason = ''
        try {
          await publicClient.simulateContract({ address, abi: (abi ?? GovernanceVotingABI) as Abi, functionName, args, value, account } as never)
        } catch (replayError) { reason = errorMessage(replayError) }
        setHash(undefined)
        setError(reason || 'The transaction was mined but reverted. Nothing changed on-chain.')
        return
      }
      await onConfirmed?.()
    } catch (error) { setError(errorMessage(error)) }
    finally { setPending(false); setRetrying(0) }
  }
  return <div className="transaction-action"><Button variant={variant} onClick={() => void submit()} disabled={disabled || pending || !address || !isConnected}>{pending ? <><LoaderCircle className="spin" size={16} /> {retrying > 0 ? `Node busy — retry ${retrying} of 2…` : 'Confirming…'}</> : hash ? <><Check size={16} /> Confirmed</> : children}</Button>{hash && <a className="tx-link" href={explorerTx(hash)} target="_blank" rel="noreferrer">View transaction</a>}{error && <div className="error-box compact">{error}</div>}</div>
}
