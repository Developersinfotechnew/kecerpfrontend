'use client';

import { useCallback, useEffect, useState } from 'react';

import { admin, projects } from '@/lib/services';
import type { PendingUser, UserOption, ProjectOption } from '@/lib/services';
import { useSession } from '@/app/session';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';

/**
 * User approvals and module access overrides.
 *
 * Gated on `admin:approve` — only users with this permission can approve,
 * reject, or set per-user module access levels.
 *
 * Workflow:
 * 1. Admin creates a user (via /users page). User starts as 'pending'.
 * 2. This page lists all pending users.
 * 3. Admin approves or rejects with a reason.
 * 4. Admin can set per-user moduleAccess to override the role's default.
 */
export default function UserApprovalsPage() {
  const { can } = useSession();
  const canApprove = can('admin:approve');

  const [pending, setPending] = useState<PendingUser[]>([]);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingUser | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editingAccess, setEditingAccess] = useState<PendingUser | UserOption | null>(null);
  const [deleting, setDeleting] = useState<UserOption | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [editingProjects, setEditingProjects] = useState<UserOption | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingRows, allRows] = await Promise.all([
        admin.pendingUsers(),
        admin.users(),
      ]);
      setPending(pendingRows);
      setAllUsers(allRows);
      setCanDelete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canApprove) void load();
    else setLoading(false);
  }, [canApprove, load]);

  if (!canApprove) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        You do not have approval access.
      </p>
    );
  }

  async function doApprove(id: string): Promise<void> {
    try {
      await admin.approveUser(id);
      setPending((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
  }

  async function doReject(id: string): Promise<void> {
    if (!rejectReason.trim()) return;
    try {
      await admin.rejectUser(id, rejectReason.trim());
      setPending((prev) => prev.filter((u) => u.id !== id));
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    }
  }

  async function saveModuleAccess(userId: string, map: Record<string, string>, services: string[]): Promise<void> {
    try {
      await admin.setUserModuleAccess(userId, map);
      await admin.setUserServices(userId, services);
      setEditingAccess(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save access');
    }
  }

  async function saveProjects(userId: string, projectIds: string[]): Promise<void> {
    try {
      await admin.setUserProjects(userId, projectIds);
      setEditingProjects(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save projects');
    }
  }

  async function doDelete(user: UserOption): Promise<void> {
    try {
      await admin.deleteUser(user.id);
      setAllUsers((prev) => prev.filter((u) => u.id !== user.id));
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHead
        title="User approvals"
        description="Review pending accounts. Approve to grant access, reject with a reason. Set per-user module overrides below."
      />

      {error ? <Notice>{error}</Notice> : null}

      {rejecting ? (
        <RejectDialog
          user={rejecting}
          reason={rejectReason}
          setReason={setRejectReason}
          onCancel={() => {
            setRejecting(null);
            setRejectReason('');
          }}
          onSubmit={() => void doReject(rejecting.id)}
        />
      ) : null}

      {editingAccess ? (
        <ModuleAccessDialog
          key={editingAccess.id}
          user={{
            id: editingAccess.id,
            name: 'name' in editingAccess ? (editingAccess as UserOption).name : (editingAccess as PendingUser).name,
            services: 'services' in editingAccess ? (editingAccess as UserOption).services ?? [] : (editingAccess as PendingUser).services ?? [],
            moduleAccess: 'moduleAccess' in editingAccess ? (editingAccess as UserOption).moduleAccess : (editingAccess as PendingUser).moduleAccess,
          }}
          onCancel={() => setEditingAccess(null)}
          onSubmit={(map, services) => void saveModuleAccess(editingAccess.id, map, services)}
        />
      ) : null}

      {deleting ? (
        <DeleteUserDialog
          user={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void doDelete(deleting)}
        />
      ) : null}

      {editingProjects ? (
        <ProjectsDialog
          key={editingProjects.id}
          user={editingProjects}
          onCancel={() => setEditingProjects(null)}
          onSubmit={(ids) => void saveProjects(editingProjects.id, ids)}
        />
      ) : null}

      <Panel
        title="Pending approvals"
        sub={loading ? 'Loading…' : `${pending.length} waiting`}
        bodyless
      >
        {loading ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Loading…
          </div>
        ) : pending.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            No pending users. All accounts are reviewed.
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role' },
              { key: 'created', label: 'Created' },
              { key: 'reason', label: 'Reject reason', align: 'left' },
              { key: 'actions', label: '', align: 'right' },
            ]}
            rows={pending.map((u) => [
              <span key="n" className="font-semibold">
                {u.name}
              </span>,
              <span key="e" style={{ color: 'var(--muted)' }}>
                {u.email}
              </span>,
              <span key="r">{u.roleName.replace(/[-_]/g, ' ')}</span>,
              <span key="c" style={{ color: 'var(--muted)' }}>
                {new Date(u.createdAt).toLocaleDateString('en-IN')}
              </span>,
              <span key="rs" style={{ color: 'var(--red)', fontSize: 12 }}>
                {u.rejectionReason || '—'}
              </span>,
              <div key="a" className="flex gap-1.5 justify-end">
                <Button
                  variant="primary"
                  onClick={() => void doApprove(u.id)}
                >
                  Approve
                </Button>
                <Button
                  onClick={() => setRejecting(u)}
                >
                  Reject
                </Button>
                <Button
                  onClick={() => setEditingAccess(u)}
                >
                  Access
                </Button>
              </div>,
            ])}
            empty="No pending users."
          />
        )}
      </Panel>

      <Panel
        title="All users"
        sub={loading ? 'Loading…' : `${allUsers.length} total`}
        bodyless
      >
        {loading ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Loading…
          </div>
        ) : allUsers.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            No users yet.
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role' },
              { key: 'status', label: 'Status' },
              { key: 'lastLogin', label: 'Last login' },
              { key: 'actions', label: '', align: 'right' },
            ]}
            rows={allUsers.map((u) => [
              <span key="n" className="font-semibold">{u.name}</span>,
              <span key="e" style={{ color: 'var(--muted)' }}>{u.email}</span>,
              <span key="r">{u.role.replace(/[-_]/g, ' ')}</span>,
              <span key="st">
                {u.approvalStatus === 'approved' ? (
                  <Chip tone="ok">active</Chip>
                ) : u.approvalStatus === 'rejected' ? (
                  <Chip tone="bad">rejected</Chip>
                ) : (
                  <Chip tone="warn">pending</Chip>
                )}
              </span>,
              <span key="ll" style={{ color: 'var(--muted)' }}>
                {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-IN') : '—'}
              </span>,
              <div key="a" className="flex gap-1.5 justify-end">
                <Button onClick={() => setEditingAccess(u)}>Access</Button>
                <Button onClick={() => setEditingProjects(u)}>Projects</Button>
                {canDelete ? (
                  <Button variant="primary" onClick={() => setDeleting(u)}>Delete</Button>
                ) : null}
              </div>,
            ])}
            empty="No users."
          />
        )}
      </Panel>
    </>
  );
}

