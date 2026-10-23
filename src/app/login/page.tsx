'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PasswordField } from '@/components/PasswordField';
import { auth } from '@/lib/services';
import { useSession } from '../session';
import Image from 'next/image';

export default function LoginPage() {
  const router = useRouter();
  const { reload } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await auth.login(email.trim(), password);
      await reload();
      router.replace('/dashboard');
    } catch (err) {
      // Same message for both failure modes. The API already returns one
      // generic string, so the form cannot be used to discover valid emails.
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4" style={{ background: 'var(--canvas)' }}>
      <div
        className="w-full max-w-sm rounded-xl p-7"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 1px 3px rgba(15,23,41,.06)' }}
      >
        <div className="mb-6 flex items-center gap-3">
          <Image
            src="/images/logo/logo.png"
            alt="KEC Agritech logo"
            width={80}
            height={50}
            priority
            className="h-[50px] w-[80px] rounded-md object-contain"
          />
          <div>
            <h1 className="m-0 text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
              KEC Agritech ERP
            </h1>
            <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              PMC · EPTP · EPC · O&amp;M
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium" style={{ color: 'var(--ink-3)' }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md px-3 py-2 text-[14px]"
              style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
            />
          </div>

          <PasswordField
            id="password"
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
          />

          {error ? (
            <p role="alert" className="rounded-md px-3 py-2 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md px-4 py-2.5 text-[14px] font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-[11.5px]" style={{ color: 'var(--faint)' }}>
          Demo accounts are listed in the project README.
        </p>
      </div>
    </main>
  );
}
