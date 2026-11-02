import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { engineClient } from './engine/client';
import { useSettings } from './store';
import { Dashboard, Placeholder } from './pages/pages';
import RoutePlanner from './pages/RoutePlanner';
import Journey from './pages/Journey';
import MultiStop from './pages/MultiStop';
import Scenarios from './pages/Scenarios';

const LINKS = [
  ['/', 'Dashboard'],
  ['/route', 'Route Planner'],
  ['/journey', 'Journey'],
  ['/multistop', 'Multi-Stop'],
  ['/scenarios', 'Scenarios'],
  ['/lab', 'Lab'],
  ['/settings', 'Settings'],
] as const;

function Settings() {
  const { theme, toggleTheme } = useSettings();
  return (
    <div>
      <h2>Settings</h2>
      <p data-testid="theme-current">Theme: {theme}</p>
      <button className="pf-btn" onClick={toggleTheme} data-testid="theme-toggle">Toggle theme</button>
    </div>
  );
}

export default function App() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    // Boot the engine worker once; panel reads status via the shared client.
    engineClient.call('engine.info', {}, { channel: 'boot' }).catch(() => {});
  }, []);
  return (
    <div className="pf-shell">
      <header className="pf-header">
        <h1>PathForge AI</h1>
        <span className="pf-badge" role="note">SIMULATED DATA — NOT LIVE GPS OR TRAFFIC</span>
        <span className="spacer" />
      </header>
      <div className="pf-layout">
        <nav className="pf-nav" aria-label="Primary">
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="pf-main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/route" element={<RoutePlanner />} />
            <Route path="/journey" element={<Journey />} />
            <Route path="/multistop" element={<MultiStop />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/lab" element={<Placeholder title="Algorithm Laboratory" milestone="M10" />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
      <p id="PATHFORGE_SMOKE" hidden>PATHFORGE_SMOKE_READY</p>
    </div>
  );
}