/** Modal: enter a rejection reason, submit to finalize. */
function RejectDialog({
  user,
  reason,
  setReason,
  onCancel,
  onSubmit,
}: {
  user: PendingUser;
  reason: string;
  setReason: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <h3 className="m-0 text-[14px] font-semibold">Reject {user.name}</h3>
        </div>
        <div className="p-4">
          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
              Reason (shown to the user on login attempt) *
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)', background: '#fff' }}
              placeholder="e.g. Wrong role assigned, please contact admin"
            />
          </label>
        </div>
        <div
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--line-2)' }}
        >
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            onClick={onSubmit}
          >
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal: pick per-module access levels.
 * view / edit / full / unset (checkbox off = inherit from role).
 */
/**
 * Module access levels, ordered least → most privileged.
 * view: read-only
 * add:  view + create
 * edit: view + create + update
 * full: view + create + update + approve
 */
const ACCESS_LEVELS = ['view', 'add', 'edit', 'full'] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

const LEVEL_LABELS: Record<AccessLevel, string> = {
  view: 'view',
  add: 'view + add',
  edit: 'view + add + edit',
  full: 'view + add + edit + approve',
};

/**
 * Suite ordering and labels for the service tabs.
 * Mirrors the service structure from nav.seed.ts.
 */
const SERVICE_TABS = [
  { key: 'services', label: 'Services' },
  { key: 'shared', label: 'Head Office' },
  { key: 'epc', label: 'EPC' },
  { key: 'pmc', label: 'PMC' },
  { key: 'eptp', label: 'EPTP' },
  { key: 'om', label: 'O&M' },
  { key: 'backoffice', label: 'General' },
] as const;

