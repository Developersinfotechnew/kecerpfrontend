'use client';

/**
 * The dashboard layout owns the top-bar project switcher and persists the
 * signed-in user's choice to localStorage. Every screen that resolves its own
 * "current project" (the EPC dashboard, the project planner) must follow that
 * choice, or it snaps back to the first in-scope project and shows a plant the
 * user has not selected. This is the one place that choice is read from: the
 * layout writes it, the screens subscribe to it.
 *
 * It is a tiny external store so a screen can re-render the instant the switch
 * fires — no context wiring, no prop drilling, and it is safe to call from any
 * page that renders inside the dashboard layout.
 */

import { useSyncExternalStore } from 'react';

/** The active project name, or null when the scope is "All projects". */
let scopeName: string | null = null;
const subs = new Set<() => void>();

export function setScopeName(name: string | null): void {
  if (name === scopeName) return;
  scopeName = name;
  for (const f of subs) f();
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

const get = (): string | null => scopeName;

/**
 * The active project name for the signed-in user, or null for "All projects".
 * Subscribe so the calling screen re-renders when the switcher changes it.
 */
export function useScopeName(): string | null {
  return useSyncExternalStore(subscribe, get, get);
}
