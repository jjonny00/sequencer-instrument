import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/layout.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let hasRefreshed = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasRefreshed) {
      return
    }
    hasRefreshed = true
    window.location.reload()
  })

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/service-worker.js', {
        type: 'module',
      })
    } catch (error) {
      console.error('Service worker registration failed:', error)
    }
  })
}
