'use client';

import { useEffect, useState } from 'react';

import { admin } from '@/lib/services';
import type { CreateProjectInput, UserOption, ManagerOption } from '@/lib/services';
import { Button, Notice } from '@/components/ui';

/**
 * Project creation, four steps.
 *
 * Step 1: client, identity and scale. Step 2: commercial baseline and the
 * delivery phases. Step 3: the team (picked from the existing Users &
 * Roles). Step 4: review and create. The back end auto-starts the
 * project_creation chain on create; activation completes on its final
 * approval.
 *
 * Shell: a horizontal stepper up top (passed, current, ahead — the same
 * language as the approval tracker), grouped field sections per step, and a
 * sticky footer with validation state. Every field the project detail page
 * shows is asked here, so a new project never lands with a blank master.
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
  capacityTpd: string;
  projectType: string;
  currency: string;
  baselineStart: string;
  baselineFinish: string;
  enabledStages: string[];
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
  capacityTpd: '',
  projectType: 'EPC',
  currency: 'INR',
  baselineStart: '',
  baselineFinish: '',
  enabledStages: ['pmc', 'epc', 'eptp', 'om'],
};

const STAGE_LABELS: Record<string, string> = {
  pmc: 'PMC',
  epc: 'EPC',
  eptp: 'EPTP',
  om: 'O&M',
};

const STAGE_NAMES: string[] = ['pmc', 'epc', 'eptp', 'om'];

const STEPS = [
  { title: 'Identity & scale', short: 'Identity' },
  { title: 'Baseline & phases', short: 'Baseline' },
  { title: 'Team', short: 'Team' },
  { title: 'Review & create', short: 'Review' },
] as const;

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
  const [userQuery, setUserQuery] = useState('');

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
  const step2Valid = d.enabledStages.length > 0;
  const step3Valid = d.teamUserIds.length > 0;

  const missingOnStep1 = [
    d.clientId === '' ? 'Client' : '',
    d.name.trim() === '' ? 'Project name' : '',
    d.code.trim() === '' ? 'Project code' : '',
  ].filter(Boolean);

  const filteredUsers = users.filter((u) => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

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
        capacityTpd: Number(d.capacityTpd) || 0,
        contractValue: Number(d.contractValue) || 0,
        contractNo: d.contractNo || undefined,
        budget: d.budget ? Number(d.budget) : undefined,
        targetMargin: d.targetMargin ? Number(d.targetMargin) : undefined,
        projectType: d.projectType || undefined,
        currency: d.currency || undefined,
        baselineStart: d.baselineStart || null,
        baselineFinish: d.baselineFinish || null,
        startDate: d.startDate,
        endDate: d.endDate,
        enabledStages: d.enabledStages as ('pmc' | 'epc' | 'eptp' | 'om')[],
        stageBudgets: undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setBusy(false);
    }
  }

  const stepValid = step === 0 ? step1Valid : step === 1 ? step2Valid : step === 2 ? step3Valid : step1Valid;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(15, 23, 41, 0.55)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-lg shadow-2xl"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', maxHeight: '92vh' }}
      >
        {/* Header: title, progress, close */}
        <div className="flex items-center gap-4 px-6 pt-5" style={{ borderBottom: '1px solid var(--line-2)' }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="m-0 text-[16px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
                Create project
              </h3>
              <span className="text-[11.5px] font-medium" style={{ color: 'var(--muted)' }}>
                Step {step + 1} of {STEPS.length} · {STEPS[step].title}
              </span>
            </div>
            {/* Stepper rail: passed / current / ahead */}
            <div className="mt-3 flex items-center gap-1.5">
              {STEPS.map((s, i) => {
                const state = i < step ? 'done' : i === step ? 'current' : 'pending';
                return (
                  <div key={s.short} className="flex flex-1 items-center gap-1.5" style={{ minWidth: 0 }}>
                    <button
                      type="button"
                      disabled={i > step || busy}
                      onClick={() => setStep(i)}
                      className="flex flex-none flex-col items-center gap-1"
                      style={{ cursor: i <= step && !busy ? 'pointer' : 'default', background: 'transparent', border: 'none', padding: 0 }}
                      title={i <= step ? `Go to ${s.title}` : s.title}
                    >
                      <span
                        className="num flex h-[24px] w-[24px] items-center justify-center rounded-full text-[11px] font-bold"
                        style={{
                          background: state === 'done' ? 'var(--ok, #1a7f5b)' : state === 'current' ? 'var(--panel)' : 'var(--panel-2, #f4f2f0)',
                          border:
                            state === 'done'
                              ? '2px solid var(--ok, #1a7f5b)'
                              : state === 'current'
                                ? '2px solid var(--accent, #2f6f6a)'
                                : '2px solid var(--line-2, #e8e5e2)',
                          color: state === 'done' ? '#fff' : state === 'current' ? 'var(--accent, #2f6f6a)' : 'var(--faint, #9a958e)',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {state === 'done' ? '✓' : i + 1}
                      </span>
                      <span
                        className="text-[10.5px] font-medium"
                        style={{ color: state === 'current' ? 'var(--ink)' : 'var(--faint, #9a958e)' }}
                      >
                        {s.short}
                      </span>
                    </button>
                    {i < STEPS.length - 1 ? (
                      <span
                        className="h-[2px] flex-1 rounded-full"
                        style={{ background: i < step ? 'var(--ok, #1a7f5b)' : 'var(--line-2, #e8e5e2)', transition: 'background 0.2s ease' }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-[15px]"
            style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer' }}
            aria-label="Close without saving"
          >
            ×
          </button>
        </div>

        {/* Body: one section group per step */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {step === 0 ? (
            <div className="space-y-5">
              <SectionGroup label="Client & identity" hint="Who awards the work and what the plant is called.">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                  <Field label="Client" required>
                    <select className={inputCls} style={inputStyle} value={d.clientId} onChange={(e) => set('clientId', e.target.value)}>
                      <option value="">Select client…</option>
                      {clientOpts.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Project name" required>
                    <input className={inputCls} style={inputStyle} value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="4.8 TPD CBG Plant" />
                  </Field>
                  <Field label="Project code" required>
                    <input className={inputCls} style={inputStyle} value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="KJP-01" />
                  </Field>
                  <Field label="Location">
                    <input className={inputCls} style={inputStyle} value={d.location} onChange={(e) => set('location', e.target.value)} placeholder="Chomu, Jaipur (RJ)" />
                  </Field>
                  <Field label="Technology">
                    <input className={inputCls} style={inputStyle} value={d.technology} onChange={(e) => set('technology', e.target.value)} />
                  </Field>
                </div>
              </SectionGroup>

              <SectionGroup label="Type & scale" hint="How the plant is contracted and sized.">
                <div className="grid grid-cols-3 gap-x-4 gap-y-3.5">
                  <Field label="Project type">
                    <select className={inputCls} style={inputStyle} value={d.projectType} onChange={(e) => set('projectType', e.target.value)}>
                      {['EPC', 'CBG', 'Plant', 'Other'].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Currency">
                    <select className={inputCls} style={inputStyle} value={d.currency} onChange={(e) => set('currency', e.target.value)}>
                      {['INR', 'USD', 'EUR'].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Capacity (TPD)">
                    <input className={inputCls} style={inputStyle} type="number" min="0" value={d.capacityTpd} onChange={(e) => set('capacityTpd', e.target.value)} placeholder="4.8" />
                  </Field>
                </div>
              </SectionGroup>

              <SectionGroup label="Schedule & commercial" hint="Contract dates, value and the owner.">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                  <Field label="Contract start">
                    <input className={inputCls} style={inputStyle} type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
                  </Field>
                  <Field label="Planned completion">
                    <input className={inputCls} style={inputStyle} type="date" value={d.endDate} onChange={(e) => set('endDate', e.target.value)} />
                  </Field>
                  <Field label="Contract / order no.">
                    <input className={inputCls} style={inputStyle} value={d.contractNo} onChange={(e) => set('contractNo', e.target.value)} placeholder="PO-2026-114" />
                  </Field>
                  <Field label="Contract value (₹L)">
                    <input className={inputCls} style={inputStyle} type="number" min="0" value={d.contractValue} onChange={(e) => set('contractValue', e.target.value)} placeholder="Whole lakhs" />
                  </Field>
                  <Field label="Project manager">
                    <select className={inputCls} style={inputStyle} value={d.managerId} onChange={(e) => set('managerId', e.target.value)}>
                      <option value="">Select manager…</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </SectionGroup>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-5">
              <SectionGroup label="Commercial baseline" hint="These numbers drive budget and margin.">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                  <Field label="Budget (₹L)">
                    <input className={inputCls} style={inputStyle} type="number" min="0" value={d.budget} onChange={(e) => set('budget', e.target.value)} placeholder="Defaults to contract value" />
                  </Field>
                  <Field label="Target margin (%)">
                    <input className={inputCls} style={inputStyle} type="number" min="0" max="100" value={d.targetMargin} onChange={(e) => set('targetMargin', e.target.value)} placeholder="0" />
                  </Field>
                </div>
              </SectionGroup>

              <SectionGroup label="Schedule baseline" hint="Planning baseline, separate from the contract dates.">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                  <Field label="Baseline start">
                    <input className={inputCls} style={inputStyle} type="date" value={d.baselineStart} onChange={(e) => set('baselineStart', e.target.value)} />
                  </Field>
                  <Field label="Baseline finish">
                    <input className={inputCls} style={inputStyle} type="date" value={d.baselineFinish} onChange={(e) => set('baselineFinish', e.target.value)} />
                  </Field>
                </div>
              </SectionGroup>

              <SectionGroup label="Delivery phases" hint="What the client bought. At least one is required — the master fans out one stage project per phase.">
                <div className="grid grid-cols-2 gap-2">
                  {STAGE_NAMES.map((s) => {
                    const on = d.enabledStages.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          set('enabledStages', on ? d.enabledStages.filter((x) => x !== s) : [...d.enabledStages, s])
                        }
                        className="flex items-center gap-3 rounded-md px-3.5 py-2.5 text-left"
                        style={{
                          background: on ? 'var(--accent-soft, #eef5f2)' : 'var(--panel)',
                          border: `1px solid ${on ? 'var(--accent, #2f6f6a)' : 'var(--line)'}`,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded text-[10px] font-bold"
                          style={{
                            background: on ? 'var(--accent, #2f6f6a)' : 'var(--panel-2, #f4f2f0)',
                            color: on ? '#fff' : 'var(--faint, #9a958e)',
                            border: on ? 'none' : '1px solid var(--line)',
                          }}
                        >
                          {on ? '✓' : ''}
                        </span>
                        <span className="text-[13px] font-semibold" style={{ color: on ? 'var(--ink)' : 'var(--muted)' }}>
                          {STAGE_LABELS[s]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </SectionGroup>
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <SectionGroup
                label={`Team · ${d.teamUserIds.length} selected`}
                hint="Each user can sit on many projects; their role on this one is set later under Admin → Project teams."
              >
                <input
                  type="text"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Filter by name or email…"
                  className="mb-2.5 w-full rounded-md px-3 py-2 text-[13px]"
                  style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none' }}
                />
                <div className="max-h-60 overflow-y-auto rounded-md" style={{ border: '1px solid var(--line)', background: 'var(--panel-2, #f9faf8)' }}>
                  {filteredUsers.length === 0 ? (
                    <p className="m-0 px-3 py-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                      {users.length === 0 ? 'No users yet. Create accounts under Admin → Users and roles.' : 'No user matches the filter.'}
                    </p>
                  ) : (
                    filteredUsers.map((u) => {
                      const on = d.teamUserIds.includes(u.id);
                      return (
                        <label
                          key={u.id}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2"
                          style={{
                            background: on ? 'var(--accent-soft, #eef5f2)' : 'transparent',
                            borderBottom: '1px solid var(--line-2, #efece9)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleTeamUser(u.id)}
                            className="h-4 w-4 flex-none"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium" style={{ color: 'var(--ink)' }}>{u.name}</span>
                            <span className="num block text-[11px]" style={{ color: 'var(--muted)' }}>{u.email}</span>
                          </span>
                          <span
                            className="num rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                            style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--muted)' }}
                          >
                            {u.role}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </SectionGroup>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <SectionGroup label="Review" hint="On create the project lands in planning and its approval chain opens. It activates on the final approval.">
                <ReviewGroup title="Identity" onEdit={() => setStep(0)} rows={[
                  ['Project', `${d.name || '—'} (${d.code || '…'})`],
                  ['Client', clientOpts.find((c) => c.id === d.clientId)?.name ?? 'Not set'],
                  ['Type · Currency', `${d.projectType} · ${d.currency}`],
                  ['Capacity', d.capacityTpd ? `${d.capacityTpd} TPD` : '—'],
                  ['Technology', d.technology || '—'],
                ]} />
                <ReviewGroup title="Schedule & commercial" onEdit={() => setStep(0)} rows={[
                  ['Contract value', d.contractValue ? `₹${Number(d.contractValue).toLocaleString('en-IN')} L` : '—'],
                  ['Contract no.', d.contractNo || '—'],
                  ['Start · Completion', `${d.startDate || '—'} · ${d.endDate || '—'}`],
                  ['Manager', managers.find((m) => m.id === d.managerId)?.name ?? 'Not set'],
                ]} />
                <ReviewGroup title="Baseline & phases" onEdit={() => setStep(1)} rows={[
                  ['Budget', d.budget ? `₹${Number(d.budget).toLocaleString('en-IN')} L` : 'Contract value'],
                  ['Target margin', d.targetMargin ? `${d.targetMargin}%` : '—'],
                  ['Phases', d.enabledStages.map((s) => STAGE_LABELS[s]).join(', ') || 'None'],
                  ['Baseline', d.baselineStart || d.baselineFinish ? `${d.baselineStart || '…'} → ${d.baselineFinish || '…'}` : '—'],
                ]} />
                <ReviewGroup title="Team" onEdit={() => setStep(2)} rows={[
                  ['Members', `${d.teamUserIds.length} selected`],
                ]} />
              </SectionGroup>
              {!step1Valid ? (
                <p className="mt-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: 'rgba(185, 28, 28, 0.07)', color: 'var(--red, #b91c1c)' }}>
                  Required on step 1: {missingOnStep1.join(', ')}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? <div className="px-6 pb-2"><Notice>{error}</Notice></div> : null}

        {/* Footer: validation state on the left, actions on the right */}
        <div
          className="flex items-center gap-3 px-6 py-3.5"
          style={{ borderTop: '1px solid var(--line)', background: 'var(--panel-2, #fbfaf9)' }}
        >
          <div className="min-w-0 flex-1 text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {step === 0 && !step1Valid ? `Required: ${missingOnStep1.join(', ')}` : ''}
            {step === 1 && !step2Valid ? 'Pick at least one delivery phase.' : ''}
            {step === 2 && !step3Valid ? 'Select at least one team member.' : ''}
            {stepValid ? (step === 3 ? 'Ready to create. The approval chain opens automatically.' : 'Looks good — continue.') : ''}
          </div>
          <div className="flex flex-none items-center gap-2">
            <Button onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" disabled={!stepValid || busy} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
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

/* ── Shared input styling ───────────────────────────────────────────── */

const inputCls = 'num w-full rounded-md px-3 py-2 text-[13px]';

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  background: 'var(--panel)',
  color: 'var(--ink)',
  outline: 'none',
};

function SectionGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline gap-2">
        <h4 className="m-0 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
          {label}
        </h4>
        {hint ? (
          <span className="truncate text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {hint}
          </span>
        ) : null}
      </div>
      <div style={{ background: 'var(--panel-2, #fbfaf9)', border: '1px solid var(--line-2, #efece9)', borderRadius: 8, padding: 14 }}>
        {children}
      </div>
    </section>
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
      <span className="mb-1 block text-[11.5px] font-medium" style={{ color: 'var(--muted)' }}>
        {label}
        {required ? (
          <span className="ml-0.5 font-semibold" style={{ color: 'var(--red, #b91c1c)' }}>
            *
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function ReviewGroup({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: Array<[string, string]>;
  onEdit: () => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--faint, #9a958e)' }}>
          {title}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="text-[11px] font-medium underline underline-offset-2"
          style={{ color: 'var(--accent, #2f6f6a)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 rounded px-2.5 py-1.5 text-[12.5px]" style={{ background: 'var(--panel-2, #f9faf8)' }}>
            <span style={{ color: 'var(--muted)' }}>{k}</span>
            <span className="num text-right font-medium" style={{ color: 'var(--ink)' }}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
