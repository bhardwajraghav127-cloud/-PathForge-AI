import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { engineClient } from './engine/client';
import { useSettings } from './store';
import { Toaster } from './components/ui';
import { Dashboard, Placeholder } from './pages/pages';
import RoutePlanner from './pages/RoutePlanner';
import SmartDemo from './pages/SmartDemo';
import Fleet from './pages/Fleet';
import Journey from './pages/Journey';
import MultiStop from './pages/MultiStop';
import Scenarios from './pages/Scenarios';
import Lab from './pages/Lab';

const LINKS = [
  ['/', 'Dashboard'],
  ['/demo', 'Smart Demo'],
  ['/fleet', 'Fleet'],
  ['/route', 'Route Planner'],
  ['/journey', 'Journey'],
  ['/multistop', 'Multi-Stop'],
  ['/scenarios', 'Scenarios'],
  ['/lab', 'Lab'],
  ['/settings', 'Settings'],
] as const;

function Settings() {
  const theme = useSettings((s) => s.theme);
  const toggleTheme = useSettings((s) => s.toggleTheme);
  const viva = useSettings((s) => s.viva);
  const toggleViva = useSettings((s) => s.toggleViva);
  return (
    <div>
      <h2>Settings</h2>
      <p data-testid="theme-current">Theme: {theme}</p>
      <button className="pf-btn" onClick={toggleTheme} data-testid="theme-toggle">Toggle theme</button>
      <p data-testid="viva-current">Professor/Viva Mode: {viva ? 'on' : 'off'}</p>
      <button className="pf-btn" onClick={toggleViva} data-testid="viva-toggle">
        {viva ? 'Disable Viva Mode' : 'Enable Viva Mode'}
      </button>
    </div>
  );
}

export default function App() {
  const theme = useSettings((s) => s.theme);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    // Boot the engine worker once; panels read status via the shared client.
    engineClient.call('engine.info', {}, { channel: 'boot' }).catch(() => {});
  }, []);
  useEffect(() => {
    setNavOpen(false); // close the drawer on navigation
  }, [location.pathname]);
  return (
    <div className="pf-shell">
      <a className="pf-skip" href="#main">Skip to content</a>
      <header className="pf-header">
        <button className="pf-btn small pf-hamburger" aria-label="Toggle navigation"
          aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)} data-testid="nav-toggle">
          ☰
        </button>
        <h1>PathForge AI</h1>
        <span className="pf-badge" role="note">SIMULATION — NOT LIVE GPS, DISPATCH OR TRAFFIC</span>
        <span className="spacer" />
      </header>
      <div className="pf-layout">
        <nav className={`pf-nav${navOpen ? ' open' : ''}`} aria-label="Primary">
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="pf-main" id="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/demo" element={<SmartDemo />} />
            <Route path="/fleet" element={<Fleet />} />
            <Route path="/route" element={<RoutePlanner />} />
            <Route path="/journey" element={<Journey />} />
            <Route path="/multistop" element={<MultiStop />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/lab" element={<Lab />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
      <Toaster />
      <p id="PATHFORGE_SMOKE" hidden>PATHFORGE_SMOKE_READY</p>
    </div>
  );
}
