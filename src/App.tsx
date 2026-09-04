import { lazyWithReload } from '@/lib/lazyWithReload'
import { Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'

const ProposalsPage = lazyWithReload(() => import('@/pages/ProposalsPage').then((module) => ({ default: module.ProposalsPage })))
const CreateProposalPage = lazyWithReload(() => import('@/pages/CreateProposalPage').then((module) => ({ default: module.CreateProposalPage })))
const CouncilPage = lazyWithReload(() => import('@/pages/CouncilPage').then((module) => ({ default: module.CouncilPage })))
const ProposalPage = lazyWithReload(() => import('@/pages/ProposalPage').then((module) => ({ default: module.ProposalPage })))

export default function App() {
  return <HashRouter><Suspense fallback={<div className="loading-state">Loading governance view…</div>}><Routes><Route element={<Layout />}><Route index element={<ProposalsPage />} /><Route path="create" element={<CreateProposalPage />} /><Route path="council" element={<CouncilPage />} /><Route path="proposals/:proposalId" element={<ProposalPage />} /></Route></Routes></Suspense></HashRouter>
}
