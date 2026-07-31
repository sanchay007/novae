import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';

type AuthState = {
  token: string | null;
  userId: string | null;
  loading: boolean;
  requestOtp: (phone: string) => Promise<{ debugCode?: string }>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTok] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getToken()
      .then(async (t) => {
        setTok(t);
        if (t) {
          try {
            const me = await api<{ profile: { user_id: string } }>('/profiles/me');
            setUserId(me.profile?.user_id ?? null);
          } catch {
            await setToken(null);
            setTok(null);
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      userId,
      loading,
      async requestOtp(phone: string) {
        return api('/auth/otp/request', {
          method: 'POST',
          body: JSON.stringify({ phone }),
          auth: false,
        });
      },
      async verifyOtp(phone: string, code: string) {
        const res = await api<{ accessToken: string; userId: string }>(
          '/auth/otp/verify',
          {
            method: 'POST',
            body: JSON.stringify({ phone, code }),
            auth: false,
          },
        );
        await setToken(res.accessToken);
        setTok(res.accessToken);
        setUserId(res.userId);
      },
      async signOut() {
        await setToken(null);
        setTok(null);
        setUserId(null);
      },
    }),
    [token, userId, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