const SERVICE_OPTIONS = [
  { key: 'shared', label: 'Head Office' },
  { key: 'backoffice', label: 'General' },
  { key: 'epc', label: 'EPC' },
  { key: 'pmc', label: 'PMC' },
  { key: 'eptp', label: 'EPTP' },
  { key: 'om', label: 'O&M' },
] as const;

/**
 * One access row in the dialog.
 *
 * The engine grants access per module, and many sidebar screens share one
 * module. So one row shows per module: the first sidebar screen's exact name
 * as the label, and the remaining screens the module gates as sub-text.
 * Toggling the row sets that one module; screens sharing it move together,
 * which is what the engine actually does.
 */
interface AccessRow {
  /** Module code the row gates. */
  mod: string;
  /** Sidebar label shown (first screen that uses this module). */
  label: string;
  /** Other sidebar screens that share the module. */
  also: string[];
}

interface NavModuleGroup {
  suite: string;
  group: string;
  rows: AccessRow[];
}

/**
 * Flatten the active nav entries into per-suite groups of module rows.
 * Each module gets one row: the first sidebar screen's label, the rest listed
 * in `also`. Inactive nav rows are skipped, matching the sidebar.
 */
function buildModuleGroups(
  navEntries: import('@/lib/services').NavEntryView[],
): Record<string, NavModuleGroup[]> {
  const bySuite: Record<string, NavModuleGroup[]> = {};
  const active = [...navEntries].filter((e) => e.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const entry of active) {
    if (!bySuite[entry.suite]) bySuite[entry.suite] = [];
    const groups = bySuite[entry.suite];
    let g = groups.find((x) => x.group === entry.group);
    if (!g) {
      g = { suite: entry.suite, group: entry.group, rows: [] };
      groups.push(g);
    }
    for (const mod of entry.modules) {
      const existing = g.rows.find((r) => r.mod === mod);
      if (existing) existing.also.push(entry.label);
      else g.rows.push({ mod, label: entry.label, also: [] });
    }
  }
  return bySuite;
}

/**
 * Add the backend catalogue's modules that no sidebar row covers yet, one
 * row per module under an "Other" group in its suite, with the backend's
 * title-cased label.
 */
function withCatalogue(
  groups: Record<string, NavModuleGroup[]>,
  moduleSuite: Record<string, string> | null,
  moduleLabels: Record<string, string> | null,
): Record<string, NavModuleGroup[]> {
  if (!moduleSuite) return groups;
  const next: Record<string, NavModuleGroup[]> = { ...groups };
  for (const [mod, suite] of Object.entries(moduleSuite)) {
    const suiteGroups = next[suite] ?? [];
    const inNav = suiteGroups.some((g) => g.rows.some((r) => r.mod === mod));
    if (inNav) continue;
    let other = suiteGroups.find((g) => g.group === 'Other');
    if (!other) {
      other = { suite, group: 'Other', rows: [] };
      suiteGroups.push(other);
      next[suite] = suiteGroups;
    }
    other.rows.push({
      mod,
      label: moduleLabels?.[mod] ?? mod.charAt(0).toUpperCase() + mod.slice(1),
      also: [],
    });
  }
  return next;
}

interface AccessUser {
  id: string;
  name: string;
  services?: string[];
  moduleAccess?: Record<string, string>;
}

