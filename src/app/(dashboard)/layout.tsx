'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useSession } from '../session';
import { SUITE_LABELS } from '@/lib/types';
import type { SuiteCatalogue } from '@/lib/types';
import { projects as projectService, notifications as notificationsService } from '@/lib/services';
import type { ProjectOption, NotificationItem } from '@/lib/services';

/**
 * Dashboard shell.
 *
 * Layout mirrors the client prototype: dark brand rail on the left holding the
 * project scope switcher, the four service-line tabs and the module nav; a top
 * bar with search, notifications and the signed-in user; content on the right.
 *
 * The sidebar is driven by the API nav catalogue, not a hardcoded list. Adding
 * a module is a row in nav.seed.ts, never an edit here.
 */

// Suites available in the sidebar. All six stay in SUITE_ORDER for catalogue
// matching. The service suites (one per delivery stage) gate on the in-scope
// project's service selection; backoffice and shared are always on. See the
// disabledSuites memo below (CR-24).
const SUITE_ORDER = ['backoffice', 'shared', 'epc', 'pmc', 'eptp', 'om'];
// The four service suites map 1:1 onto the delivery stages a project can opt
// into. A suite is live only when its matching stage is selected for the
// project; the client never sees a line they did not buy.
const SERVICE_SUITES: ReadonlySet<string> = new Set(['epc', 'pmc', 'eptp', 'om']);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, catalogue, loading, logout, can } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const [activeSuite, setActiveSuite] = useState<string>('shared');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [scope, setScope] = useState('All projects');
  const [scopeProjects, setScopeProjects] = useState<ProjectOption[]>([]);
  const [bell, setBell] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  // The switcher lists only the projects the signed-in user may see. The list
  // comes from team membership when the user is on a team (the strict gate),
  // else from the legacy projectIds scope. Either way the API enforces it.
  //
  // The selected project is persisted to localStorage (keyed by user email) so
  // a reload restores the user's choice instead of snapping back to "All
  // projects". The default is the restored value, or a single-project scope,
  // or "All projects".
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const key = `kec.scope.${user.email}`;

    async function load(): Promise<void> {
      try {
        // Prefer team-scoped projects. A user on a team sees exactly those.
        const teamProjects = await projectService.myProjects();
        let rows: ProjectOption[];
        if (teamProjects.length > 0) {
          const full = await projectService.list();
          const teamIds = new Set(teamProjects.map((t) => t.id));
          rows = full.filter((p) => teamIds.has(p.id));
        } else {
          rows = await projectService.list();
        }

        if (cancelled) return;
        setScopeProjects(rows);

        // Restore the user's last choice if it still exists in scope.
        const saved =
          typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
        const restored = rows.find((p) => p.name === saved);
        const initial =
          restored?.name ??
          (rows.length === 1 ? rows[0].name : 'All projects');
        setScope(initial);
        window.localStorage.setItem(key, initial === 'All projects' ? '' : initial);
      } catch {
        if (!cancelled) {
          setScopeProjects([]);
          setScope('All projects');
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  function pickScope(name: string, projectId?: string): void {
    setScope(name);
    if (user) {
      const key = `kec.scope.${user.email}`;
      window.localStorage.setItem(key, name === 'All projects' ? '' : name);
    }
    // On a project page the sidebar pick and the URL are two views of the same
    // thing. The detail page keys off the URL id, so a dropdown choice must
    // rewrite that id or it shows the previous project. Pick a project → jump
    // to its detail URL; All projects → back to the list.
    const onProject = pathname === '/projects' || pathname.startsWith('/projects/');
    if (onProject) {
      if (name === 'All projects') router.push('/projects');
      else if (projectId) router.push(`/projects/${projectId}`);
    }
  }

  // The bell loads when the user signs in. Refresh on open so a new decision
  // posted while the page was idle shows up on next click.
  useEffect(() => {
    if (!user) return;
    void refreshBell();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function refreshBell() {
    try {
      const data = await notificationsService.bell(20);
      setBell(data.items);
      setUnread(data.unreadCount);
    } catch {
      setBell([]);
      setUnread(0);
    }
  }

  async function markAllRead() {
    await notificationsService.markAllRead();
    setUnread(0);
    setBell((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  // Open the suite that owns the current path so a deep link lands in the right
  // tab rather than always resetting to Common.
  useEffect(() => {
    const match = catalogue.find((s) =>
      s.groups.some((g) => g.items.some((i) => i.path === pathname)),
    );
    if (match) setActiveSuite(match.suite);
  }, [catalogue, pathname]);

  const ordered = useMemo(
    () =>
      SUITE_ORDER.map((key) => catalogue.find((s) => s.suite === key)).filter(
        (s): s is SuiteCatalogue => Boolean(s),
      ),
    [catalogue],
  );

  // CR-24: which service suites are live for the scope. A project's enabled
  // stages (from onboarding service selection, or a later scope change) gate
  // their matching suites. "All projects" is the union across every in-scope
  // project. backoffice and shared are never disabled — they carry the
  // cross-project and administrative modules.
  const disabledSuites = useMemo(() => {
    const projects =
      scope === 'All projects'
        ? scopeProjects
        : scopeProjects.filter((p) => p.name === scope);
    const live = new Set<string>();
    for (const p of projects) for (const stage of p.enabledStages ?? []) live.add(stage);
    const out = new Set<string>();
    for (const s of SERVICE_SUITES) if (!live.has(s)) out.add(s);
    return out;
  }, [scope, scopeProjects]);

  // If the active suite is disabled, fall back to the first enabled one so the
  // nav groups render. A user deep-linked to a /om/... route still gets a
  // working sidebar, just not the O&M pill.
  const activeRaw = ordered.find((s) => s.suite === activeSuite) ?? ordered[0];
  const active =
    !activeRaw
      ? undefined
      : disabledSuites.has(activeRaw.suite)
        ? ordered.find((s) => !disabledSuites.has(s.suite)) ?? activeRaw
        : activeRaw;

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center" style={{ background: 'var(--canvas)' }}>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Loading…
        </p>
      </div>
    );
  }

  if (!user) return null;

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[244px_1fr]">
      {/* ---- brand rail ---- */}
      <aside
        className="no-print flex flex-col lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto"
        style={{ background: 'var(--rail)', color: 'var(--rail-text)' }}
      >
        <div className="px-[18px] pt-[12px] pb-[2px]" style={{ borderBottom: '1px solid var(--rail-line)' }}>
          <div className="flex items-center gap-[10px]">
            <Image
              src="/images/logo/logo.png"
              alt="KEC Agritech logo"
              width={80}
              height={50}
              priority
              className="h-[50px] w-[80px] rounded-md object-contain"
            />
            <div>
              <h1 className="m-0 text-[15px] font-semibold tracking-tight text-white">
                KEC Agritech
              </h1>
              <p className="mt-[1px] text-[11px]" style={{ color: 'var(--rail-muted)' }}>
                Project Suite
              </p>
            </div>
          </div>
        </div>

        {/* project scope switcher */}
        <div className="px-3.5 py-[13px]" style={{ borderBottom: '1px solid var(--rail-line)' }}>
          <button
            type="button"
            onClick={() => setScopeOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-md px-[11px] py-[9px] text-left"
            style={{ background: 'var(--rail-2)', border: '1px solid var(--rail-line)', color: 'var(--rail-text)' }}
          >
            <span>
              <span className="mb-[1px] block text-[10px] uppercase tracking-wide" style={{ color: 'var(--rail-muted)' }}>
                Project
              </span>
              <span className="text-[13.5px] font-semibold" style={{ color: '#fff' }}>{scope}</span>
            </span>
            <span style={{ color: 'var(--rail-muted)' }}>▾</span>
          </button>
          {scopeOpen ? (
            <div className="mt-1.5 overflow-hidden rounded-md" style={{ background: 'var(--rail)', border: '1px solid var(--rail-line)' }}>
              <button
                type="button"
                onClick={() => {
                  pickScope('All projects');
                  setScopeOpen(false);
                }}
                className="block w-full px-[11px] py-2 text-left text-[13px]"
                style={{
                  color: scope === 'All projects' ? '#fff' : 'var(--rail-text)',
                  background: scope === 'All projects' ? 'var(--rail-2)' : 'transparent',
                  borderBottom: '1px solid var(--rail-line)',
                }}
              >
                All projects
                <span className="block text-[11px]" style={{ color: 'var(--rail-muted)' }}>
                  Every project in your scope
                </span>
              </button>
              {scopeProjects.length === 0 ? (
                <span className="block px-[11px] py-2 text-[12px]" style={{ color: 'var(--rail-muted)' }}>
                  No single projects in scope
                </span>
              ) : null}
              {scopeProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    pickScope(p.name, p.id);
                    setScopeOpen(false);
                  }}
                  className="block w-full px-[11px] py-2 text-left text-[13px]"
                  style={{
                    color: scope === p.name ? '#fff' : 'var(--rail-text)',
                    background: scope === p.name ? 'var(--rail-2)' : 'transparent',
                    borderBottom: '1px solid var(--rail-line)',
                  }}
                >
                  {p.name}
                  <span className="block text-[11px]" style={{ color: 'var(--rail-muted)' }}>
                    {p.code} · {p.location.split(',')[1]?.trim() || p.location}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* service-line tabs — a 2-column grid of compact pills, no wrap */}
        <div className="grid grid-cols-2 gap-1.5 px-3.5 pb-[13px] mt-2" style={{ borderBottom: '1px solid var(--rail-line)' }}>
          {ordered.map((s) => {
            const isActive = s.suite === activeSuite;
            const short = SUITE_LABELS[s.suite] ?? s.suite;
            const disabled = disabledSuites.has(s.suite);
            return (
              <button
                key={s.suite}
                type="button"
                onClick={disabled ? undefined : () => setActiveSuite(s.suite)}
                disabled={disabled}
                aria-current={isActive ? 'page' : undefined}
                title={disabled ? 'Coming soon' : undefined}
                className="rounded-md px-2 py-2 text-center text-[11.5px] font-semibold leading-tight"
                style={
                  isActive
                    ? { background: 'var(--accent)', color: '#fff' }
                    : {
                        background: 'var(--rail-2)',
                        border: '1px solid var(--rail-line)',
                        color: 'var(--rail-text)',
                        ...(disabled ? { cursor: 'not-allowed' } : {}),
                      }
                }
              >
                {short}
              </button>
            );
          })}
        </div>

        <nav className="flex-1 px-2.5 pt-3 pb-6" aria-label="Modules">
          {active?.groups.map((group) => (
            <div key={group.group}>
              <div className="px-2.5 pt-3.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--rail-faint)' }}>
                {group.group.toUpperCase()}
              </div>
              {group.items.map((item) => {
                const isActive = pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className="mb-px flex items-center justify-between gap-2 rounded-md px-[9px] py-[7px] text-[13.2px] no-underline"
                    style={
                      isActive
                        ? { background: 'var(--accent)', color: '#fff', fontWeight: 500 }
                        : { color: 'var(--rail-text)' }
                    }
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* quick shortcuts — approval and access admin, gated on admin:approve */}
        {user?.permissions.includes('admin:approve') ? (
          <div className="mt-2 border-t px-2.5 pt-2 pb-4" style={{ borderColor: 'var(--rail-line)' }}>
            <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--rail-faint)' }}>
              Approvals
            </div>
            <Link
              href="/admin/approvals"
              className="flex items-center gap-2 rounded-md px-[9px] py-[7px] text-[13.2px] no-underline"
              style={
                pathname === '/admin/approvals'
                  ? { background: 'var(--accent)', color: '#fff', fontWeight: 500 }
                  : { color: 'var(--rail-text)' }
              }
            >
              <span>Approve users</span>
            </Link>
            <Link
              href="/admin/access"
              className="flex items-center gap-2 rounded-md px-[9px] py-[7px] text-[13.2px] no-underline"
              style={
                pathname === '/admin/access'
                  ? { background: 'var(--accent)', color: '#fff', fontWeight: 500 }
                  : { color: 'var(--rail-text)' }
              }
            >
              <span>Access admin</span>
            </Link>
            <Link
              href="/admin/approval-chains"
              className="flex items-center gap-2 rounded-md px-[9px] py-[7px] text-[13.2px] no-underline"
              style={
                pathname === '/admin/approval-chains'
                  ? { background: 'var(--accent)', color: '#fff', fontWeight: 500 }
                  : { color: 'var(--rail-text)' }
              }
            >
              <span>Approval chains</span>
            </Link>
          </div>
        ) : null}
      </aside>

      {/* ---- main column ---- */}
      <div className="flex min-w-0 flex-col">
        <header
          className="no-print sticky top-0 z-40 flex h-[60px] items-center justify-between gap-4 px-6"
          style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}
        >
          <div className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            <b className="font-semibold" style={{ color: 'var(--text)' }}>
              {SUITE_LABELS[activeSuite] ?? activeSuite}
            </b>
            <span> · {scope}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <input
              className="hidden w-[260px] rounded-md px-3 py-[7px] text-[13px] md:block"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)' }}
              placeholder="Search PO, BOQ item, vendor, bill…"
            />
            <button
              type="button"
              onClick={() => window.print()}
              className="hidden rounded-md px-3 py-[7px] text-[12px] font-medium md:block"
              style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
            >
              Export / print
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  void refreshBell();
                }}
                className="relative rounded-md px-3 py-[7px] text-[12px] font-medium"
                style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
              >
                Notifications
                {unread > 0 ? (
                  <span
                    className="absolute top-1.5 right-[7px] h-2 w-2 rounded-full"
                    style={{ background: 'var(--danger)', border: '2px solid var(--panel)' }}
                  />
                ) : null}
              </button>
              {notifOpen ? (
                <div
                  className="absolute right-0 z-50 mt-2 w-[360px] overflow-hidden rounded-lg"
                  style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 10px 30px rgba(15,23,41,.12)' }}
                >
                  <div
                    className="flex items-center justify-between px-3.5 py-2.5"
                    style={{ borderBottom: '1px solid var(--line-2)' }}
                  >
                    <span className="text-[12px] font-medium">Your notifications</span>
                    {unread > 0 ? (
                      <button
                        type="button"
                        onClick={() => void markAllRead()}
                        className="text-[11px] underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        Mark all read
                      </button>
                    ) : null}
                  </div>

                  {bell.length === 0 ? (
                    <div className="px-3.5 py-8 text-center text-[12.5px]" style={{ color: 'var(--faint)' }}>
                      Nothing yet. Notes from approvers on your items will appear here.
                    </div>
                  ) : (
                    bell.map((n) => {
                      const tone =
                        n.action === 'approved' ? 'var(--ok, var(--accent))'
                          : n.action === 'rejected' ? 'var(--red)'
                            : 'var(--amber)';
                      return (
                        <div
                          key={n.id}
                          className="flex gap-[9px] px-3.5 py-2.5"
                          style={{ borderBottom: '1px solid var(--line-2)', opacity: n.read ? 0.6 : 1 }}
                        >
                          <span
                            className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full"
                            style={{ background: tone }}
                          />
                          <div className="min-w-0">
                            <div className="text-[12.5px] leading-snug">
                              <span style={{ color: 'var(--ink)' }}>
                                {n.entityId} — {n.action}
                              </span>
                              <span style={{ color: 'var(--muted)' }}>
                                {' '}by {n.actorName || n.actorEmail}
                              </span>
                            </div>
                            {n.remark ? (
                              <div
                                className="mt-1 rounded px-2 py-1 text-[12px] leading-snug"
                                style={{
                                  background: 'var(--panel-2, var(--panel))',
                                  border: '1px solid var(--line-2)',
                                  color: 'var(--muted)',
                                }}
                              >
                                “{n.remark}”
                              </div>
                            ) : null}
                            <div className="mt-1 text-[11px]" style={{ color: 'var(--faint)' }}>
                              {new Date(n.createdAt).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2.5 rounded-md py-1 pl-2 pr-1" style={{ border: '1px solid var(--line)', background: 'var(--panel-2)' }}>
              <div
                className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full text-[12px] font-semibold text-white"
                style={{ background: 'var(--accent)' }}
                title={user.name}
              >
                {initials}
              </div>
              <div className="leading-tight">
                <div className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>{user.name}</div>
                <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{user.role}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md px-2.5 py-1.5 text-[12px] font-medium"
              style={{ border: '1px solid var(--line)', color: 'var(--text)', background: 'var(--panel)' }}
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] flex-1 px-6 pt-5 pb-14">{children}</main>
      </div>
    </div>
  );
}
