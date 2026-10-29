'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { admin, projects } from '@/lib/services';
import type { ProjectOption, ProjectTeamMember, RoleOption, UserOption } from '@/lib/services';
import { useSession } from '@/app/session';
import { Button, Chip, Notice, PageHead, Panel } from '@/components/ui';

/**
 * Project team manager.
 *
 * Two panes: every project on the left with its team size at a glance, the
 * team of the selected project on the right. The super admin builds each
 * team — add a user, change their role on that project, or remove them.
 * These memberships are what the approval engine checks: a user acts on a
 * project's chains only for the role they hold on that project's team.
 */
export default function ProjectTeamsPage() {
  const { user } = useSession();
  const isSuper = user?.role === 'superadmin';

  const [projectsList, setProjectsList] = useState<ProjectOption[]>([]);
  const [teamCounts, setTeamCounts] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<UserOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [team, setTeam] = useState<ProjectTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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
      setPickRole((cur) => cur || r[0]?.name || '');

      // One pass over the projects to know each team size, so the left pane
      // shows how many people sit on every project without opening it.
      const counts: Record<string, number> = {};
      const results = await Promise.allSettled(p.map((proj) => projects.team(proj.id)));
      results.forEach((res, i) => {
        if (res.status === 'fulfilled') counts[p[i].id] = res.value.length;
      });
      setTeamCounts(counts);
      if (!selected && p.length > 0) setSelected(p[0].id);
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
      const members = await projects.team(selected);
      setTeam(members);
      setTeamCounts((prev) => ({ ...prev, [selected]: members.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    }
  }, [selected]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const availableUsers = users.filter((u) => !team.some((m) => m.userId === u.id));

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projectsList;
    return projectsList.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.location ?? '').toLowerCase().includes(q),
    );
  }, [projectsList, search]);

  async function addMember(): Promise<void> {
    if (!selected || !pickUser || !pickRole) return;
    setError(null);
    try {
      await projects.addToTeam(selected, pickUser, pickRole);
      setPickUser('');
      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    }
  }

  async function changeRole(m: ProjectTeamMember, role: string): Promise<void> {
    if (!selected || !role) return;
    setError(null);
    try {
      const updated = await projects.changeTeamRole(selected, m.id, role);
      setTeam((prev) =>
        prev.map((x) =>
          x.id === m.id
            ? { ...x, role: updated.role, roleLabel: roles.find((r) => r.name === updated.role)?.label ?? updated.role }
            : x,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role');
    }
  }

  async function removeMember(m: ProjectTeamMember): Promise<void> {
    if (!selected) return;
    if (!window.confirm(`Remove ${m.name} (${m.roleLabel}) from this team? Their approvals on this project stop at the next step.`)) return;
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
        description="Who works on which project. An approval only moves on a project's team — add, re-role or remove a member to change who can act on that project's chains."
      />

      {error ? <Notice>{error}</Notice> : null}

      <div className="grid gap-3" style={{ gridTemplateColumns: '300px 1fr' }}>
        {/* Left pane: the project list */}
        <Panel
          title="Projects"
          sub={loading ? 'Loading…' : `${projectsList.length} projects`}
          bodyless
        >
          <div className="px-3 pt-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, location…"
              className="w-full rounded-md px-2.5 py-1.5 text-[12.5px]"
              style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none' }}
            />
          </div>
          <div className="mt-2 max-h-[560px] divide-y overflow-y-auto" style={{ borderColor: 'var(--line-2)' }}>
            {filteredProjects.map((p) => {
              const active = selected === p.id;
              const count = teamCounts[p.id];
              const empty = count === 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className="block w-full px-3.5 py-3 text-left no-underline"
                  style={{
                    background: active ? 'var(--accent-soft, #eef5f2)' : undefined,
                    borderLeft: active ? '3px solid var(--accent, #1a7f5b)' : '3px solid transparent',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {p.name}
                    </span>
                    {empty ? (
                      <Chip tone="warn">no team</Chip>
                    ) : (
                      <span className="num text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                        {count} member{count === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="num mt-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
                    {p.code}
                    {p.location ? ` · ${p.location}` : ''}
                  </div>
                </button>
              );
            })}
            {filteredProjects.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-[12.5px]" style={{ color: 'var(--muted)' }}>
                No project matches “{search}”.
              </div>
            ) : null}
          </div>
        </Panel>

        {/* Right pane: the selected project's team */}
        <Panel
          title={selProject ? selProject.name : 'Team'}
          sub={selProject ? `${selProject.code}${selProject.location ? ' · ' + selProject.location : ''}` : undefined}
          bodyless
        >
          {!selProject ? (
            <p className="m-0 px-4 py-6 text-[13px]" style={{ color: 'var(--muted)' }}>
              Pick a project on the left to see its team.
            </p>
          ) : (
            <>
              {/* Add a member */}
              {isSuper ? (
                <div
                  className="flex flex-wrap items-end gap-2.5 px-4 py-3"
                  style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--panel-2, #fbfaf9)' }}
                >
                  <div className="min-w-[200px] flex-1">
                    <span className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                      Add user
                    </span>
                    <select
                      value={pickUser}
                      onChange={(e) => setPickUser(e.target.value)}
                      className="w-full rounded-md px-2.5 py-2 text-[12.5px]"
                      style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none' }}
                    >
                      <option value="">Select a user…</option>
                      {availableUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} · {u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-[160px]">
                    <span className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                      Role on this project
                    </span>
                    <select
                      value={pickRole}
                      onChange={(e) => setPickRole(e.target.value)}
                      className="w-full rounded-md px-2.5 py-2 text-[12.5px]"
                      style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none' }}
                    >
                      {roles.map((r) => (
                        <option key={r.name} value={r.name}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button variant="primary" onClick={() => void addMember()} disabled={!pickUser || !pickRole}>
                    Add to team
                  </Button>
                </div>
              ) : null}

              {/* The team roster, grouped by role */}
              {team.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="text-[13px] font-medium">No team on this project</div>
                  <p className="mx-auto mt-1 max-w-[46ch] text-[12.5px]" style={{ color: 'var(--muted)' }}>
                    An approval on this project cannot move without a team
                    {isSuper ? ' — use the form above to build it' : ''}.
                  </p>
                </div>
              ) : (
                <div className="px-4 py-3">
                  {roles
                    .map((r) => ({
                      role: r,
                      members: team.filter((m) => m.role === r.name),
                    }))
                    .filter((g) => g.members.length > 0)
                    .map((g) => (
                      <div key={g.role.name} className="mb-3.5">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                            {g.role.label}
                          </span>
                          <span className="num text-[11px]" style={{ color: 'var(--faint)' }}>
                            {g.members.length}
                          </span>
                          <div className="h-px flex-1" style={{ background: 'var(--line-2)' }} />
                        </div>
                        <div className="space-y-px">
                          {g.members.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center gap-3 rounded-md px-3 py-2"
                              style={{ background: 'var(--panel-2, #f9fafb)' }}
                            >
                              <span
                                className="num flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full text-[11px] font-bold"
                                style={{ background: 'var(--accent-soft, #eef5f2)', color: 'var(--accent, #1a7f5b)' }}
                              >
                                {m.name
                                  .split(' ')
                                  .map((w) => w[0])
                                  .slice(0, 2)
                                  .join('')}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12.5px] font-semibold">{m.name}</div>
                                <div className="truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                                  {m.email} · added{' '}
                                  {new Date(m.addedAt).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                  })}
                                </div>
                              </div>
                              {isSuper ? (
                                <div className="flex flex-none items-center gap-2">
                                  <select
                                    value={m.role}
                                    onChange={(e) => void changeRole(m, e.target.value)}
                                    className="rounded-md px-2 py-1.5 text-[12px]"
                                    style={{
                                      border: '1px solid var(--line)',
                                      background: 'var(--panel)',
                                      color: 'var(--ink)',
                                      outline: 'none',
                                      minWidth: 150,
                                    }}
                                    title="Change role on this project"
                                  >
                                    {roles.map((r) => (
                                      <option key={r.name} value={r.name}>
                                        {r.label}
                                      </option>
                                    ))}
                                  </select>
                                  <Button onClick={() => void removeMember(m)}>Remove</Button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                  {team.some((m) => !roles.some((r) => r.name === m.role)) ? (
                    <div className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
                      Some members hold a role that is no longer in the catalogue; they still act as their role was recorded.
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
