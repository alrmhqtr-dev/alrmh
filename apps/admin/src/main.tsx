import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Calculator, ChevronRight, KeyRound, Languages, LogOut, ShoppingCart } from 'lucide-react';
import '@fontsource/readex-pro/400.css';
import '@fontsource/readex-pro/500.css';
import '@fontsource/readex-pro/600.css';
import '@fontsource/aref-ruqaa/400.css';
import './styles.css';
import { AuthProvider, useAuth, type Perm } from './lib/auth';
import { api, errorMessage } from './lib/api';
import { L, t, useLang } from './lib/i18n';
import { date, todayQatar } from './lib/format';
import { Field, Input, Loading, Modal, PageErrorBoundary, PageHead, Tiles, ToastProvider, useToast } from './ui';
import { groups, quickNav, type NavGroup } from './nav';
import { RegisterPill } from './register';
import Home from './pages/Home';
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
import Pos from './pages/Pos';
import { Drafts, Registers, Returns, Sales, Shipments } from './pages/Sales';
import { MeasurementsList, TakeMeasurements } from './pages/Tailor';
import { FactoryInvoices, ThobePhotos } from './pages/Factory';
import Products from './pages/Products';
import { Adjustments, StockLevels, Suggestions, Transfers } from './pages/Stock';
import Labels from './pages/Labels';
import { PurchaseDetail, PurchaseForm, Purchases } from './pages/Purchases';
import { SupplierDetail } from './pages/Suppliers';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import { BusinessPage } from './pages/Business';
import Roles from './pages/Roles';
import Import from './pages/Import';
import { ListPage } from './pages/ListPage';
import { LISTS } from './lists';
import Print from './print/Print';

function LangSwitch({ dark }: { dark?: boolean }) {
  const lang = useLang();
  const { switchLanguage } = useAuth();
  return (
    <button className={dark ? 'btn sm secondary' : 'pill'} data-testid="lang-switch" onClick={() => switchLanguage(lang === 'ar' ? 'en' : 'ar')}>
      <Languages size={15} /> {lang === 'ar' ? 'English' : 'العربية'}
    </button>
  );
}

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
          <div className="overline" style={{ letterSpacing: 4 }}>{t('AlRmh admin & POS', 'الإدارة ونقطة البيع')}</div>
        </div>
        <Field label={t('Email', 'البريد الإلكتروني')}>
          <Input data-testid="login-email" type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </Field>
        <Field label={t('Password', 'كلمة المرور')} error={error}>
          <Input data-testid="login-password" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn" data-testid="login-submit" disabled={busy} style={{ height: 46 }}>
          {busy ? t('Signing in…', 'جارٍ الدخول…') : t('Sign in', 'تسجيل الدخول')}
        </button>
        <div className="row" style={{ justifyContent: 'center' }}><LangSwitch /></div>
      </form>
    </div>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (next !== again) return setError(t("The new passwords don't match.", 'كلمتا المرور الجديدتان غير متطابقتين.'));
    setBusy(true);
    setError(null);
    try {
      await api('/me/password', { body: { current, next } });
      toast(t('Password changed. Other devices were signed out.', 'تم تغيير كلمة المرور وتسجيل الخروج من الأجهزة الأخرى.'));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Change your password', 'تغيير كلمة المرور')}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button className="btn" data-testid="password-save" disabled={busy || !current || next.length < 10} onClick={save}>{t('Change password', 'تغيير كلمة المرور')}</button>
        </>
      }
    >
      <Field label={t('Current password', 'كلمة المرور الحالية')}><Input data-testid="password-current" type="password" dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></Field>
      <Field label={t('New password', 'كلمة المرور الجديدة')} hint={t('At least 10 characters.', '10 أحرف على الأقل.')}><Input data-testid="password-next" type="password" dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label={t('New password again', 'أعد كتابة كلمة المرور الجديدة')} error={error}><Input data-testid="password-again" type="password" dir="ltr" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
    </Modal>
  );
}

