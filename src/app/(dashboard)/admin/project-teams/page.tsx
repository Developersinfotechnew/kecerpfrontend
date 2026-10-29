'use client';

import { useCallback, useEffect, useState } from 'react';

import { admin, projects } from '@/lib/services';
import type { ProjectOption, ProjectTeamMember, RoleOption, UserOption } from '@/lib/services';
import { useSession } from '@/app/session';
import { Button, Chip, DataTable, Notice, PageHead, Panel } from '@/components/ui';

/**
 * Project team manager.
 *
 * The superadmin picks a project and assigns users to its team, each with a
 * role. That role is per-project: the same user can be procurement on Jaipur
 * but PM on Kanpur. The approval queue uses these memberships to decide who
 * can act, so only the team of a plant sees and approves that plant's items.
 */
export default function ProjectTeamsPage() {
  const { user } = useSession();
  const isSuper = user?.role === 'superadmin';

  const [projectsList, setProjectsList] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [team, setTeam] = useState<ProjectTeamMember[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-to-team form.
  const [pickUser, setPickUser] = useState('');
  const [pickRole, setPickRole] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, u, r] = await Promise.all([
        projects.list({ kind: 'master' }),
        admin.users(),
        admin.roles(),
      ]);
      setProjectsList(p);
      setUsers(u);
      setRoles(r);
      // Default the role picker to the first role, but never reset a choice
      // the admin already made.
      setPickRole((cur) => (cur || (r[0]?.name ?? '')));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadTeam = useCallback(async () => {
    if (!selected) return;
    try {
      setTeam(await projects.team(selected));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    }
  }, [selected]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const availableUsers = users.filter((u) => !team.some((m) => m.userId === u.id));

  async function addMember(): Promise<void> {
    if (!selected || !pickUser) return;
    setError(null);
    try {
      await projects.addToTeam(selected, pickUser, pickRole);
      setPickUser('');
      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    }
  }

  async function removeMember(m: ProjectTeamMember): Promise<void> {
    if (!selected) return;
    if (!window.confirm(`Remove ${m.name} (${m.roleLabel}) from this team?`)) return;
    try {
      await projects.removeFromTeam(selected, m.id);
      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  }

  const selProject = projectsList.find((p) => p.id === selected);

  return (
    <>
      <PageHead
        title="Project teams"
        description="Assign users to each project's team. Only the team members of a project can act on its approval chains — one user can sit on several projects."
      />

      {error ? <Notice>{error}</Notice> : null}

      <Panel
        title="Pick a project"
        sub={loading ? 'Loading…' : `${projectsList.length} plants`}
      >
        <div className="flex flex-wrap gap-2">
          {projectsList.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p.id)}
              className="rounded px-3 py-2 text-left text-[12.5px]"
              style={{
                background: selected === p.id ? 'var(--accent-soft, #eef5f2)' : 'transparent',
                border: `1px solid ${selected === p.id ? 'var(--line)' : 'var(--line)'}`,
                color: 'var(--ink)',
              }}
            >
              <span className="block font-semibold">{p.name}</span>
              <span className="num text-[11px]" style={{ color: 'var(--muted)' }}>
                {p.code} · {p.location}
              </span>
            </button>
          ))}
        </div>
      </Panel>

      {selected ? (
        <Panel
          title={`Team · ${selProject?.name ?? selected}`}
          sub={team.length ? `${team.length} members` : 'No team assigned'}
          bodyless
        >
          {isSuper ? (
            <div className="flex flex-wrap items-end gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
              <div>
                <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Add user</span>
                <select
                  value={pickUser}
                  onChange={(e) => setPickUser(e.target.value)}
                  className="rounded px-2 py-1.5 text-[12.5px]"
                  style={{ border: '1px solid var(--line)', background: 'var(--panel)', minWidth: '180px' }}
                >
                  <option value="">Select a user…</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>Role on this project</span>
                <select
                  value={pickRole}
                  onChange={(e) => setPickRole(e.target.value)}
                  className="rounded px-2 py-1.5 text-[12.5px]"
                  style={{ border: '1px solid var(--line)', background: 'var(--panel)', minWidth: '180px' }}
                >
                  {roles.map((r) => (
                    <option key={r.name} value={r.name}>{r.label}</option>
                  ))}
                </select>
              </div>
              <Button variant="primary" onClick={() => void addMember()} disabled={!pickUser || !pickRole}>
                Add to team
              </Button>
            </div>
          ) : null}

          {team.length === 0 ? (
            <p className="m-0 px-4 py-6 text-[13px]" style={{ color: 'var(--muted)' }}>
              No team assigned. An unassigned project has no approvers, so its chains stall.
              {isSuper ? ' Use the form above to build the team.' : ''}
            </p>
          ) : (
            <DataTable
              columns={[
                { key: 'name', label: 'Member' },
                { key: 'role', label: 'Role on project' },
                { key: 'added', label: 'Added' },
                { key: 'x', label: '', align: 'right' },
              ]}
              rows={team.map((m) => [
                <span key="n" className="font-semibold">
                  {m.name}
                  <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>{m.email}</span>
                </span>,
                <Chip key="r" tone="info">{m.roleLabel}</Chip>,
                <span key="a" className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  {new Date(m.addedAt).toLocaleDateString('en-IN')}
                </span>,
                <span key="x" className="flex justify-end">
                  {isSuper ? (
                    <Button onClick={() => void removeMember(m)}>Remove</Button>
                  ) : null}
                </span>,
              ])}
            />
          )}
        </Panel>
      ) : (
        <Panel title="No project selected">
          <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
            Pick a plant above to see and manage its team.
          </p>
        </Panel>
      )}
    </>
  );
}
