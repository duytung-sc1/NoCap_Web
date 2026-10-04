import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { IntroExperience } from './IntroExperience.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <IntroExperience />
  </StrictMode>,
)
