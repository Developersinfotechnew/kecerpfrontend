'use client';

import { useEffect, useState } from 'react';

/**
 * Toasts.
 *
 * A tiny external store rather than a React context. Any module can call
 * `toast(...)` without being a component or a hook, which is what lets the
 * Button primitive raise a toast when it has no handler of its own. The host
 * component subscribes and renders.
 *
 * Deliberately not a context. A context would force every caller to be a
 * component inside the provider, and the one caller that matters — the Button
 * fallback — is a plain element.
 */

export type ToastTone = 'info' | 'ok' | 'warn';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(items);
}

/**
 * Shows a toast. Returns nothing: a toast is fire-and-forget.
 *
 * The default lifetime is 2.6 seconds, long enough to read a short sentence at
 * a glance without the stack lingering over the page.
 */
export function toast(message: string, tone: ToastTone = 'info', ttlMs = 2600): void {
  const id = nextId++;
  items = [...items, { id, message, tone }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, ttlMs);
}

/** Removes every toast at once. Used on sign-out. */
export function clearToasts(): void {
  items = [];
  emit();
}

/** Renders the toast stack. Mount once, at the app root. */
export function ToastHost() {
  const [current, setCurrent] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setCurrent);
    // Sync once on mount: a toast raised before the host mounted should still
    // appear rather than being lost.
    setCurrent(items);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  if (current.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {current.map((t) => (
        <div
          key={t.id}
          className="max-w-[340px] rounded px-3.5 py-2.5 text-[13px] shadow-lg"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderLeft: `3px solid ${toneColor(t.tone)}`,
            color: 'var(--text)',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

function toneColor(tone: ToastTone): string {
  switch (tone) {
    case 'ok':
      return 'var(--accent)';
    case 'warn':
      return 'var(--amber)';
    default:
      return 'var(--muted)';
  }
}
