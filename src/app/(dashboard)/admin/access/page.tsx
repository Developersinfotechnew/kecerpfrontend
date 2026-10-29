'use client';

import { useCallback, useEffect, useState } from 'react';

import { admin } from '@/lib/services';
import type { NavEntryBody, NavEntryView, RoleBody, RoleOption, UserOption } from '@/lib/services';
import { useSession } from '@/app/session';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';

/**
 * Access admin — roles and the navigation catalogue.
 *
 * Both used to be seed-only, so adding a role or a menu entry meant editing
 * code and redeploying. Each is now a database write.
 *
 * The permission vocabulary for the role editor comes from the permission
 * matrix endpoint, so the checkboxes always match what the backend actually
 * enforces. A role can grant any module:action string, which is what makes
 * adding a new module a code change of one constant, not a route change.
 */
export default function AccessAdminPage() {
  const { can } = useSession();
  const canCreate = can('admin:create');
  const canUpdate = can('admin:update');
  const canDelete = can('admin:delete');

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [nav, setNav] = useState<NavEntryView[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [roleForm, setRoleForm] = useState<RoleOption | 'new' | null>(null);
  const [navForm, setNavForm] = useState<NavEntryView | 'new' | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [userForm, setUserForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [roleList, navList, matrix, userList] = await Promise.all([
        admin.roles(),
        admin.navEntries(),
        admin.permissions(),
        admin.users(),
      ]);
      setRoles(roleList);
      setNav(navList);
      setPermissions(matrix.permissions);
      setUsers(userList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load access settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveUser(body: {
    name: string;
    email: string;
    password: string;
    role: string;
  }): Promise<void> {
    await admin.createUser({ ...body, projectIds: [], clientIds: [] });
    setUserForm(false);
    void load();
  }

  async function saveRole(body: RoleBody, assignToUsers?: string[]): Promise<void> {
    let newRoleName: string | undefined;
    if (roleForm === 'new') {
      const created = await admin.createRole(body);
      newRoleName = created.name;
    } else if (roleForm) {
      await admin.updateRole(roleForm._id, body);
    }
    // Assign the role to each chosen user, one write each.
    if (newRoleName && assignToUsers) {
      for (const userId of assignToUsers) {
        await admin.updateUser(userId, { role: newRoleName });
      }
    }
    setRoleForm(null);
    void load();
  }

  async function assignRole(userId: string, roleName: string): Promise<void> {
    try {
      await admin.updateUser(userId, { role: roleName });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: roleName, roleLabel: undefined } : u)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role assignment failed');
    }
  }

  async function removeRole(role: RoleOption): Promise<void> {
    if (!window.confirm(`Delete role ${role.label}? This cannot be undone.`)) return;
    if (role.isSystem) {
      setError(`System role ${role.label} cannot be deleted.`);
      return;
    }
    try {
      await admin.deleteRole(role._id);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function saveNav(body: NavEntryBody): Promise<void> {
    if (navForm === 'new') {
      await admin.createNavEntry(body);
    } else if (navForm) {
      await admin.updateNavEntry(navForm.id, body);
    }
    setNavForm(null);
    void load();
  }

  async function deactivateNav(entry: NavEntryView): Promise<void> {
    if (!window.confirm(`Hide ${entry.label} from the sidebar? It can be re-enabled later.`)) return;
    try {
      await admin.deleteNavEntry(entry.id);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <>
      <PageHead
        title="Access admin"
        description="Roles and the sidebar catalogue. Both are database writes now — adding either needs no deploy."
        actions={
          <>
            {canCreate ? (
              <Button onClick={() => setNavForm('new')}>Add menu entry</Button>
            ) : null}
            {canCreate ? (
              <Button onClick={() => setUserForm(true)}>Add user</Button>
            ) : null}
            {canCreate ? (
              <Button variant="primary" onClick={() => setRoleForm('new')}>
                Add role
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      <Panel
        title="Roles"
        sub={loading ? 'Loading' : `${roles.length} roles`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'l', label: 'Label' },
            { key: 'n', label: 'Name' },
            { key: 'p', label: 'Permissions' },
            { key: 's', label: 'Scope' },
            { key: 'lim', label: 'Approval limit', align: 'right' },
            { key: 'x', label: '' },
          ]}
          rows={
            roles.length === 0
              ? [[loading ? 'Loading roles…' : 'No roles. Use Add role.']]
              : roles.map((r): React.ReactNode[] => [
                  r.label,
                  <span key="n" className="num text-[12px]" style={{ color: 'var(--muted)' }}>
                    {r.name}
                  </span>,
                  <span key="p" className="num">{r.permissions.length}</span>,
                  <Chip key="s" tone={r.projectScopeAll ? 'info' : 'warn'}>
                    {r.projectScopeAll ? 'All projects' : 'Scoped'}
                  </Chip>,
                  <span key="lim" className="num">
                    {r.approvalLimit > 0
                      ? `₹${(r.approvalLimit / 100000).toLocaleString('en-IN')}L`
                      : '—'}
                  </span>,
                  <span key="x" className="flex justify-end gap-2">
                    {r.isSystem ? <Chip tone="mute">System</Chip> : null}
                    {canUpdate ? (
                      <Button onClick={() => setRoleForm(r)}>Edit</Button>
                    ) : null}
                    {canDelete && !r.isSystem ? (
                      <Button onClick={() => void removeRole(r)}>Delete</Button>
                    ) : null}
                  </span>,
                ])
          }
        />
      </Panel>

      <Panel
        title="User role assignments"
        sub={users.length === 0 ? 'No users yet' : `${users.length} accounts · pick a role for each`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'current', label: 'Current role' },
            { key: 'assign', label: 'Assign role', align: 'right' },
          ]}
          empty="No users found. Create accounts from the developer panel, then assign roles here."
          rows={users.map((u): React.ReactNode[] => [
            <span key="n" className="font-semibold">{u.name}</span>,
            <span key="e" className="text-[12px]" style={{ color: 'var(--muted)' }}>{u.email}</span>,
            <span key="c">
              {roles.find((r) => r.name === u.role)?.label ?? u.role}
            </span>,
            <select
              key="a"
              value={u.role}
              onChange={(e) => void assignRole(u.id, e.target.value)}
              className="rounded px-2 py-1 text-[12.5px]"
              style={{ border: '1px solid var(--line)', background: 'var(--panel)', minWidth: '160px' }}
            >
              {roles.map((r) => (
                <option key={r.name} value={r.name}>{r.label}</option>
              ))}
            </select>,
          ])}
        />
      </Panel>

      <div className="mt-[18px]" />

      <Panel
        title="Sidebar catalogue"
        sub={loading ? 'Loading' : `${nav.length} entries`}
        bodyless
      >
        <DataTable
          columns={[
            { key: 's', label: 'Suite' },
            { key: 'g', label: 'Group' },
            { key: 'l', label: 'Label' },
            { key: 'p', label: 'Path' },
            { key: 'r', label: 'Permission' },
            { key: 'o', label: 'Order', align: 'right' },
            { key: 'st', label: 'Active', align: 'right' },
            { key: 'x', label: '' },
          ]}
          rows={
            nav.length === 0
              ? [[loading ? 'Loading catalogue…' : 'No entries. Use Add menu entry.']]
              : nav.map((e): React.ReactNode[] => [
                  <Chip key="s" tone="mute">{e.suite}</Chip>,
                  e.group,
                  e.label,
                  <span key="p" className="num text-[12px]" style={{ color: 'var(--muted)' }}>
                    {e.path}
                  </span>,
                  <span key="r" className="num text-[12px]">{e.requiredPermission}</span>,
                  <span key="o" className="num">{e.sortOrder}</span>,
                  <Chip key="st" tone={e.isActive ? 'ok' : 'mute'}>
                    {e.isActive ? 'Active' : 'Hidden'}
                  </Chip>,
                  <span key="x" className="flex justify-end gap-2">
                    {canUpdate ? (
                      <Button onClick={() => setNavForm(e)}>Edit</Button>
                    ) : null}
                    {canDelete && e.isActive ? (
                      <Button onClick={() => void deactivateNav(e)}>Hide</Button>
                    ) : null}
                  </span>,
                ])
          }
        />
      </Panel>

      {roleForm ? (
        <RoleEditor
          role={roleForm === 'new' ? null : roleForm}
          permissions={permissions}
          users={users}
          canSave={canCreate || canUpdate}
          onCancel={
            () => setRoleForm(null)
          }
          onSubmit={saveRole}
        />
      ) : null}

      {navForm ? (
        <NavEntryEditor
          entry={navForm === 'new' ? null : navForm}
          permissions={permissions}
          canSave={canCreate || canUpdate}
          onCancel={() => setNavForm(null)}
          onSubmit={saveNav}
        />
      ) : null}

      {userForm ? (
        <UserEditor
          roles={roles}
          canSave={canCreate}
          onCancel={() => setUserForm(false)}
          onSubmit={saveUser}
        />
      ) : null}
    </>
  );
}

/**
 * Add a user straight from the developer panel. The full user lifecycle
 * (projects, clients, module access) lives on the Users screen; this is the
 * fast path — name, email, password, role.
 */
function UserEditor({
  roles,
  canSave,
  onCancel,
  onSubmit,
}: {
  roles: RoleOption[];
  canSave: boolean;
  onCancel: () => void;
  onSubmit: (body: { name: string; email: string; password: string; role: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('Passw0rd!');
  const [role, setRole] = useState('');

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
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Add user"
      onClick={() => !busy && onCancel()}
    >
      <form
        onSubmit={submit}
        className="my-6 w-full max-w-md rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', padding: '18px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 mb-4 text-[15px] font-semibold">Add user</h3>

        {error ? (
          <div className="mb-3">
            <Notice>{error}</Notice>
          </div>
        ) : null}

        <div className="grid gap-3">
          <FieldRow label="Name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canSave}
              placeholder="Full name"
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
          </FieldRow>
          <FieldRow label="Email" hint="lowercase, login id" required>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
              disabled={!canSave}
              placeholder="user@kec.in"
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
          </FieldRow>
          <FieldRow label="Password" hint="Shared default until first login (CR-19 kept)" required>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!canSave}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
          </FieldRow>
          <FieldRow label="Role" required>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={!canSave}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)', background: '#fff' }}
            >
              <option value="">Pick a role</option>
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.label}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSave || busy}>
            {busy ? 'Creating…' : 'Create user'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Role editor. For new roles, name and label are required; the admin picks
 * which existing users get the role here, so no second step on the users page.
 * For edits, the header reads off the existing role and the body is
 * permissions + scope only — the name stays as a display aid, not an input.
 */
function RoleEditor({
  role,
  permissions,
  users,
  canSave,
  onCancel,
  onSubmit,
}: {
  role: RoleOption | null;
  permissions: string[];
  users: UserOption[];
  canSave: boolean;
  onCancel: () => void;
  onSubmit: (body: RoleBody, assignToUsers?: string[]) => Promise<void>;
}) {
  const isNew = role === null;
  const [name, setName] = useState(role?.name ?? '');
  const [label, setLabel] = useState(role?.label ?? '');
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [scopeAll, setScopeAll] = useState(role?.projectScopeAll ?? false);
  const [assignedUsers, setAssignedUsers] = useState<Set<string>>(new Set());
  const [allSelected, setAllSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byModule = permissions.reduce<Record<string, string[]>>((acc, p) => {
    const [module] = p.split(':');
    (acc[module] ??= []).push(p);
    return acc;
  }, {});

  function toggleUser(id: string): void {
    setAssignedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setAllSelected(users.length > 0 && next.size === users.length);
      return next;
    });
  }

  function toggleAllUsers(checked: boolean): void {
    setAssignedUsers(checked ? new Set(users.map((u) => u.id)) : new Set());
    setAllSelected(checked);
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body: RoleBody = {
        permissions: selected,
        projectScopeAll: scopeAll,
      };
      if (isNew) {
        if (!name.trim() || !label.trim()) {
          setError('Name and label are required for a new role.');
          setBusy(false);
          return;
        }
        body.name = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        body.label = label.trim();
      }
      await onSubmit(body, assignedUsers.size > 0 ? [...assignedUsers] : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      onClick={() => !busy && onCancel()}
    >
      <div
        className="my-6 w-full max-w-2xl rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', padding: '18px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-[15px] font-semibold">
          {isNew ? 'Add role' : `Edit role · ${role?.label}`}
        </h3>

        {error ? (
          <div className="mb-3">
            <Notice>{error}</Notice>
          </div>
        ) : null}

        {isNew ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <FieldRow label="Name" hint="lowercase, underscores" required>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canSave}
                  placeholder="e.g. site_engineer"
                  className="w-full rounded px-2.5 py-1.5 text-[13px]"
                  style={{ border: '1px solid var(--line)' }}
                />
              </FieldRow>
              <FieldRow label="Label" required>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={!canSave}
                  placeholder="e.g. Site Engineer"
                  className="w-full rounded px-2.5 py-1.5 text-[13px]"
                  style={{ border: '1px solid var(--line)' }}
                />
              </FieldRow>
            </div>
          </>
        ) : null}

        <div className="mb-3">
          <FieldRow label="Permissions" hint="Toggle what this role may do, grouped by module">
            <div
              className="grid max-h-52 grid-cols-2 gap-x-5 gap-y-1 overflow-auto rounded p-3"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-2, var(--panel))' }}
            >
              {Object.entries(byModule).map(([module, perms]) => (
                <div key={module}>
                  <p className="mb-1 text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>
                    {module}
                  </p>
                  {perms.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-[12.5px]">
                      <input
                        type="checkbox"
                        disabled={!canSave}
                        checked={selected.includes(p)}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                          )
                        }
                      />
                      <span className="num">{p}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </FieldRow>
        </div>

        <div className="mb-3">
          <FieldRow label="Project scope" hint="If unchecked, users with this role only see assigned projects">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={scopeAll}
                onChange={(e) => setScopeAll(e.target.checked)}
                disabled={!canSave}
              />
              All projects, no scope filter
            </label>
          </FieldRow>
        </div>

        {isNew ? (
          <div className="mb-4">
            <FieldRow label="Assign to users" hint="Select existing users to apply this role immediately">
              <div
                className="max-h-40 overflow-auto rounded p-2"
                style={{ border: '1px solid var(--line)', background: 'var(--panel-2, var(--panel))' }}
              >
                {users.length === 0 ? (
                  <p className="px-1 py-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                    No users yet. Create accounts from the developer panel first.
                  </p>
                ) : (
                  <>
                    <label
                      className="mb-1 flex items-center gap-2 rounded px-2 py-1 text-[12.5px] font-medium"
                      style={{ color: 'var(--ink)' }}
                    >
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleAllUsers(e.target.checked)}
                        disabled={!canSave}
                      />
                      Select all {users.length} users
                    </label>
                    {users.map((u) => (
                      <label
                        key={u.id}
                        className="flex items-center gap-2 rounded px-2 py-1 text-[12.5px]"
                        style={{
                          background: assignedUsers.has(u.id) ? 'var(--accent-soft, #eef5f2)' : undefined,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={assignedUsers.has(u.id)}
                          onChange={() => toggleUser(u.id)}
                          disabled={!canSave}
                        />
                        <span className="font-medium">{u.name}</span>
                        <span className="num text-[11.5px]" style={{ color: 'var(--muted)' }}>
                          {u.email}
                        </span>
                      </label>
                    ))}
                  </>
                )}
              </div>
            </FieldRow>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!canSave || busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : isNew ? 'Create role' : 'Save role'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Menu entry editor. Mirrors the record type designer: pick suite, group, route. */
function NavEntryEditor({
  entry,
  permissions,
  canSave,
  onCancel,
  onSubmit,
}: {
  entry: NavEntryView | null;
  permissions: string[];
  canSave: boolean;
  onCancel: () => void;
  onSubmit: (body: NavEntryBody) => Promise<void>;
}) {
  const [suite, setSuite] = useState<string>(entry?.suite ?? 'backoffice');
  const [group, setGroup] = useState(entry?.group ?? '');
  const [path, setPath] = useState(entry?.path ?? '');
  const [label, setLabel] = useState(entry?.label ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [permission, setPermission] = useState(entry?.requiredPermission ?? '');
  const [order, setOrder] = useState(String(entry?.sortOrder ?? 100));
  const [active, setActive] = useState(entry?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suites = ['backoffice', 'epc', 'pmc', 'eptp', 'om', 'shared'];

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        suite: suite as NavEntryBody['suite'],
        group: group.trim(),
        path: path.trim(),
        label: label.trim(),
        description: description.trim(),
        requiredPermission: permission.trim(),
        sortOrder: Number(order) || 100,
        isActive: active,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(15, 23, 42, 0.45)' }}
      onClick={() => !busy && onCancel()}
    >
      <div
        className="my-6 w-full max-w-xl rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', padding: '18px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-[15px] font-semibold">
          {entry ? `Edit entry · ${entry.label}` : 'Add menu entry'}
        </h3>

        {error ? (
          <div className="mb-3">
            <Notice>{error}</Notice>
          </div>
        ) : null}

        <div className="mb-3 grid grid-cols-2 gap-3">
          <FieldRow label="Suite">
            <select
              value={suite}
              onChange={(e) => setSuite(e.target.value)}
              disabled={!canSave}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            >
              {suites.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Group">
            <input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              disabled={!canSave}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
          </FieldRow>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <FieldRow label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={!canSave}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
          </FieldRow>
          <FieldRow label="Path" hint="Route under the dashboard">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={!canSave}
              placeholder="/epc/compliance"
              className="num w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
          </FieldRow>
        </div>

        <div className="mb-3">
          <FieldRow label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canSave}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
          </FieldRow>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <FieldRow label="Required permission">
            <input
              list="access-permissions"
              value={permission}
              onChange={(e) => setPermission(e.target.value)}
              disabled={!canSave}
              className="num w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
            <datalist id="access-permissions">
              {permissions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </FieldRow>
          <FieldRow label="Order">
            <input
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              disabled={!canSave}
              inputMode="numeric"
              className="num w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)' }}
            />
          </FieldRow>
        </div>

        <div className="mb-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              disabled={!canSave}
            />
            Visible in the sidebar
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!canSave || busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Save entry'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Labeled control row, matching the register designer's own pattern.
 * Kept local rather than shared because TypeDesigner does not export its copy.
 */
function FieldRow({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--muted)' }}>
        {label}
        {required ? <span style={{ color: 'var(--red)' }}> *</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px]" style={{ color: 'var(--faint)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
