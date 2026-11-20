import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { LandingView } from './components/landing/LandingView.tsx';
import { navigate, usePath } from './lib/nav';
import './index.css';
import './landing.css';

const APP_PATHS = ['/app', '/login', '/register'];

function Root() {
  const path = usePath();
  const isApp = APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (isApp) return <App />;
  return <LandingView onEnter={() => navigate('/login')} onRegister={() => navigate('/register')} />;
}

createRoot(document.getElementById('root')!).render(<Root />);
