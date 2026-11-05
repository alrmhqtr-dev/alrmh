import { StrictMode, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, Gift, History, LayoutDashboard, LogOut, Settings2, Shirt, Store, Users, UserCog } from 'lucide-react';
import '@fontsource/readex-pro/400.css';
import '@fontsource/readex-pro/500.css';
import '@fontsource/readex-pro/600.css';
import '@fontsource/aref-ruqaa/400.css';
import './styles.css';
import { AuthProvider, useAuth, type Role } from './lib/auth';
import { errorMessage } from './lib/api';
import { Field, Input, Loading, ToastProvider } from './ui';
import Overview from './pages/Overview';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Appointments from './pages/Appointments';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Catalogue from './pages/Catalogue';
import Branches from './pages/Branches';
import Settings from './pages/Settings';
import Rewards from './pages/Rewards';
import Staff from './pages/Staff';
import Audit from './pages/Audit';

const ALL: Role[] = ['owner', 'manager', 'tailor', 'support'];
const MANAGERS: Role[] = ['owner', 'manager'];

const NAV: { group: string; items: { to: string; label: string; icon: any; roles: Role[] }[] }[] = [
  {
    group: 'Operations',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, roles: ALL },
      { to: '/orders', label: 'Orders', icon: ClipboardList, roles: ALL },
      { to: '/appointments', label: 'Appointments', icon: CalendarDays, roles: ALL },
      { to: '/customers', label: 'Customers', icon: Users, roles: ALL },
    ],
  },
  {
    group: 'Setup',
    items: [
      { to: '/catalogue', label: 'Catalogue', icon: Shirt, roles: ALL },
      { to: '/branches', label: 'Branches & visits', icon: Store, roles: ALL },
      { to: '/settings', label: 'Fees & rules', icon: Settings2, roles: ALL },
      { to: '/rewards', label: 'Rewards & coupons', icon: Gift, roles: ALL },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/staff', label: 'Staff', icon: UserCog, roles: ['owner'] },
      { to: '/audit', label: 'Activity log', icon: History, roles: MANAGERS },
    ],
  },
];

function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card stack lg" onSubmit={submit}>
        <div className="stack" style={{ gap: 2, alignItems: 'center' }}>
          <div style={{ fontFamily: 'Aref Ruqaa', fontSize: 44, lineHeight: 1.2 }}>الرمح</div>
          <div className="overline" style={{ letterSpacing: 4 }}>AlRmh admin</div>
        </div>
        <Field label="Email">
          <Input data-testid="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </Field>
        <Field label="Password" error={error}>
          <Input data-testid="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn" data-testid="login-submit" disabled={busy} style={{ height: 46 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...roles) ? <>{children}</> : <Navigate to="/" replace />;
}

function Shell() {
  const { staff, ready, logout, can } = useAuth();
  if (!ready) return <Loading />;
  if (!staff) return <Login />;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="ar">الرمح</span>
          <span className="en">ADMIN</span>
        </div>
        {NAV.map((g) => {
          const items = g.items.filter((i) => can(...i.roles));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="nav-label">{g.group}</div>
              <nav className="nav">
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} data-testid={`nav-${i.to.slice(1) || 'overview'}`}>
                    <i.icon size={17} />
                    {i.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          );
        })}
        <div className="who">
          <div style={{ color: '#fff', fontWeight: 500 }}>{staff.name}</div>
          <div style={{ textTransform: 'capitalize', marginBottom: 8 }}>{staff.role}</div>
          <button className="btn sm secondary" onClick={logout} data-testid="logout">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/catalogue" element={<Catalogue />} />
          <Route path="/branches" element={<Branches />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/staff" element={<Guard roles={['owner']}><Staff /></Guard>} />
          <Route path="/audit" element={<Guard roles={MANAGERS}><Audit /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Shell />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
