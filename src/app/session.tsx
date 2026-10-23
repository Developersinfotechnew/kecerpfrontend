'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api, setAccessToken, registerOnUserRefreshed } from '@/lib/api';
import { clearToasts } from '@/components/toast';
import { auth, nav as navService } from '@/lib/services';
import type { ClientUser, SuiteCatalogue } from '@/lib/types';

/**
 * Session context.
 *
 * The access token lives in memory inside the api module. This context holds
 * the decoded user and the nav catalogue, both fetched once on mount.
 *
 * On a hard refresh there is no access token, so this calls /auth/me, which
 * 401s, which triggers the api client's single-flight refresh using the
 * httpOnly cookie. The user therefore survives a refresh without the token
 * ever being written to storage.
 */

interface SessionValue {
  user: ClientUser | null;
  catalogue: SuiteCatalogue[];
  loading: boolean;
  error: string | null;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [catalogue, setCatalogue] = useState<SuiteCatalogue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // When the api client rotates the access token via the refresh cookie, it
  // hands back the new user object here. Without this the context would keep
  // user: null after a cold-session refresh and the app would sit on Loading.
  useEffect(() => {
    const unregister = registerOnUserRefreshed((u) => {
      setUser(u);
      setLoading(false);
    });
    return unregister;
  }, []);

  // Skip the automatic mount-time probe on the login page. Firing /auth/me
  // there triggers a 401 refresh attempt on every mount and is the source of
  // the reload loop. Explicit calls to reload() (after a successful login)
  // still run the full fetch regardless of the current path.
  const autoLoaded = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (!force && autoLoaded.current) return;
      if (
        !force &&
        typeof window !== 'undefined' &&
        window.location.pathname === '/login'
      ) {
        setUser(null);
        setCatalogue([]);
        setLoading(false);
        return;
      }

      autoLoaded.current = true;
      setLoading(true);
      setError(null);

      try {
        const me = await auth.me();
        setUser(me);

        try {
          const cat = await navService.catalogue();
          setCatalogue(cat);
        } catch {
          // A nav failure must not blank the app. The sidebar falls back to the
          // shared group, and the API still enforces permissions.
          setCatalogue([]);
        }
      } catch {
        setUser(null);
        setCatalogue([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const reload = useCallback(async () => {
    await load(true);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      setCatalogue([]);
      clearToasts();
      window.location.href = '/login';
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      catalogue,
      loading,
      error,
      can: (permission: string) => user?.permissions.includes(permission) ?? false,
      logout,
      reload,
    }),
    [user, catalogue, loading, error, logout, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return value;
}