function Guard({ perms, children }: { perms: Perm[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...perms) ? <>{children}</> : <Navigate to="/" replace />;
}

/** A small calculator in the top bar, like Mada's. */
function Calc() {
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState('');
  const press = (k: string) => {
    if (k === 'C') return setExpr('');
    if (k === '=') {
      try {
        // Digits and + - * / . only, so evaluating it can't run anything else.
        if (!/^[\d+\-*/. ]+$/.test(expr)) return;
        const v = Function(`"use strict";return (${expr})`)();
        setExpr(Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '');
      } catch {
        setExpr('');
      }
      return;
    }
    setExpr((e) => (e + k).slice(0, 24));
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="pill" onClick={() => setOpen(!open)} aria-label={t('Calculator', 'الآلة الحاسبة')} data-testid="calc"><Calculator size={15} /></button>
      {open ? (
        <div className="calc">
          <div className="screen">{expr || '0'}</div>
          <div className="keys">
            {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', 'C', '+'].map((k) => (
              <button key={k} className={/[/*\-+C]/.test(k) ? 'op' : ''} onClick={() => press(k)}>{k === '*' ? '×' : k === '/' ? '÷' : k}</button>
            ))}
            <button className="eq" style={{ gridColumn: 'span 4' }} onClick={() => press('=')}>=</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SideGroup({ g, open, onToggle }: { g: NavGroup; open: boolean; onToggle: () => void }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const items = g.items.filter((i) => !i.perms || can(...i.perms));
  const here = loc.pathname + loc.search;
  const exact = items.some((i) => i.to === here);
  const active = (to: string) => to === here || (!exact && !to.includes('?') && to === loc.pathname);
  if (!items.length || (g.perms && !can(...g.perms))) return null;
  return (
    <div>
      <button className={`nav-group ${open ? 'open' : ''}`} data-testid={`group-${g.key}`} aria-expanded={open} onClick={() => { onToggle(); if (!open) nav(items.length === 1 ? items[0].to : `/m/${g.key}`); }}>
        <g.icon size={17} /> <span>{g.label}</span> {items.length > 1 ? <ChevronRight size={15} className="chev" /> : null}
      </button>
      {open && items.length > 1 ? (
        <div className="subnav">
          {items.map((i) => (
            <Link key={i.to} to={i.to} className={active(i.to) ? 'active' : undefined} aria-current={active(i.to) ? 'page' : undefined} data-testid={`nav-${i.to.slice(1).replace(/[/?=]/g, '-')}`}>{i.label}</Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuPage() {
  const { key } = useParams();
  const { can } = useAuth();
  const g = groups().find((x) => x.key === key);
  if (!g) return <Navigate to="/" replace />;
  return (
    <div className="stack lg">
      <PageHead title={g.label} />
      <Tiles items={g.items.map((i) => ({ ...i, hidden: Boolean(i.perms && !can(...i.perms)) }))} />
    </div>
  );
}

function Shell() {
  const { staff, ready, logout, can } = useAuth();
  const lang = useLang();
  const [changePassword, setChangePassword] = useState(false);
  const location = useLocation();
  const allGroups = groups();
  const current = allGroups.find((g) => g.items.some((i) => i.to.split('?')[0] === location.pathname && location.pathname !== '/'))?.key ?? null;
  const [openKey, setOpenKey] = useState<string | null>(current);
  useEffect(() => {
    if (current) setOpenKey(current);
  }, [current]);
  if (!ready) return <Loading />;
  if (location.pathname.startsWith('/print/')) return staff ? <Print /> : <Login />;
  if (!staff) return <Login />;
  return (
    <div className="shell" key={lang}>
      <aside className="side">
        <Link to="/" className="brand">
          <span className="ar">الرمح</span>
          <span className="en">{t('ADMIN · POS', 'الإدارة')}</span>
        </Link>
        <nav className="nav">
          {quickNav().filter((i) => !i.perms || can(...i.perms)).map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} data-testid={i.testid}>
              <i.icon size={17} />
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="nav-label">{t('Sections', 'الأقسام')}</div>
        {allGroups.map((g) => (
          <SideGroup key={g.key} g={g} open={openKey === g.key} onToggle={() => setOpenKey(openKey === g.key ? null : g.key)} />
        ))}
        <div className="who">
          <div style={{ color: '#fff', fontWeight: 500 }}>{staff.name}</div>
          <div style={{ marginBottom: 8 }}>{L({ name_en: staff.role_en ?? staff.role, name_ar: staff.role_ar ?? staff.role })}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm secondary" onClick={() => setChangePassword(true)} data-testid="change-password">
              <KeyRound size={14} /> {t('Password', 'كلمة المرور')}
            </button>
            <button className="btn sm secondary" onClick={logout} data-testid="logout">
              <LogOut size={14} /> {t('Sign out', 'خروج')}
            </button>
          </div>
        </div>
      </aside>
      {changePassword ? <PasswordModal onClose={() => setChangePassword(false)} /> : null}
      <div className="content">
        <header className="topbar no-print">
          {can('pos') ? (
            <Link to="/pos" className="pill" data-testid="top-pos"><ShoppingCart size={15} /> {t('POS screen', 'شاشة البيع')}</Link>
          ) : null}
          {can('pos') ? <RegisterPill /> : null}
          <Calc />
          <div className="spacer" />
          <span className="date">{date(todayQatar())}</span>
          <LangSwitch />
          <span className="strong small">{staff.name}</span>
        </header>
        <main className="main">
          <PageErrorBoundary key={location.pathname}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/m/:key" element={<MenuPage />} />
              <Route path="/pos" element={<Guard perms={['pos']}><Pos /></Guard>} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/appointments" element={<Appointments />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/branches" element={<Branches />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/:section" element={<BusinessPage />} />
              <Route path="/printing" element={<BusinessPage section="printing" />} />
              <Route path="/whatsapp" element={<BusinessPage section="whatsapp" />} />
              <Route path="/rewards" element={<Rewards />} />
              <Route path="/staff" element={<Guard perms={['staff']}><Staff /></Guard>} />
              <Route path="/roles" element={<Guard perms={['staff']}><Roles /></Guard>} />
              <Route path="/audit" element={<Guard perms={['audit']}><Audit /></Guard>} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/drafts" element={<Drafts kind="draft" />} />
              <Route path="/quotations" element={<Drafts kind="quotation" />} />
              <Route path="/returns" element={<Returns />} />
              <Route path="/shipments" element={<Shipments />} />
              <Route path="/registers" element={<Registers />} />
              <Route path="/tailor" element={<TakeMeasurements />} />
              <Route path="/tailor/measurements" element={<MeasurementsList />} />
              <Route path="/factory" element={<FactoryInvoices />} />
              <Route path="/factory/photos" element={<ThobePhotos />} />
              <Route path="/products" element={<Products />} />
              <Route path="/labels" element={<Labels />} />
              <Route path="/stock" element={<StockLevels />} />
              <Route path="/stock/adjustments" element={<Adjustments />} />
              <Route path="/stock/transfers" element={<Transfers />} />
              <Route path="/suggestions" element={<Suggestions />} />
              <Route path="/purchases" element={<Purchases />} />
              <Route path="/purchases/new" element={<Guard perms={['purchases']}><PurchaseForm /></Guard>} />
              <Route path="/purchases/:id" element={<PurchaseDetail />} />
              <Route path="/suppliers/:id" element={<SupplierDetail />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/reports" element={<Guard perms={['reports']}><Reports /></Guard>} />
              <Route path="/import" element={<Import />} />
              {Object.keys(LISTS).map((k) => (
                <Route key={k} path={`/${k}`} element={<ListPage name={k} />} />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PageErrorBoundary>
        </main>
      </div>
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
