import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
const App = lazy(() => import('./App'))
import Projection from './Stage'
import './styles.css'
import './admin-theme.css'
createRoot(document.getElementById('root')!).render(
  location.pathname === '/stage' ? (
    <Projection />
  ) : (
    <Suspense fallback={<div className="loading-screen">正在准备茶话会…</div>}>
      <App />
    </Suspense>
  ),
)
