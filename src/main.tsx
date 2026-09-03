import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ContractsProvider } from '@/config/ContractsContext'
import { WalletProvider } from '@/config/WalletContext'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><WalletProvider><ContractsProvider><App /></ContractsProvider></WalletProvider></StrictMode>)
