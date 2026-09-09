import { useCallback, useEffect, useState } from 'react'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { fetchProposal } from './useProposals'
import type { ProposalSummary } from '@/lib/types'

export function useProposal(id?: bigint) {
  const { book } = useContracts()
  const { address } = useWallet()
  const [proposal, setProposal] = useState<ProposalSummary>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    if (!book || !id || id <= 0n) return
    setLoading(true); setError(undefined)
    try { setProposal(await fetchProposal(book, id, address)) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [book, id, address])
  useEffect(() => { setProposal(undefined); void refresh() }, [refresh])
  return { proposal, loading, error, refresh }
}
