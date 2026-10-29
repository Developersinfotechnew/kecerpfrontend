'use client';

import { useCallback, useEffect, useState } from 'react';

import { admin, projects as projectService } from '@/lib/services';
import type { ClientEntity, RoleOption, UserOption } from '@/lib/services';
import { useSession } from '../../session';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';

/**
 * Users, roles and the teams that connect them to projects.
 *
 * The hierarchy is: an admin creates people with a role, then assigns each
 * person to one or more projects. That assignment is the team. A role decides
 * what a person may do; the project list decides what they may see.
 *
 * Gated on `admin:view` here and again at the API. The client check only
 * decides what to render — a direct request fails either way.
 */

interface UserRow extends UserOption {}

/** Default password for a freshly created account. The user changes it. */
const DEFAULT_PASSWORD = 'Change-me-123';

const MODULE_KEYS = [
  'project', 'workflow', 'dms', 'boq', 'procurement',
  'billing', 'spares', 'cmms', 'quality', 'she', 'omops',
  'sla', 'engineering', 'lead', 'contract', 'serviceorder',
  'hr', 'payroll', 'expense', 'marketing', 'task', 'compliance',
  'assets', 'manpower', 'utilities', 'sla', 'notification',
] as const;

export default function UsersPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [projects, setProjects] = useState<
    { id: string; code: string; name: string; kind: string; stage: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<UserRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [accessEditing, setAccessEditing] = useState<UserRow | null>(null);
  const [accessDraft, setAccessDraft] = useState<Record<string, 'view' | 'add' | 'edit' | 'full'>>({});
  const [projectEditing, setProjectEditing] = useState<UserRow | null>(null);
  const [projectDraft, setProjectDraft] = useState<Set<string>>(new Set());
  const [projectBusy, setProjectBusy] = useState(false);
  const [clients, setClients] = useState<ClientEntity[]>([]);
  const canApprove = can('admin:approve');

  const pendingRows = rows.filter((r) => r.approvalStatus !== 'approved');
  const approvedRows = rows.filter((r) => r.approvalStatus === 'approved');

  async function doApprove(id: string): Promise<void> {
    try {
      await admin.approveUser(id);
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, approvalStatus: 'approved', rejectionReason: '', isActive: true } : r,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
  }

  async function doReject(): Promise<void> {
    if (!rejecting || !rejectReason.trim()) return;
    try {
      await admin.rejectUser(rejecting.id, rejectReason.trim());
      setRows((prev) =>
        prev.map((r) =>
          r.id === rejecting.id
            ? { ...r, approvalStatus: 'rejected', rejectionReason: rejectReason, isActive: false }
            : r,
        ),
      );
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    }
  }

  function openAccessEditor(row: UserRow): void {
    setAccessEditing(row);
    setAccessDraft(row.moduleAccess ?? {});
  }

  function openProjectEditor(row: UserRow): void {
    setProjectEditing(row);
    setProjectDraft(new Set(row.projectScopeAll ? [] : row.projectIds));
  }

  async function saveProjectEditor(): Promise<void> {
    if (!projectEditing) return;
    setProjectBusy(true);
    setError(null);
    try {
      await admin.updateUser(projectEditing.id, { projectIds: [...projectDraft] });
      setRows((prev) =>
        prev.map((r) =>
          r.id === projectEditing.id
            ? { ...r, projectIds: [...projectDraft] }
            : r,
        ),
      );
      setProjectEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project assignment');
    } finally {
      setProjectBusy(false);
    }
  }

  async function saveAccessEditor(): Promise<void> {
    if (!accessEditing) return;
    try {
      const stringified: Record<string, string> = { ...accessDraft };
      await admin.setUserModuleAccess(accessEditing.id, stringified);
      setRows((prev) =>
        prev.map((r) =>
          r.id === accessEditing.id
            ? { ...r, moduleAccess: { ...r.moduleAccess, ...accessDraft } }
            : r,
        ),
      );
      setAccessEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save access');
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [users, roleList, projectsList, clientsList] = await Promise.all([
        admin.users(),
        admin.roles(),
        projectService.list({ kind: 'master' }),
        admin.clients(),
      ]);
      setRows(users);
      setRoles(roleList);
      setClients(clientsList);
      setProjects(
        projectsList.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          kind: p.kind,
          stage: p.stage,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (can('admin:view')) void load();
    else setLoading(false);
  }, [can, load]);

  if (!can('admin:view')) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        You do not have access to user administration.
      </p>
    );
  }

  const labelFor = (role: string) =>
    roles.find((r) => r.name === role)?.label ?? role.replace(/[-_]/g, ' ');

  return (
    <>
      <PageHead
        title="Users, roles and access"
        description="What a person can see and do is set by their role, then limited to the projects they are assigned to."
        actions={
          can('admin:create') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Add user
            </Button>
          ) : null
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      {creating && can('admin:create') ? (
        <UserForm
          roles={roles}
          projects={projects}
          onCancel={() => setCreating(false)}
          clients={clients}
          onSubmit={async (body) => {
            await admin.createUser({ ...body });
            setCreating(false);
            await load();
          }}
        />
      ) : null}

      {rejecting ? (
        <RejectDialog
          user={rejecting}
          reason={rejectReason}
          setReason={setRejectReason}
          onCancel={() => { setRejecting(null); setRejectReason(''); }}
          onSubmit={() => void doReject()}
        />
      ) : null}

      {accessEditing ? (
        <ModuleAccessDialog
          user={accessEditing}
          draft={accessDraft}
          setDraft={setAccessDraft}
          onCancel={() => setAccessEditing(null)}
          onSubmit={() => void saveAccessEditor()}
        />
      ) : null}

      {projectEditing ? (
        <ProjectAssignDialog
          user={projectEditing}
          projects={projects}
          selected={projectDraft}
          busy={projectBusy}
          onToggle={(id) =>
            setProjectDraft((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onCancel={() => setProjectEditing(null)}
          onSubmit={() => void saveProjectEditor()}
        />
      ) : null}

      {canApprove && pendingRows.length > 0 ? (
        <Panel
          title="Pending approvals"
          sub={`${pendingRows.length} account(s) waiting — they cannot log in until approved`}
          bodyless
        >
          <DataTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role' },
              { key: 'reason', label: 'Reject reason' },
              { key: 'actions', label: '', align: 'right' },
            ]}
            empty="No pending accounts."
            rows={pendingRows.map((u) => [
              <span key="n" className="font-semibold">{u.name}</span>,
              <span key="e" style={{ color: 'var(--muted)' }}>{u.email}</span>,
              <span key="r">{labelFor(u.role)}</span>,
              <span key="rs" style={{ color: u.approvalStatus === 'rejected' ? 'var(--red)' : 'var(--muted)', fontSize: 12 }}>
                {u.approvalStatus === 'rejected' ? u.rejectionReason || 'No reason' : 'Awaiting review'}
              </span>,
              <div key="a" className="flex gap-1.5 justify-end">
                <Button variant="primary" onClick={() => void doApprove(u.id)}>
                  Approve
                </Button>
                {u.approvalStatus === 'pending' ? (
                  <Button onClick={() => { setRejecting(u); setRejectReason(''); }}>
                    Reject
                  </Button>
                ) : null}
                <Button onClick={() => openAccessEditor(u)}>
                  Access
                </Button>
              </div>,
            ])}
          />
        </Panel>
      ) : null}

      <Panel title="Roles" sub={`${roles.length} defined`} bodyless>
        <DataTable
          columns={[
            { key: 'role', label: 'Role' },
            { key: 'sees', label: 'Description' },
            { key: 'scope', label: 'Project scope', align: 'right' },
            { key: 'users', label: 'Users', align: 'right' },
          ]}
          rows={roles.map((r) => [
            <span key="r" className="font-semibold">
              {r.label}
            </span>,
            <span key="d" style={{ color: 'var(--muted)' }}>
              {r.description || '—'}
            </span>,
            <span key="s">{r.projectScopeAll ? 'All projects' : 'Assigned only'}</span>,
            <span key="u" className="num">
              {rows.filter((u) => u.role === r.name && u.isActive).length}
            </span>,
          ])}
          empty="No roles defined."
        />
      </Panel>

      <Panel title="Accounts" sub={loading ? 'Loading…' : `${approvedRows.length} approved · ${pendingRows.length} pending`} bodyless>
        {loading ? (
          <div className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
            Loading users…
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role' },
              { key: 'scope', label: 'Project scope' },
              { key: 'last', label: 'Last login' },
              { key: 'status', label: 'Status', align: 'right' },
            ]}
            empty="No accounts found."
            rows={rows.map((row) => [
              <span key="n" className="font-semibold">
                {row.name}
              </span>,
              <span key="e" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {row.email}
              </span>,
              <span key="r">{labelFor(row.role)}</span>,
              row.projectScopeAll
                ? 'All projects'
                : row.projectIds.length === 0
                  ? 'Not assigned'
                  : `${row.projectIds.length} project(s)`,
              <span key="l" className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                {row.lastLoginAt
                  ? new Date(row.lastLoginAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                    })
                  : 'Never'}
              </span>,
              <div key="s" className="flex items-center gap-1.5 justify-end">
                {canApprove ? (
                  <Chip
                    tone={
                      row.approvalStatus === 'approved' ? 'ok'
                      : row.approvalStatus === 'pending' ? 'warn'
                      : 'bad'
                    }
                  >
                    {row.approvalStatus}
                  </Chip>
                ) : (
                  <Chip tone={row.isActive ? 'ok' : 'mute'}>
                    {row.isActive ? 'Active' : 'Disabled'}
                  </Chip>
                )}
                {canApprove ? (
                  <button
                    onClick={() => openProjectEditor(row)}
                    className="text-[11.5px] font-medium"
                    style={{ color: 'var(--blue)', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                    title="Assign projects"
                  >
                    projects
                  </button>
                ) : null}
                {canApprove ? (
                  <button
                    onClick={() => openAccessEditor(row)}
                    className="text-[11.5px] font-medium"
                    style={{ color: 'var(--blue)', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                    title="Edit module access"
                  >
                    access
                  </button>
                ) : null}
              </div>,
            ])}
          />
        )}
      </Panel>
    </>
  );
}

interface UserFormProps {
  roles: RoleOption[];
  projects: { id: string; code: string; name: string; kind: string; stage: string | null }[];
  clients: ClientEntity[];
  onCancel: () => void;
  onSubmit: (body: {
    name: string;
    email: string;
    password: string;
    role: string;
    projectIds: string[];
    clientIds: string[];
  }) => Promise<void>;
}

/**
 * Add a person and assign them to projects.
 *
 * Choosing projects here is creating the team. The person gets the role's
 * permissions, but only over the plants and phases ticked in this form.
 * Leave none ticked and they see nothing, which is usually wrong.
 */
function UserForm({ roles, projects, clients, onCancel, onSubmit }: UserFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [role, setRole] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());

  const chosenRole = roles.find((r) => r.name === role);

  function toggle(projectId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function toggleClient(clientId: string): void {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !password || !role) {
      setError('Name, email, password and role are all required.');
      return;
    }

    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        projectIds: [...selected],
        clientIds: [...selectedClients],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add user');
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
      aria-label="Add user"
    >
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <header
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <h3 className="m-0 text-[14px] font-semibold">Add user</h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-[18px] leading-none"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="grid gap-3 p-4">
          {error ? (
            <p className="m-0 text-[12.5px]" style={{ color: 'var(--red)' }} role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Full name *
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Email *
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Role *
              </span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              >
                <option value="">Choose a role…</option>
                {roles.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Password *
              </span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </label>
          </div>

          {chosenRole ? (
            <p className="m-0 rounded px-3 py-2 text-[12px]" style={{ background: '#f4f7f5', border: '1px solid var(--line)', color: 'var(--muted)' }}>
              {chosenRole.description || 'This role has no description.'}
              <span className="block mt-1 font-medium" style={{ color: 'var(--text)' }}>
                {chosenRole.permissions.length} permissions · approves up to{' '}
                {chosenRole.approvalLimit > 0
                  ? `₹${(chosenRole.approvalLimit / 1_000_000).toLocaleString('en-IN')}M`
                  : 'nothing'}
              </span>
            </p>
          ) : null}

          <div>
            <div className="mb-1.5 text-[12.5px] font-medium">Project team assignment</div>
            <p className="mb-2 mt-0 text-[12px]" style={{ color: 'var(--muted)' }}>
              Pick the plants this person belongs to. Leave empty to give them no access.
            </p>
            <div
              className="grid max-h-[190px] gap-1 overflow-y-auto rounded p-1"
              style={{ border: '1px solid var(--line)', background: '#fff' }}
            >
              {projects.length === 0 ? (
                <span className="px-2 py-2 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  No projects yet. Create a project first, then build its team.
                </span>
              ) : (
                projects.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
                    style={{ background: selected.has(p.id) ? 'var(--accent-soft)' : undefined }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-4 w-4"
                    />
                    <span className="num text-[11.5px]" style={{ color: 'var(--muted)' }}>
                      {p.code}
                    </span>
                    <span className="text-[13px]">{p.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <footer
          className="flex items-center justify-between px-4 py-3"
          style={{ borderTop: '1px solid var(--line-2)' }}
        >
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {selected.size} project(s) selected
          </span>
          <div className="flex justify-end gap-2">
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="primary" className={busy ? 'opacity-60' : ''}>
              {busy ? 'Adding…' : 'Add user'}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}

interface RejectDialogProps {
  user: UserRow;
  reason: string;
  setReason: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function RejectDialog({ user, reason, setReason, onCancel, onSubmit }: RejectDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Reject ${user.name}`}
    >
      <div
        className="w-full max-w-md rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <h3 className="m-0 text-[14px] font-semibold">Reject {user.name}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-[18px] leading-none"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
              Reason (shown to the user on their login attempt) *
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)', background: '#fff' }}
              placeholder="e.g. Wrong role assigned, contact admin"
            />
          </label>
        </div>
        <div
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--line-2)' }}
        >
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!reason.trim()} onClick={onSubmit}>
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ProjectAssignDialogProps {
  user: UserRow;
  projects: { id: string; code: string; name: string; kind: string; stage: string | null }[];
  selected: Set<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/**
 * Assign which projects a user can see. This is the whole scope decision:
 * `projectIds` on the user drives every list, dropdown and dashboard for that
 * login. A client engineer on one plant sees exactly that plant; a user on two
 * sees both. The role sets what they may do, this sets where.
 */
function ProjectAssignDialog({
  user,
  projects,
  selected,
  busy,
  onToggle,
  onCancel,
  onSubmit,
}: ProjectAssignDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Assign projects to ${user.name}`}
    >
      <div
        className="w-full max-w-md rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <div>
            <h3 className="m-0 text-[14px] font-semibold">Project scope · {user.name}</h3>
            <p className="m-0 mt-0.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
              This user sees only the projects ticked here, in every screen.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-[18px] leading-none"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4">
          {projects.length === 0 ? (
            <p className="m-0 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              No projects yet. Create a project first, then assign it here.
            </p>
          ) : (
            <div className="grid max-h-[220px] gap-1 overflow-y-auto rounded p-1" style={{ border: '1px solid var(--line)', background: '#fff' }}>
              {projects
                .filter((p) => p.kind === 'master')
                .map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
                    style={{ background: selected.has(p.id) ? 'var(--accent-soft)' : undefined }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => onToggle(p.id)}
                      className="h-4 w-4"
                    />
                    <span className="num text-[11.5px]" style={{ color: 'var(--muted)' }}>
                      {p.code}
                    </span>
                    <span className="text-[13px]">{p.name}</span>
                  </label>
                ))}
            </div>
          )}
          <p className="mt-2 mb-0 text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {selected.size} of {projects.filter((p) => p.kind === 'master').length} project(s) selected
          </p>
        </div>

        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--line-2)' }}>
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {user.projectScopeAll
              ? 'Role scope is "All projects" — ticking here does not narrow it until the role changes.'
              : 'Saves on confirm. The user is re-scoped on their next load.'}
          </span>
          <div className="flex gap-2">
            <Button onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSubmit} disabled={busy}>
              {busy ? 'Saving…' : 'Save scope'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModuleAccessDialogProps {
  user: UserRow;
  draft: Record<string, 'view' | 'add' | 'edit' | 'full'>;
  setDraft: (v: Record<string, 'view' | 'add' | 'edit' | 'full'>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function ModuleAccessDialog({ user, draft, setDraft, onCancel, onSubmit }: ModuleAccessDialogProps) {
  function setLevel(mod: string, lvl: 'view' | 'add' | 'edit' | 'full'): void {
    setDraft({ ...draft, [mod]: lvl });
  }

  function clearModule(mod: string): void {
    const next = { ...draft };
    delete next[mod];
    setDraft(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15, 23, 41, 0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Module access for ${user.name}`}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <div>
            <h3 className="m-0 text-[14px] font-semibold">Module access — {user.name}</h3>
            <p className="mb-0 mt-0.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
              Unchecked = inherit from role. Checked = override at this level.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-[18px] leading-none"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <div className="flex flex-col gap-2">
            {MODULE_KEYS.map((mod) => {
              const current = draft[mod] ?? '';
              return (
                <div
                  key={mod}
                  className="flex items-center gap-2"
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: current ? 'var(--accent-soft, #eef5f2)' : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!current}
                    onChange={() => (current ? clearModule(mod) : setLevel(mod, 'view'))}
                    className="h-4 w-4"
                  />
                  <span className="w-20 text-[13px] font-medium capitalize">{mod}</span>
                  {current ? (
                    <select
                      value={current}
                      onChange={(e) => setLevel(mod, e.target.value as 'view' | 'add' | 'edit' | 'full')}
                      className="rounded px-2 py-0.5 text-[12px]"
                      style={{ border: '1px solid var(--line)', background: '#fff' }}
                    >
                      <option value="view">view</option>
                      <option value="add">view + add</option>
                      <option value="edit">view + add + edit</option>
                      <option value="full">full (approve)</option>
                    </select>
                  ) : (
                    <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                      inherit
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--line-2)' }}
        >
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit}>Save</Button>
        </div>
      </div>
    </div>
  );
}
