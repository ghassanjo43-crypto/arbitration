import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionUser } from '@gaap/shared';
import { api, setAccessToken } from '../lib/api';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    try {
      const { data } = await api.post('/auth/refresh', {});
      setAccessToken(data.accessToken);
      const me = await api.get('/auth/me');
      // /auth/me returns the lean token user; hydrate a SessionUser shape.
      setUser({
        id: me.data.id,
        email: me.data.email,
        displayName: me.data.email,
        roles: me.data.roles,
        permissions: me.data.permissions,
        preferredLanguage: 'en',
        mfaEnabled: false,
        emailVerified: true,
        status: 'ACTIVE' as SessionUser['status'],
      });
    } catch {
      setUser(null);
      setAccessToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (email: string, password: string, mfaCode?: string) => {
    const { data } = await api.post('/auth/login', { email, password, mfaCode });
    setAccessToken(data.accessToken);
    setUser(data.user as SessionUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
