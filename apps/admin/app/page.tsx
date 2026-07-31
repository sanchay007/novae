'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1';
const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY ?? 'dev-admin-key';

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': ADMIN_KEY,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function AdminPage() {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [reports, setReports] = useState<
    {
      id: string;
      reason: string;
      details?: string;
      reporter_name?: string;
      reported_name?: string;
      reported_user_id: string;
    }[]
  >([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      setError('');
      const s = await adminFetch<Record<string, number>>('/admin/stats');
      const r = await adminFetch<{ reports: typeof reports }>('/admin/reports');
      setStats(s);
      setReports(r.reports);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: string, action: 'dismiss' | 'ban') {
    await adminFetch(`/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    });
    await load();
  }

  return (
    <main
      style={{
        fontFamily: 'Georgia, serif',
        background: '#1A120B',
        color: '#F7EDE2',
        minHeight: '100vh',
        padding: 32,
      }}
    >
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>Novae Admin</h1>
      <p style={{ color: '#C4B5A5', marginBottom: 32 }}>Trust & safety desk</p>

      {error && <p style={{ color: '#E63946' }}>{error}</p>}

      {stats && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))',
            gap: 16,
            marginBottom: 40,
          }}
        >
          {Object.entries(stats).map(([k, v]) => (
            <div
              key={k}
              style={{
                background: '#2A1F16',
                border: '1px solid #4A3B2F',
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div style={{ color: '#C4B5A5', fontSize: 12 }}>{k}</div>
              <div style={{ fontSize: 28, color: '#F4A261' }}>{v}</div>
            </div>
          ))}
        </section>
      )}

      <h2 style={{ marginBottom: 16 }}>Open reports</h2>
      <div style={{ display: 'grid', gap: 12 }}>
        {reports.length === 0 && (
          <p style={{ color: '#C4B5A5' }}>No open reports.</p>
        )}
        {reports.map((r) => (
          <article
            key={r.id}
            style={{
              background: '#2A1F16',
              border: '1px solid #4A3B2F',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <strong>
              {r.reported_name ?? r.reported_user_id} — {r.reason}
            </strong>
            <p style={{ color: '#C4B5A5' }}>
              by {r.reporter_name ?? 'unknown'} · {r.details}
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button
                onClick={() => resolve(r.id, 'dismiss')}
                style={btnStyle}
              >
                Dismiss
              </button>
              <button
                onClick={() => resolve(r.id, 'ban')}
                style={{ ...btnStyle, background: '#E63946', color: '#fff' }}
              >
                Ban user
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

const btnStyle: Record<string, string | number> = {
  background: '#F4A261',
  color: '#1A120B',
  border: 0,
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 700,
  cursor: 'pointer',
};