function ModuleAccessDialog({
  user,
  onCancel,
  onSubmit,
}: {
  user: AccessUser;
  onCancel: () => void;
  onSubmit: (map: Record<string, string>, services: string[]) => void;
}) {
  const [levels, setLevels] = useState<Record<string, string>>(
    () => ({ ...user.moduleAccess }),
  );
  const [activeTab, setActiveTab] = useState<string>('services');
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set(user.services ?? []),
  );
  const [navEntries, setNavEntries] = useState<import('@/lib/services').NavEntryView[]>([]);
  const [moduleSuite, setModuleSuite] = useState<Record<string, string> | null>(null);
  const [moduleLabels, setModuleLabels] = useState<Record<string, string> | null>(null);
  const [loadingNav, setLoadingNav] = useState(true);

  useEffect(() => {
    admin
      .navEntries()
      .then(setNavEntries)
      .catch(() => {})
      .finally(() => setLoadingNav(false));
    // The module catalogue is the complete module list; the dialog must show
    // every module in its suite, not only the ones with an active nav row.
    admin
      .permissions()
      .then((m) => {
        setModuleSuite(m.moduleSuite ?? null);
        setModuleLabels(m.moduleLabels ?? null);
      })
      .catch(() => {});
  }, []);

  const moduleGroups = withCatalogue(buildModuleGroups(navEntries), moduleSuite, moduleLabels);

  function setLevel(mod: string, lvl: string): void {
    setLevels((prev) => ({ ...prev, [mod]: lvl }));
  }

  function clearModule(mod: string): void {
    setLevels((prev) => {
      const next = { ...prev };
      delete next[mod];
      return next;
    });
  }

  function toggleModule(mod: string, current: string): void {
    if (current) clearModule(mod);
    else setLevel(mod, 'view');
  }

  /**
   * Render one module row: checkbox + level selector. The label is the first
   * sidebar screen that gates on this module; the other screens sharing it
   * are listed as sub-text, so the user sees exactly what one toggle opens.
   */
  function ModuleRow({ row }: { row: AccessRow }) {
    const current = levels[row.mod] ?? '';
    return (
      <div
        className="flex items-center gap-2 rounded px-2 py-1.5"
        style={{ background: current ? 'var(--accent-soft, #eef5f2)' : undefined }}
      >
        <input
          type="checkbox"
          checked={!!current}
          onChange={() => toggleModule(row.mod, current)}
          className="h-4 w-4 flex-none"
        />
        <span className="min-w-0 flex-1 text-[12.5px] font-medium">
          {row.label}
          {row.also.length > 0 ? (
            <span className="ml-1 font-normal" style={{ color: 'var(--muted)' }}>
              +{row.also.length} more ({row.also.join(', ')})
            </span>
          ) : null}
        </span>
        {current ? (
          <select
            value={current}
            onChange={(e) => setLevel(row.mod, e.target.value)}
            className="w-[110px] flex-none rounded px-1.5 py-0.5 text-[11.5px]"
            style={{ border: '1px solid var(--line)', background: '#fff' }}
          >
            {ACCESS_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>{LEVEL_LABELS[lvl]}</option>
            ))}
          </select>
        ) : (
          <span className="flex-none text-[11.5px]" style={{ color: 'var(--muted)' }}>
            inherit
          </span>
        )}
      </div>
    );
  }

  /** Render a group block with its module rows. */
  function GroupBlock({ group, rows }: { group: string; rows: AccessRow[] }) {
    const groupMods = rows.map((r) => r.mod);
    return (
      <div className="rounded p-2" style={{ background: 'var(--panel-2, #f9fafb)', border: '1px solid var(--line)' }}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {group}
          </span>
          <button
            type="button"
            onClick={() => {
              // Toggle all modules in this group
              const allOn = groupMods.every((m) => levels[m]);
              if (allOn) {
                for (const m of groupMods) clearModule(m);
              } else {
                for (const m of groupMods) setLevel(m, 'view');
              }
            }}
            className="text-[11px]"
            style={{ color: 'var(--blue)' }}
          >
            {groupMods.every((m) => levels[m]) ? 'clear all' : 'view all'}
          </button>
        </div>
        <div className="grid gap-1">
          {rows.map((row) => (
            <ModuleRow key={row.mod} row={row} />
          ))}
        </div>
      </div>
    );
  }

  const activeGroups: NavModuleGroup[] =
    activeTab === 'services' ? [] : moduleGroups[activeTab] ?? [];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <div>
            <h3 className="m-0 text-[14px] font-semibold">Module access — {user.name}</h3>
            <p className="mb-0 mt-0.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
              Pick services, then set the access level per module. Unchecked = inherit from role.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-[18px] leading-none" style={{ color: 'var(--muted)' }} aria-label="Close">×</button>
        </div>

        <div className="flex flex-wrap gap-1 px-4 py-2" style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel-2, #f9fafb)' }}>
          {SERVICE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
              style={
                activeTab === tab.key
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { background: '#fff', border: '1px solid var(--line)', color: 'var(--text)' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'services' ? (
            <div>
              <p className="mb-3 text-[12px]" style={{ color: 'var(--muted)' }}>
                Select which services this user can see in the sidebar. Leave all unchecked to inherit from their client&apos;s availed services.
              </p>
              <div className="grid gap-2">
                {SERVICE_OPTIONS.map((svc) => {
                  const checked = selectedServices.has(svc.key);
                  return (
                    <label
                      key={svc.key}
                      className="flex items-center gap-3 rounded px-3 py-2"
                      style={{
                        background: checked ? 'var(--accent-soft, #eef5f2)' : 'var(--panel-2, #f9fafb)',
                        border: `1px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedServices((prev) => {
                            const next = new Set(prev);
                            if (next.has(svc.key)) next.delete(svc.key);
                            else next.add(svc.key);
                            return next;
                          });
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-[13px] font-medium">{svc.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : loadingNav ? (
            <div className="py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>Loading modules…</div>
          ) : activeGroups.length === 0 ? (
            <p className="py-4 text-[13px]" style={{ color: 'var(--muted)' }}>
              No modules defined for this service.
            </p>
          ) : (
            <div className="grid gap-3">
              {activeGroups.map((g) => (
                <GroupBlock key={g.group} group={g.group} rows={g.rows} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--line-2)' }}>
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {Object.keys(levels).length} module(s) set
          </span>
          <div className="flex gap-2">
            <Button onClick={onCancel}>Cancel</Button>
            <Button
          variant="primary"
          onClick={() => {
            // If the admin set any module that lives in the 'shared' suite
            // but did not explicitly tick 'Head Office' in the Services tab, add
            // 'shared' to the services list automatically. The suite map comes
            // from the backend catalogue, not a hardcoded list.
            const sharedMods = new Set(
              Object.entries(moduleSuite ?? {}).filter(([, s]) => s === 'shared').map(([m]) => m),
            );
            const finalServices = new Set(selectedServices);
            for (const mod of Object.keys(levels)) {
              if (sharedMods.has(mod)) {
                finalServices.add('shared');
                break;
              }
            }
            onSubmit(levels, [...finalServices]);
          }}
        >
          Save
        </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


function DeleteUserDialog({
  user,
  onCancel,
  onConfirm,
}: {
  user: import('@/lib/services').UserOption;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    try {
      onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded p-4"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <h3 className="m-0 text-[14px] font-semibold">Delete user</h3>
        <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>
          Remove <strong>{user.name}</strong> ({user.email})? This deactivates the account. The
          record is kept for audit and cannot be undone from the UI.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void handleConfirm()}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal: pick which projects a user may see.
 *
 * This is the superadmin's project-per-user assignment. When a user's
 * project list is set here, their entire panel — sidebar, scope switcher,
 * every register and dashboard — filters to only those projects. An empty
 * selection leaves the user with no project scope.
 */
function ProjectsDialog({
  user,
  onCancel,
  onSubmit,
}: {
  user: import('@/lib/services').UserOption;
  onCancel: () => void;
  onSubmit: (projectIds: string[]) => void;
}) {
  const [allProjects, setAllProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(user.projectIds));

  useEffect(() => {
    projects
      .list()
      .then(setAllProjects)
      .catch(() => setAllProjects([]))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded p-4"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <h3 className="m-0 text-[14px] font-semibold">Assign projects to {user.name}</h3>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
          The user sees only these projects across the whole app. Leave all unchecked for no project scope.
        </p>

        {user.projectScopeAll ? (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--amber, #b45309)' }}>
            This role is set to <strong>all projects</strong> at the role level. Project assignment here
            is overridden by the role&apos;s global scope.
          </p>
        ) : null}

        <div className="mt-3 max-h-[260px] overflow-y-auto rounded border p-2" style={{ borderColor: 'var(--line)' }}>
          {loading ? (
            <p className="p-2 text-[12px]" style={{ color: 'var(--muted)' }}>Loading projects…</p>
          ) : allProjects.length === 0 ? (
            <p className="p-2 text-[12px]" style={{ color: 'var(--muted)' }}>No projects exist yet.</p>
          ) : (
            allProjects.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded px-2 py-1.5"
                style={{ background: selected.has(p.id) ? 'var(--accent-soft, #eef5f2)' : undefined }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  className="h-4 w-4 flex-none"
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                  {p.code ? `${p.code} — ` : ''}
                  {p.name}
                </span>
                {p.clientName ? (
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {p.clientName}
                  </span>
                ) : null}
              </label>
            ))
          )}
        </div>

        <div className="mt-3 text-[11px]" style={{ color: 'var(--muted)' }}>
          {selected.size} project{selected.size === 1 ? '' : 's'} selected
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onSubmit([...selected])}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
