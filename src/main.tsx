import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import './index.css'
import App from './App.tsx'
// Last, deliberately: the small-screen layer re-arranges rules from App.css,
// explore.css and design.css, and relies on being later in the cascade.
import './mobile.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
