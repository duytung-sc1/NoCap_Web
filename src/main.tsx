import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './AppErrorBoundary'
import { installVietnameseTextGuard } from './typography'

const stopTextGuard = installVietnameseTextGuard(document.getElementById('root')!)
if (import.meta.hot) import.meta.hot.dispose(stopTextGuard)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
)
