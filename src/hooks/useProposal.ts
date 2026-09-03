import { useCallback, useEffect, useState } from 'react'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { fetchProposal } from './useProposals'
import type { ProposalSummary } from '@/lib/types'

export function useProposal(id?: bigint) {
  const { voting } = useContracts()
  const { address } = useWallet()
  const [proposal, setProposal] = useState<ProposalSummary>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    if (!voting || !id || id <= 0n) return
    setLoading(true); setError(undefined)
    try { setProposal(await fetchProposal(voting, id, address)) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [voting, id, address])
  useEffect(() => { setProposal(undefined); void refresh() }, [refresh])
  return { proposal, loading, error, refresh }
}
