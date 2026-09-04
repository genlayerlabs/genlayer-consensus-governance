import { NavLink, Outlet } from 'react-router-dom'
import { Hexagon } from 'lucide-react'
import { useContracts } from '@/config/ContractsContext'
import { AddressManagerControl } from './AddressManagerControl'
import { WalletButton } from './WalletButton'
import { AccountSummary } from './AccountSummary'
import { deploymentConfig } from '@/config/chain'

export function Layout() {
  const { stopState, migrationActive, loading, error } = useContracts()
  return <div className="app-shell">
    <header className="header">
      <NavLink to="/" className="brand"><span className="brand-mark"><Hexagon size={22} /></span><span>GenLayer <b>Governance</b><small>POC</small></span></NavLink>
      <nav><NavLink to="/">Proposals</NavLink><NavLink to="/create">Create proposal</NavLink><NavLink to="/council">Security Council</NavLink><NavLink to="/elections">Elections</NavLink><NavLink to="/delegates">Delegation</NavLink></nav>
      <div className="header-actions"><AddressManagerControl /><WalletButton /></div>
    </header>
    {loading && <div className="global-banner">Resolving governance contracts…</div>}
    {error && <div className="global-banner danger">Deployment error: {error}</div>}
    {(stopState?.freezeActive || stopState?.maintenanceActive || migrationActive) && <div className="global-banner warning">
      {stopState?.maintenanceActive ? 'Governance maintenance is active.' : stopState?.freezeActive ? `Governance is frozen${stopState.freezeEnd ? ` until ${new Date(stopState.freezeEnd * 1000).toLocaleString()}` : ''}.` : 'Governance migration is active.'} Deadlines and writes may be paused.
    </div>}
    <AccountSummary />
    <main><Outlet /></main>
    <footer><span>Frontend-only POC · On-chain data</span><span>{deploymentConfig.chainName} · Chain {deploymentConfig.chainId}</span></footer>
  </div>
}
