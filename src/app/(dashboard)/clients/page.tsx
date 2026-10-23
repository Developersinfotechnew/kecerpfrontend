'use client';

import { useCallback, useEffect, useState } from 'react';

import { admin } from '@/lib/services';
import type { ClientEntity, ServiceLine } from '@/lib/services';
import { useSession } from '../../session';
import { Button, DataTable, Notice, PageHead, Panel, RoleLetter, VitalsRail } from '@/components/ui';

const SVC_LABEL: Record<ServiceLine, string> = {
  backoffice: 'BO',
  pmc: 'PMC',
  epc: 'EPC',
  eptp: 'EPTP',
  om: 'O&M',
};

/** The four delivery lines a client buys. Back-office is a separate module. */
const SVC_ORDER: ServiceLine[] = ['pmc', 'epc', 'eptp', 'om'];

/**
 * Clients — who KEC works for, and which service lines each one bought.
 *
 * This list is live, not demo data. Every plant in the system points at a
 * client, so a project cannot be created until its client is onboarded here.
 * The create flow that follows is: client, then project, then team.
 */
export default function ClientsPage() {
  const { can } = useSession();
  const [clients, setClients] = useState<ClientEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClientEntity | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClients(await admin.clients());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(c: ClientEntity): Promise<void> {
    if (!window.confirm(`Remove ${c.name}? Its projects stay, the client is just offboarded.`)) return;
    setDeleting(c.id);
    setError(null);
    try {
      await admin.deleteClient(c.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove client');
    } finally {
      setDeleting(null);
    }
  }

  const active = clients.filter((c) => c.isActive);
  const count = (s: ServiceLine) => active.filter((c) => c.services.includes(s)).length;

  return (
    <>
      <PageHead
        title="Clients"
        description="Every client KEC has onboarded, and which of the four service lines — PMC, EPC, EPTP, O&M — each one currently avails. A client can hold any combination, and the modules that appear for them follow directly from this selection."
        actions={
          can('project:create') ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Onboard new client
            </Button>
          ) : null
        }
      />

      {error ? <Notice>{error}</Notice> : null}

      {creating ? (
        <ClientForm
          onCancel={() => setCreating(false)}
          onSubmit={async (body) => {
            await admin.createClient(body);
            setCreating(false);
            await load();
          }}
        />
      ) : null}

      {editing ? (
        <ClientForm
          client={editing}
          onCancel={() => setEditing(null)}
          onSubmit={async (body) => {
            await admin.updateClient(editing.id, body);
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      <VitalsRail
        items={[
          { label: 'Clients', value: String(active.length), note: 'Across 4 service lines' },
          { label: 'EPC engagements', value: String(count('epc')), note: 'Active plant construction' },
          { label: 'PMC engagements', value: String(count('pmc')), note: 'Advisory / governance only' },
          { label: 'EPTP engagements', value: String(count('eptp')), note: 'Engineering & BOQ package' },
          { label: 'O&M engagements', value: String(count('om')), note: 'Operating plants' },
        ]}
      />

      <div className="mt-[18px]" />

      {loading ? (
        <div className="rounded p-6 text-center text-[13px]" style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
          Loading clients…
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => (
            <div
              key={c.id}
              className="rounded-lg p-4"
              style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 1px 2px rgba(15,23,41,.03)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="m-0 truncate text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {c.name}
                  </h4>
                  <div className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
                    <span className="num">{c.code}</span>
                    {c.plant ? ` · ${c.plant}` : ''}
                  </div>
                </div>
                <div className="flex-none">
                  <span
                    className="inline-block rounded px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-wide"
                    style={
                      c.isActive
                        ? { background: 'var(--ok-soft)', color: 'var(--ok)' }
                        : { background: 'var(--panel-2)', color: 'var(--faint)' }
                    }
                  >
                    {c.isActive ? 'Active' : 'Offboarded'}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {SVC_ORDER.map((s) => {
                  const on = c.services.includes(s);
                  return (
                    <span
                      key={s}
                      className="rounded-full px-2 py-[3px] text-[10.5px] font-semibold"
                      style={
                        on
                          ? { background: 'var(--accent-soft)', color: 'var(--accent-dark)' }
                          : { background: 'var(--panel-2)', color: 'var(--faint)' }
                      }
                    >
                      {SVC_LABEL[s]}
                    </span>
                  );
                })}
              </div>

              {c.contactName ? (
                <div className="mt-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  <span className="font-medium" style={{ color: 'var(--text)' }}>{c.contactName}</span>
                  {c.contactPhone ? ` · ${c.contactPhone}` : ''}
                  {c.contactEmail ? ` · ${c.contactEmail}` : ''}
                </div>
              ) : null}

              {can('project:create') ? (
                <div className="mt-3 flex gap-2 border-t pt-3" style={{ borderColor: 'var(--line-2)' }}>
                  <Button variant="small" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  <Button
                    variant="small"
                    disabled={deleting === c.id}
                    onClick={() => void handleDelete(c)}
                  >
                    {deleting === c.id ? 'Removing…' : 'Remove'}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="mt-[18px]" />

      <Panel title="Service mix" sub="Who is availing what" bodyless>
        <DataTable
          columns={[
            { key: 'code', label: 'Code' },
            { key: 'c', label: 'Client' },
            { key: 'p', label: 'Plant' },
            { key: 'pmc', label: 'PMC', align: 'center' },
            { key: 'epc', label: 'EPC', align: 'center' },
            { key: 'eptp', label: 'EPTP', align: 'center' },
            { key: 'om', label: 'O&M', align: 'center' },
          ]}
          empty="No clients onboarded yet."
          rows={clients.map((c) => [
            <span key="code" className="num text-[12.5px]">
              {c.code}
            </span>,
            <span key="c" className="font-semibold">
              {c.name}
            </span>,
            c.plant || '—',
            c.services.includes('pmc') ? <RoleLetter key="pmc" letter="O" /> : <span key="pmc">—</span>,
            c.services.includes('epc') ? <RoleLetter key="epc" letter="O" /> : <span key="epc">—</span>,
            c.services.includes('eptp') ? <RoleLetter key="eptp" letter="O" /> : <span key="eptp">—</span>,
            c.services.includes('om') ? <RoleLetter key="om" letter="O" /> : <span key="om">—</span>,
          ])}
        />
      </Panel>
    </>
  );
}

interface ClientFormProps {
  /** When set, the form edits this client instead of creating a new one. */
  client?: ClientEntity;
  onCancel: () => void;
  onSubmit: (body: {
    name: string;
    code?: string;
    plant?: string;
    services?: ServiceLine[];
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
  }) => Promise<void>;
}

/**
 * Onboard a client.
 *
 * The service mix checkboxes are the substance. They declare which delivery
 * lines this client bought, and a project created against this client makes
 * sense only for the phases that are ticked here.
 *
 * Code is optional. When left blank the backend derives one from the name, so
 * a client always has an identifier without the admin typing it.
 */
function ClientForm({ client, onCancel, onSubmit }: ClientFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(client?.name ?? '');
  const [code, setCode] = useState(client?.code ?? '');
  const [plant, setPlant] = useState(client?.plant ?? '');
  const [contactName, setContactName] = useState(client?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(client?.contactPhone ?? '');
  const [services, setServices] = useState<Set<ServiceLine>>(
    new Set(client ? client.services : ['epc']),
  );
  const isEdit = client !== undefined;

  function toggle(s: ServiceLine): void {
    setServices((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Client name is required.');
      return;
    }
    if (services.size === 0) {
      setError('Tick at least one service line.');
      return;
    }

    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        code: code.trim() || undefined,
        plant: plant.trim() || undefined,
        contactName: contactName.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        services: [...services],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create client');
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
      aria-label="Onboard new client"
    >
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <header
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--line-2)' }}
        >
          <h3 className="m-0 text-[14px] font-semibold">Onboard new client</h3>
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

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
              Client name *
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded px-2.5 py-1.5 text-[13px]"
              style={{ border: '1px solid var(--line)', background: '#fff' }}
              placeholder="Shree Agro Energy Pvt Ltd"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Code (blank to derive)
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="num w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
                placeholder="SHREE"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Contact person
              </span>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Plant / facility
              </span>
              <input
                value={plant}
                onChange={(e) => setPlant(e.target.value)}
                className="w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
                placeholder="Kanpur Plant · Bio-CNG 150 TPD"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
                Contact phone
              </span>
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="num w-full rounded px-2.5 py-1.5 text-[13px]"
                style={{ border: '1px solid var(--line)', background: '#fff' }}
              />
            </label>
          </div>

          <div>
            <div className="mb-1.5 text-[12.5px] font-medium">Service lines this client avails *</div>
            <p className="mb-2 mt-0 text-[12px]" style={{ color: 'var(--muted)' }}>
              Determines which delivery phases a project against this client can have.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SVC_ORDER.map((s) => {
                const on = services.has(s);
                return (
                  <label
                    key={s}
                    className="flex cursor-pointer items-center gap-2.5 rounded px-3 py-2"
                    style={{
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                      background: on ? 'var(--accent-soft)' : '#fff',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(s)}
                      className="h-4 w-4"
                    />
                    <span className="text-[13px]">{SVC_LABEL[s]}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <footer
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--line-2)' }}
        >
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" className={busy ? 'opacity-60' : ''}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create client'}
          </Button>
        </footer>
      </form>
    </div>
  );
}
