'use client';

import { useEffect, useMemo, useState } from 'react';

import { admin } from '@/lib/services';
import type { CreateProjectInput, UserOption, ManagerOption } from '@/lib/services';
import { Button, Notice, Chip } from '@/components/ui';

/**
 * Project creation, four steps.
 *
 * Step 1: commercial reference + master. Step 2: baseline. Step 3: team
 * (pick from the existing Users & Roles). Step 4: review and create. The
 * back end auto-starts the project_creation chain on create; activation
 * completes on its final approval.
 */

interface WizardDraft {
  clientId: string;
  contractNo: string;
  contractValue: string;
  code: string;
  name: string;
  location: string;
  technology: string;
  startDate: string;
  endDate: string;
  managerId: string;
  budget: string;
  targetMargin: string;
  teamUserIds: string[];
}

const EMPTY: WizardDraft = {
  clientId: '',
  contractNo: '',
  contractValue: '',
  code: '',
  name: '',
  location: '',
  technology: 'Bio-CNG',
  startDate: '',
  endDate: '',
  managerId: '',
  budget: '',
  targetMargin: '',
  teamUserIds: [],
};

const STEPS = ['Commercial & master', 'Baseline', 'Team', 'Review & create'] as const;

export function ProjectWizard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (body: CreateProjectInput) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<WizardDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [clientOpts, setClientOpts] = useState<Array<{ id: string; name: string; code: string }>>([]);

  function set<K extends keyof WizardDraft>(k: K, v: WizardDraft[K]) {
    setD((p) => ({ ...p, [k]: v }));
  }

  function toggleTeamUser(id: string) {
    setD((p) => ({
      ...p,
      teamUserIds: p.teamUserIds.includes(id)
        ? p.teamUserIds.filter((x) => x !== id)
        : [...p.teamUserIds, id],
    }));
  }

  const step1Valid = d.clientId !== '' && d.name.trim() !== '' && d.code.trim() !== '';
  const step3Valid = d.teamUserIds.length > 0;

  // Load pickers once: managers drive the master, users drive the team,
  // clients drive the commercial reference. All three come from existing
  // admin data, so no one types an email or an id by hand.
  useEffect(() => {
    admin.managers().then(setManagers).catch(() => setManagers([]));
    admin.users().then(setUsers).catch(() => setUsers([]));
    admin
      .clients()
      .then((rows) =>
        setClientOpts(rows.map((c) => ({ id: c.id, name: c.name, code: c.code }))),
      )
      .catch(() => setClientOpts([]));
  }, []);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onCreated({
        name: d.name,
        code: d.code,
        location: d.location,
        technology: d.technology,
        pm: '',
        managerId: d.managerId || undefined,
        clientId: d.clientId,
        capacityTpd: 0,
        contractValue: Number(d.contractValue) || 0,
        startDate: d.startDate,
        endDate: d.endDate,
        enabledStages: ['pmc', 'epc', 'eptp', 'om'],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setBusy(false);
    }
  }

  const input = 'w-full rounded px-2.5 py-1.5 text-[13px] num';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(15, 23, 41, 0.55)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="px-5 pt-4">
          <h3 className="m-0 text-[15px] font-semibold">Create project · step {step + 1} of 4</h3>
          <div className="mt-2 flex flex-wrap gap-1">
            {STEPS.map((s, i) => (
              <Chip key={s} tone={i === step ? 'ok' : i < step ? 'info' : 'mute'}>
                {i + 1}. {s}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-3 p-5">
          {step === 0 ? (
            <>
              <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
                Commercial reference and the project master. All pickers read from
                existing data.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Client" required>
                  <select className={input} value={d.clientId} onChange={(e) => set('clientId', e.target.value)}>
                    <option value="">Select client…</option>
                    {clientOpts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </Field>
                <Field label="Contract / order no.">
                  <input className={input} value={d.contractNo} onChange={(e) => set('contractNo', e.target.value)} />
                </Field>
                <Field label="Project name" required>
                  <input className={input} value={d.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label="Project code" required>
                  <input className={input} value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="KJP-01" />
                </Field>
                <Field label="Location">
                  <input className={input} value={d.location} onChange={(e) => set('location', e.target.value)} />
                </Field>
                <Field label="Technology">
                  <input className={input} value={d.technology} onChange={(e) => set('technology', e.target.value)} />
                </Field>
                <Field label="Contract start">
                  <input className={input} type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
                </Field>
                <Field label="Planned completion">
                  <input className={input} type="date" value={d.endDate} onChange={(e) => set('endDate', e.target.value)} />
                </Field>
                <Field label="Contract value (₹L)">
                  <input className={input} type="number" value={d.contractValue} onChange={(e) => set('contractValue', e.target.value)} />
                </Field>
                <Field label="Project manager">
                  <select className={input} value={d.managerId} onChange={(e) => set('managerId', e.target.value)}>
                    <option value="">Select manager…</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
                Commercial baseline. These numbers drive budget and margin.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Budget (₹L)">
                  <input className={input} type="number" value={d.budget} onChange={(e) => set('budget', e.target.value)} />
                </Field>
                <Field label="Target margin (%)">
                  <input className={input} type="number" value={d.targetMargin} onChange={(e) => set('targetMargin', e.target.value)} />
                </Field>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
                Pick the team from the existing user list. Each user can be on many
                projects; the role they hold on this project is set later under
                Admin → Project teams.
              </p>
              <div className="max-h-52 overflow-y-auto rounded p-2" style={{ border: '1px solid var(--line)', background: 'var(--panel-2, #f9fafb)' }}>
                {users.length === 0 ? (
                  <p className="px-1 py-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                    No users yet. Create accounts under Admin → Users and roles.
                  </p>
                ) : (
                  users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 rounded px-2 py-1 text-[12.5px]"
                      style={{
                        background: d.teamUserIds.includes(u.id) ? 'var(--accent-soft, #eef5f2)' : undefined,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={d.teamUserIds.includes(u.id)}
                        onChange={() => toggleTeamUser(u.id)}
                      />
                      <span className="font-medium">{u.name}</span>
                      <span className="num text-[11.5px]" style={{ color: 'var(--muted)' }}>
                        {u.role} · {u.email}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
                {d.teamUserIds.length} user{d.teamUserIds.length === 1 ? '' : 's'} selected.
              </p>
            </>
          ) : null}

          {step === 3 ? (
            <div>
              <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
                Review. On create the project lands in planning and its approval
                chain opens; it activates on the final approval.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
                <SummaryRow label="Name" value={d.name || '—'} />
                <SummaryRow label="Code" value={d.code || '—'} />
                <SummaryRow label="Client" value={clientOpts.find((c) => c.id === d.clientId)?.name ?? 'Not set'} />
                <SummaryRow label="Contract value" value={d.contractValue ? `₹${d.contractValue} L` : '—'} />
                <SummaryRow label="Manager" value={managers.find((m) => m.id === d.managerId)?.name ?? 'Not set'} />
                <SummaryRow label="Team" value={`${d.teamUserIds.length} user(s)`} />
              </div>
              {!step1Valid ? (
                <p className="mt-2 text-[12px]" style={{ color: 'var(--red, #b91c1c)' }}>
                  Client, project name and code are required. Go back to step 1.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? <Notice>{error}</Notice> : null}

        <div className="flex items-center justify-between gap-2 px-5 pb-5">
          <div className="flex gap-2">
            <Button onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
              Back
            </Button>
          </div>
          <div className="flex gap-2">
            {step < STEPS.length - 1 ? (
              <Button
                variant="primary"
                disabled={(step === 0 && !step1Valid) || (step === 2 && !step3Valid)}
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              >
                Next
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void submit()} disabled={busy || !step1Valid}>
                {busy ? 'Creating…' : 'Create project'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 rounded px-2 py-1" style={{ background: 'var(--panel-2, #f9fafb)' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="num font-medium">{value}</span>
    </div>
  );
}
