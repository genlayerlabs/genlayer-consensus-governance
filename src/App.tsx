import { lazy, Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'

const ProposalsPage = lazy(() => import('@/pages/ProposalsPage').then((module) => ({ default: module.ProposalsPage })))
const CreateProposalPage = lazy(() => import('@/pages/CreateProposalPage').then((module) => ({ default: module.CreateProposalPage })))
const ProposalPage = lazy(() => import('@/pages/ProposalPage').then((module) => ({ default: module.ProposalPage })))

export default function App() {
  return <HashRouter><Suspense fallback={<div className="loading-state">Loading governance view…</div>}><Routes><Route element={<Layout />}><Route index element={<ProposalsPage />} /><Route path="create" element={<CreateProposalPage />} /><Route path="proposals/:proposalId" element={<ProposalPage />} /></Route></Routes></Suspense></HashRouter>
}
