import { createRoot } from 'react-dom/client'
import App from './App'
import Projection from './Stage'
import './styles.css'
import './admin-theme.css'
createRoot(document.getElementById('root')!).render(
  location.pathname === '/stage' ? <Projection /> : <App />,
)
