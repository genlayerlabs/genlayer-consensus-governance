import { lazyWithReload } from '@/lib/lazyWithReload'
import { Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'

const ProposalsPage = lazyWithReload(() => import('@/pages/ProposalsPage').then((module) => ({ default: module.ProposalsPage })))
const CreateProposalPage = lazyWithReload(() => import('@/pages/CreateProposalPage').then((module) => ({ default: module.CreateProposalPage })))
const CouncilPage = lazyWithReload(() => import('@/pages/CouncilPage').then((module) => ({ default: module.CouncilPage })))
const DelegatesPage = lazyWithReload(() => import('@/pages/DelegatesPage').then((module) => ({ default: module.DelegatesPage })))
const AddressProfilePage = lazyWithReload(() => import('@/pages/AddressProfilePage').then((module) => ({ default: module.AddressProfilePage })))
const ElectionsPage = lazyWithReload(() => import('@/pages/ElectionsPage').then((module) => ({ default: module.ElectionsPage })))
const ProposalPage = lazyWithReload(() => import('@/pages/ProposalPage').then((module) => ({ default: module.ProposalPage })))

export default function App() {
  return <HashRouter><Suspense fallback={<div className="loading-state">Loading governance view…</div>}><Routes><Route element={<Layout />}><Route index element={<ProposalsPage />} /><Route path="create" element={<CreateProposalPage />} /><Route path="council" element={<CouncilPage />} /><Route path="delegates" element={<DelegatesPage />} /><Route path="address/:address" element={<AddressProfilePage />} /><Route path="elections" element={<ElectionsPage />} /><Route path="proposals/:proposalId" element={<ProposalPage />} /></Route></Routes></Suspense></HashRouter>
}
