// src/App.tsx
// [F-ID: FE-APP-01]
// @version 1.4.0
// @changelog 1.4.0 — CreateResourceForm (POST /resources, owner-only) in
//   TenantWorkspace. Resources were previously seed-only; this makes the
//   ownership boundary visible directly in the UI — only an owner sees
//   the form to add a resource to their tenant.
// @changelog 1.3.0 — AddMemberForm now invites by email instead of raw
//   user id — an owner has the invitee's email, not their UUID. Removed
//   UserIdBadge (the "share your user id" card), which only existed to
//   support the userId-based flow.
// @changelog 1.2.0 — Self-service bootstrap flow: CreateTenantForm (POST
//   /tenants — becomes owner automatically) shown whenever the caller has
//   zero memberships, and AddMemberForm (POST /members, owner-only) in
//   TenantWorkspace so an owner can invite staff/viewer.
// @changelog 1.1.0 — Spanish-first i18n via react-i18next (see ./i18n).
//   All UI copy now goes through t(); domain/persisted string values
//   (role: 'owner'|'staff'|'viewer', status: 'confirmed'|'cancelled')
//   are intentionally NOT translated — only their display labels are.
//   Language switcher added to the Dashboard header.
// @changelog 1.0.0 — Initial dashboard: email/password auth, tenant
//   switcher (GET /tenants/me), resource + booking list for the active
//   tenant, create-booking form gated to owner/staff, cancel gated to
//   owner. Role read from the tenant object returned by /tenants/me —
//   the UI check is cosmetic only, the backend re-checks on every call.

import { useEffect, useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from './lib/supabase';
import { api, Tenant, Resource, Booking, MemberRole } from './lib/api';
import { setLanguage } from './i18n';

export default function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(!!sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === null) {
    return <Centered>{t('app.loading')}</Centered>;
  }

  return session ? <Dashboard /> : <AuthScreen />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      {children}
    </div>
  );
}

// ─── Language switcher ────────────────────────────────────────────────

function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button
        onClick={() => setLanguage('es')}
        style={i18n.language === 'es' ? primaryButtonStyle : ghostButtonStyle}
      >
        {t('language.es')}
      </button>
      <button
        onClick={() => setLanguage('en')}
        style={i18n.language === 'en' ? primaryButtonStyle : ghostButtonStyle}
      >
        {t('language.en')}
      </button>
    </div>
  );
}

// ─── Auth ──────────────────────────────────────────────────────────────

function AuthScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: authError } =
        mode === 'sign-in'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (authError) {
        setError(authError.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <div style={{ display: 'grid', gap: 12, justifyItems: 'end' }}>
        <LanguageSwitcher />
        <form
          onSubmit={handleSubmit}
          className="card"
          style={{ width: 320, display: 'grid', gap: 12 }}
        >
          <h1 style={{ fontSize: 18, margin: 0 }}>{t('app.title')}</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>
            {t('auth.subtitle')}
          </p>
          <input
            type="email"
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={inputStyle}
          />
          {error && (
            <p style={{ color: 'var(--color-error)', fontSize: 13, margin: 0 }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} style={primaryButtonStyle}>
            {mode === 'sign-in' ? t('auth.signIn') : t('auth.createAccount')}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            style={ghostButtonStyle}
          >
            {mode === 'sign-in'
              ? t('auth.switchToSignUp')
              : t('auth.switchToSignIn')}
          </button>
        </form>
      </div>
    </Centered>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────

function Dashboard() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reloadTenants(preferTenantId?: string) {
    try {
      const list = await api.listMyTenants();
      setTenants(list);
      if (preferTenantId && list.some((t) => t.id === preferTenantId)) {
        setActiveTenantId(preferTenantId);
      } else if (list.length > 0) {
        setActiveTenantId((current) =>
          current && list.some((t) => t.id === current) ? current : list[0].id,
        );
      }
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    reloadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTenant = tenants?.find((t) => t.id === activeTenantId) ?? null;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>{t('app.title')}</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <LanguageSwitcher />
          <button onClick={() => supabase.auth.signOut()} style={ghostButtonStyle}>
            {t('dashboard.signOut')}
          </button>
        </div>
      </header>

      {error && <p style={{ color: 'var(--color-error)' }}>{error}</p>}

      {tenants && tenants.length === 0 && (
        <>
          <p style={{ color: 'var(--text-2)' }}>{t('dashboard.noMemberships')}</p>
          <CreateTenantForm
            onCreated={(tenant) => reloadTenants(tenant.id)}
          />
        </>
      )}

      {tenants && tenants.length > 0 && (
        <>
          <div style={{ marginBottom: 20 }}>
            <label
              style={{ display: 'block', fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}
            >
              {t('dashboard.activeTenant')}
            </label>
            <select
              value={activeTenantId ?? ''}
              onChange={(e) => setActiveTenantId(e.target.value)}
              style={inputStyle}
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.role}
                </option>
              ))}
            </select>
          </div>

          {activeTenant && <TenantWorkspace tenant={activeTenant} />}

          <div style={{ marginTop: 20 }}>
            <CreateTenantForm
              onCreated={(tenant) => reloadTenants(tenant.id)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CreateTenantForm({ onCreated }: { onCreated: (tenant: Tenant) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tenant = await api.createTenant(name);
      setName('');
      onCreated(tenant);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      <h2 style={{ fontSize: 15, margin: 0 }}>{t('dashboard.createTenant.title')}</h2>
      <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>
        {t('dashboard.createTenant.subtitle')}
      </p>
      <input
        type="text"
        placeholder={t('dashboard.createTenant.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        style={inputStyle}
      />
      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: 13, margin: 0 }}>{error}</p>
      )}
      <button type="submit" disabled={busy} style={primaryButtonStyle}>
        {t('dashboard.createTenant.submit')}
      </button>
    </form>
  );
}

function TenantWorkspace({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation();
  const [resources, setResources] = useState<Resource[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canBook = tenant.role === 'owner' || tenant.role === 'staff';
  const canCancel = tenant.role === 'owner';

  async function reload() {
    try {
      const [r, b] = await Promise.all([
        api.listResources(tenant.id),
        api.listBookings(tenant.id),
      ]);
      setResources(r);
      setBookings(b);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.id]);

  const resourceName = (id: string) =>
    resources.find((r) => r.id === id)?.name ?? id;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <RoleBadge role={tenant.role} />

      {error && <p style={{ color: 'var(--color-error)' }}>{error}</p>}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>{t('workspace.resources')}</h2>
        {resources.length === 0 ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
            {t('workspace.noResources')}
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {resources.map((r) => (
              <li key={r.id} style={{ fontSize: 14 }}>
                {r.name}
                {r.capacity != null && (
                  <span style={{ color: 'var(--text-3)' }}>
                    {' '}
                    · {t('workspace.capacity', { count: r.capacity })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {tenant.role === 'owner' && (
        <CreateResourceForm tenantId={tenant.id} onCreated={reload} />
      )}

      {canBook && resources.length > 0 && (
        <CreateBookingForm
          tenantId={tenant.id}
          resources={resources}
          onCreated={reload}
        />
      )}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>{t('workspace.bookings')}</h2>
        {bookings.length === 0 ? (
          <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
            {t('workspace.noBookings')}
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
                <th style={thStyle}>{t('workspace.table.resource')}</th>
                <th style={thStyle}>{t('workspace.table.starts')}</th>
                <th style={thStyle}>{t('workspace.table.ends')}</th>
                <th style={thStyle}>{t('workspace.table.status')}</th>
                {canCancel && <th style={thStyle} />}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{resourceName(b.resourceId)}</td>
                  <td style={tdStyle}>{new Date(b.startsAt).toLocaleString()}</td>
                  <td style={tdStyle}>{new Date(b.endsAt).toLocaleString()}</td>
                  <td
                    style={tdStyle}
                    className={
                      b.status === 'confirmed' ? 'status-confirmed' : 'status-cancelled'
                    }
                  >
                    {b.status}
                  </td>
                  {canCancel && (
                    <td style={tdStyle}>
                      {b.status === 'confirmed' && (
                        <button
                          style={ghostButtonStyle}
                          onClick={async () => {
                            // Previously unguarded: a failed cancel (403,
                            // 500, network error) became a silently
                            // swallowed rejected promise — nothing showed
                            // in the UI and nothing was necessarily
                            // logged server-side either (AllExceptionsFilter
                            // only logs the 500 branch, not HttpExceptions).
                            try {
                              await api.cancelBooking(tenant.id, b.id);
                              await reload();
                            } catch (err) {
                              setError(String(err));
                            }
                          }}
                        >
                          {t('workspace.cancel')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {tenant.role === 'owner' && <AddMemberForm tenantId={tenant.id} />}
    </div>
  );
}

function CreateResourceForm({
  tenantId,
  onCreated,
}: {
  tenantId: string;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createResource(tenantId, {
        name,
        capacity: capacity ? Number(capacity) : undefined,
      });
      setName('');
      setCapacity('');
      onCreated();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ fontSize: 15, margin: 0 }}>{t('workspace.createResource.title')}</h2>
      <input
        type="text"
        placeholder={t('workspace.createResource.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        style={inputStyle}
      />
      <input
        type="number"
        min={1}
        placeholder={t('workspace.createResource.capacityPlaceholder')}
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
        style={inputStyle}
      />
      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: 13, margin: 0 }}>{error}</p>
      )}
      <button type="submit" disabled={busy} style={primaryButtonStyle}>
        {t('workspace.createResource.submit')}
      </button>
    </form>
  );
}

function AddMemberForm({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'viewer'>('staff');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setBusy(true);
    try {
      await api.addMember(tenantId, { email, role });
      setEmail('');
      setSuccess(true);
    } catch (err) {
      // 404 means no account exists for that email yet; 409 means that
      // user is already a member of this tenant (the (tenant_id, user_id)
      // unique constraint) — both surface as-is, which is enough context
      // for the owner to know what to do next.
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ fontSize: 15, margin: 0 }}>{t('workspace.addMember.title')}</h2>
      <input
        type="email"
        placeholder={t('workspace.addMember.emailPlaceholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        style={inputStyle}
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as 'staff' | 'viewer')}
        style={inputStyle}
      >
        <option value="staff">{t('workspace.addMember.roleStaff')}</option>
        <option value="viewer">{t('workspace.addMember.roleViewer')}</option>
      </select>
      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: 13, margin: 0 }}>{error}</p>
      )}
      {success && !error && (
        <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>
          {t('workspace.addMember.success')}
        </p>
      )}
      <button type="submit" disabled={busy} style={primaryButtonStyle}>
        {t('workspace.addMember.submit')}
      </button>
    </form>
  );
}

function CreateBookingForm({
  tenantId,
  resources,
  onCreated,
}: {
  tenantId: string;
  resources: Resource[];
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createBooking(tenantId, {
        resourceId,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      setStartsAt('');
      setEndsAt('');
      onCreated();
    } catch (err) {
      // A 409 here most often means the no_overlapping_bookings
      // exclusion constraint rejected the slot — surface it as-is.
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ fontSize: 15, margin: 0 }}>{t('bookingForm.title')}</h2>
      <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} style={inputStyle}>
        {resources.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
          style={{ ...inputStyle, flex: 1 }}
        />
        <input
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          required
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: 13, margin: 0 }}>{error}</p>
      )}
      <button type="submit" disabled={busy} style={primaryButtonStyle}>
        {t('bookingForm.submit')}
      </button>
    </form>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  return <span className={`badge badge-${role}`}>{role}</span>;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-input)',
  background: 'var(--surface)',
  color: 'var(--text-1)',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
};

const ghostButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-input)',
  background: 'transparent',
  color: 'var(--text-1)',
};

const thStyle: React.CSSProperties = { padding: '6px 8px', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '6px 8px' };
