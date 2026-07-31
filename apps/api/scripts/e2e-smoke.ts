/**
 * Novae API end-to-end smoke test.
 *
 * Prerequisites: API + Postgres up, seed applied (demo phones), OTP_PROVIDER=mock.
 * Run: npm run test:e2e -w @novae/api
 *
 * Env:
 *   NOVAE_API_URL  base URL including /v1 (default http://localhost:3000/v1)
 *   OTP_CODE       mock OTP (default 000000)
 */

const BASE_URL = (process.env.NOVAE_API_URL ?? 'http://localhost:3000/v1').replace(
  /\/$/,
  '',
);
const OTP_CODE = process.env.OTP_CODE ?? '000000';
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? 'dev-admin-key';

const SEED_PHONES = ['+919900000001', '+919900000002', '+919900000003'] as const;

/** Extra phones created by this script for match-cap / report flows. */
const EXTRA = {
  matchA: '+919900000101',
  matchB: '+919900000102',
  matchC: '+919900000103',
  matchD: '+919900000104', // 4th — should be held
  reportTarget: '+919900000199',
} as const;

type Json = Record<string, unknown>;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    const msg =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${status}`;
    super(`${path} → ${msg}`);
    this.name = 'ApiError';
  }
}

class InfraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfraError';
  }
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string, detail?: string) {
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, err: unknown) {
  failed += 1;
  const msg = err instanceof Error ? err.message : String(err);
  failures.push(`${label}: ${msg}`);
  console.error(`  ✗ ${label} — ${msg}`);
}

async function apiRaw(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...options.headers,
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new InfraError(
      `Cannot reach API at ${BASE_URL} (${cause}). Start Postgres + API first:\n` +
        `  docker compose up -d && npm run db:migrate && npm run db:seed && npm run dev:api`,
    );
  }

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: res.status, data };
}

async function api<T = Json>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const { status, data } = await apiRaw(path, options);
  if (status < 200 || status >= 300) {
    throw new ApiError(status, path, data);
  }
  return data as T;
}

async function login(phone: string): Promise<{ token: string; userId: string }> {
  await api('/auth/otp/request', { body: { phone } });
  const verified = await api<{ accessToken: string; userId: string }>(
    '/auth/otp/verify',
    { body: { phone, code: OTP_CODE } },
  );
  if (!verified.accessToken || !verified.userId) {
    throw new Error(`OTP verify missing token/userId for ${phone}`);
  }
  return { token: verified.accessToken, userId: verified.userId };
}

async function ensureProfile(
  token: string,
  patch: {
    displayName: string;
    gender: 'woman' | 'man' | 'non_binary' | 'other';
    birthDate?: string;
  },
) {
  const me = await api<{
    profile: { onboarding_complete?: boolean; display_name?: string } | null;
  }>('/profiles/me', { token });

  if (me.profile?.onboarding_complete && me.profile.display_name) {
    return me;
  }

  return api('/profiles/me', {
    method: 'PATCH',
    token,
    body: {
      displayName: patch.displayName,
      birthDate: patch.birthDate ?? '1996-06-15',
      gender: patch.gender,
      orientation: 'straight',
      intent: 'long_term',
      city: 'Bangalore',
      latitude: 12.97,
      longitude: 77.59,
      interests: ['coffee', 'hiking', 'film'],
      headline: 'E2E smoke profile',
      bio: 'Created by e2e-smoke.ts',
      dateIdeas: ['coffee', 'walk'],
    },
  });
}

async function unmatchAll(token: string) {
  // Unmatch can release held_for_slot sparks into new matches — drain until empty.
  for (let attempt = 0; attempt < 6; attempt++) {
    const list = await api<{ matches: { matchId: string }[] }>('/matches', { token });
    const matches = list.matches ?? [];
    if (matches.length === 0) return;
    for (const m of matches) {
      await api('/matches/unmatch', {
        token,
        body: { matchId: m.matchId, reason: 'e2e cleanup' },
      });
    }
  }
}

async function declineOpenSparks(token: string) {
  try {
    const today = await api<{
      sparkId?: string;
      status?: string;
    }>('/sparks/today', { token });
    if (
      today.sparkId
      && today.status
      && !['matched', 'declined', 'expired'].includes(today.status)
    ) {
      await api('/sparks/decide', {
        token,
        body: { sparkId: today.sparkId, accept: false },
      });
    }
  } catch {
    // ignore — not every user has a spark
  }
}

async function mutualLike(
  a: { token: string; userId: string },
  b: { token: string; userId: string },
): Promise<Json> {
  await api('/matches/swipe', {
    token: a.token,
    body: { targetUserId: b.userId, action: 'like' },
  });
  return api('/matches/swipe', {
    token: b.token,
    body: { targetUserId: a.userId, action: 'like' },
  });
}

async function probeApi(): Promise<void> {
  try {
    await api('/auth/otp/request', { body: { phone: SEED_PHONES[0] } });
  } catch (e) {
    if (e instanceof InfraError) throw e;
    // 4xx/5xx still means the process is up
    if (e instanceof ApiError) return;
    throw e;
  }
}

async function scenarioAuthAndProfiles() {
  console.log('\n[1] OTP login + profiles');
  const users: Record<string, { token: string; userId: string; phone: string }> = {};

  try {
    for (const phone of SEED_PHONES) {
      const session = await login(phone);
      users[phone] = { ...session, phone };
      ok(`login ${phone}`, session.userId.slice(0, 8));
    }

    const extras = [
      { phone: EXTRA.matchA, name: 'E2E-A', gender: 'man' as const },
      { phone: EXTRA.matchB, name: 'E2E-B', gender: 'woman' as const },
      { phone: EXTRA.matchC, name: 'E2E-C', gender: 'man' as const },
      { phone: EXTRA.matchD, name: 'E2E-D', gender: 'woman' as const },
      { phone: EXTRA.reportTarget, name: 'E2E-Report', gender: 'man' as const },
    ];
    for (const u of extras) {
      const session = await login(u.phone);
      await ensureProfile(session.token, {
        displayName: u.name,
        gender: u.gender,
      });
      users[u.phone] = { ...session, phone: u.phone };
      ok(`login+profile ${u.phone}`, u.name);
    }

    // Ensure seed profiles still look complete (seed should have done this)
    for (const phone of SEED_PHONES) {
      const u = users[phone]!;
      await ensureProfile(u.token, {
        displayName: phone.endsWith('1')
          ? 'Aanya'
          : phone.endsWith('2')
            ? 'Rohan'
            : 'Meera',
        gender: phone.endsWith('2') ? 'man' : 'woman',
      });
    }
    ok('seed profiles ensured');
  } catch (e) {
    fail('auth/profiles', e);
    throw e;
  }

  return users;
}

async function scenarioSparkOrExplore(
  users: Record<string, { token: string; userId: string; phone: string }>,
): Promise<{ matchId: string | null; path: string }> {
  console.log('\n[2] Daily Spark decide OR explore mutual match');
  const aanya = users[SEED_PHONES[0]]!;
  const rohan = users[SEED_PHONES[1]]!;

  try {
    const today = await api<{
      sparkId?: string;
      status?: string;
      spark?: null;
      message?: string;
      slotsRemaining?: number;
    }>('/sparks/today', { token: aanya.token });
    ok('GET /sparks/today', today.sparkId ? `spark ${today.sparkId.slice(0, 8)}` : 'no spark yet');

    if (today.sparkId && today.status && !['matched', 'declined', 'expired'].includes(today.status)) {
      const d1 = await api<{ status: string; matchId: string | null }>(
        '/sparks/decide',
        { token: aanya.token, body: { sparkId: today.sparkId, accept: true } },
      );
      ok('spark decide (Aanya)', d1.status);

      const otherPhone = await findSparkPartner(today.sparkId, aanya, users);
      if (!otherPhone) {
        ok('spark partner not in seed set — falling through to explore');
      } else {
        const other = users[otherPhone]!;
        const d2 = await api<{ status: string; matchId: string | null }>(
          '/sparks/decide',
          { token: other.token, body: { sparkId: today.sparkId, accept: true } },
        );
        ok('spark decide (partner)', `${d2.status}${d2.matchId ? ` match=${d2.matchId.slice(0, 8)}` : ''}`);
        if (d2.matchId) return { matchId: d2.matchId, path: 'spark' };
        if (d2.status === 'held_for_slot') {
          ok('spark held_for_slot (cap engaged)');
        }
      }
    } else {
      ok('spark skip', today.message ?? 'worker has not assigned today\'s spark');
    }

    // Explore mutual like between Aanya ↔ Rohan (idempotent if already matched)
    const swipe = await mutualLike(aanya, rohan);
    if (swipe.matched === true && typeof swipe.matchId === 'string') {
      ok('explore mutual match', swipe.matchId.slice(0, 8));
      return { matchId: swipe.matchId, path: 'explore' };
    }
    if (swipe.heldForSlot === true) {
      ok('explore mutual held_for_slot', String(swipe.message ?? ''));
      const list = await api<{ matches: { matchId: string }[] }>('/matches', {
        token: aanya.token,
      });
      return { matchId: list.matches[0]?.matchId ?? null, path: 'explore-held' };
    }

    // Already matched from a prior run
    const list = await api<{ matches: { matchId: string }[] }>('/matches', {
      token: aanya.token,
    });
    const withRohan = list.matches?.find(Boolean);
    if (withRohan) {
      ok('reuse existing match', withRohan.matchId.slice(0, 8));
      return { matchId: withRohan.matchId, path: 'existing' };
    }

    fail('spark/explore', new Error('No spark match and mutual swipe did not create a match'));
    return { matchId: null, path: 'none' };
  } catch (e) {
    fail('spark/explore', e);
    return { matchId: null, path: 'error' };
  }
}

/** Best-effort: infer spark partner from /sparks/today on other seed users. */
async function findSparkPartner(
  sparkId: string,
  self: { token: string; userId: string },
  users: Record<string, { token: string; userId: string; phone: string }>,
): Promise<string | null> {
  for (const phone of SEED_PHONES) {
    const u = users[phone]!;
    if (u.userId === self.userId) continue;
    try {
      const t = await api<{ sparkId?: string }>('/sparks/today', { token: u.token });
      if (t.sparkId === sparkId) return phone;
    } catch {
      // ignore
    }
  }
  return null;
}

async function resetLocalDatingState(
  users: Record<string, { token: string; userId: string; phone: string }>,
) {
  console.log('\n· reset sparks + matches for all e2e users');
  for (const u of Object.values(users)) {
    await declineOpenSparks(u.token);
  }
  for (const u of Object.values(users)) {
    await unmatchAll(u.token);
  }
  // Second pass after held-spark releases
  for (const u of Object.values(users)) {
    await unmatchAll(u.token);
  }
  ok('active matches/sparks cleared');
}

async function scenarioMatchCap(
  users: Record<string, { token: string; userId: string; phone: string }>,
) {
  console.log('\n[3] 3-match cap (4th mutual like held)');
  const hub = users[EXTRA.matchA]!;
  const partners = [
    users[EXTRA.matchB]!,
    users[EXTRA.matchC]!,
    users[EXTRA.matchD]!,
    users[SEED_PHONES[2]]!, // Meera as 4th partner
  ];

  try {
    for (const u of [hub, ...partners]) {
      await declineOpenSparks(u.token);
      await unmatchAll(u.token);
    }
    ok('cleanup prior matches for cap users');

    // Fill 3 slots without wiping hub between slots
    await unmatchAll(hub.token);
    for (const p of partners.slice(0, 3)) await unmatchAll(p.token);

    for (let i = 0; i < 3; i++) {
      const partner = partners[i]!;
      await unmatchAll(partner.token);
      let result: Json | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const hubSlots = await api<{ slotsRemaining: number }>('/matches', {
          token: hub.token,
        });
        const partnerSlots = await api<{ slotsRemaining: number }>('/matches', {
          token: partner.token,
        });
        if (hubSlots.slotsRemaining < 1) {
          throw new Error(`Hub has no free slot before match #${i + 1}`);
        }
        if (partnerSlots.slotsRemaining < 1) {
          await unmatchAll(partner.token);
          continue;
        }
        result = await mutualLike(hub, partner);
        if (result.matched === true && typeof result.matchId === 'string') break;
        if (result.heldForSlot) {
          await unmatchAll(partner.token);
          continue;
        }
      }
      if (!result || result.matched !== true || typeof result.matchId !== 'string') {
        throw new Error(
          `Expected match #${i + 1} with ${partner.phone}, got ${JSON.stringify(result)}`,
        );
      }
      ok(`match slot ${i + 1}/3`, result.matchId.slice(0, 8));
    }

    const atCap = await api<{ slotsRemaining: number; matches: unknown[] }>(
      '/matches',
      { token: hub.token },
    );
    if (atCap.slotsRemaining !== 0 || atCap.matches.length !== 3) {
      throw new Error(
        `Expected 3 matches / 0 slots, got matches=${atCap.matches.length} slots=${atCap.slotsRemaining}`,
      );
    }
    ok('slotsRemaining === 0 at cap');

    // 4th mutual like should be held
    const fourth = partners[3]!;
    await unmatchAll(fourth.token);
    const held = await mutualLike(hub, fourth);
    if (held.heldForSlot !== true || held.matched === true) {
      throw new Error(`Expected heldForSlot on 4th like, got ${JSON.stringify(held)}`);
    }
    ok('4th mutual like blocked/held', String(held.message ?? 'heldForSlot'));

    const still = await api<{ matches: unknown[] }>('/matches', { token: hub.token });
    if (still.matches.length !== 3) {
      throw new Error(`Expected still 3 matches, got ${still.matches.length}`);
    }
    ok('still exactly 3 active matches');
  } catch (e) {
    fail('match-cap', e);
  }
}

async function scenarioChatAndAi(
  users: Record<string, { token: string; userId: string; phone: string }>,
  matchId: string | null,
) {
  console.log('\n[4] Chat message + AI suggest (mock path, no OpenAI key)');
  const aanya = users[SEED_PHONES[0]]!;

  try {
    let id = matchId;
    if (!id) {
      const list = await api<{ matches: { matchId: string }[] }>('/matches', {
        token: aanya.token,
      });
      id = list.matches[0]?.matchId ?? null;
    }
    if (!id) {
      // Create a fresh match for chat using extras if seed pair is capped
      const hub = users[EXTRA.matchB]!;
      const other = users[EXTRA.matchC]!;
      await unmatchAll(hub.token);
      await unmatchAll(other.token);
      const created = await mutualLike(hub, other);
      if (created.matched === true && typeof created.matchId === 'string') {
        id = created.matchId;
        const msg = await api('/chat/messages', {
          token: hub.token,
          body: {
            matchId: id,
            body: 'Hey — e2e smoke says hi',
            clientMessageId: `e2e-${Date.now()}`,
          },
        });
        ok('POST /chat/messages', typeof (msg as Json).id === 'string' ? 'sent' : 'ok');

        const ai = await api<{ suggestions: string[] }>('/ai/suggest', {
          token: hub.token,
          body: { matchId: id, tone: 'sincere' },
        });
        if (!ai.suggestions?.length) throw new Error('No AI suggestions returned');
        ok('POST /ai/suggest', `${ai.suggestions.length} drafts (mock)`);
        return;
      }
      throw new Error('No active match available for chat/AI');
    }

    const msg = await api('/chat/messages', {
      token: aanya.token,
      body: {
        matchId: id,
        body: 'Hey — e2e smoke says hi',
        clientMessageId: `e2e-${Date.now()}`,
      },
    });
    ok('POST /chat/messages', typeof (msg as Json).id === 'string' ? 'sent' : 'ok');

    const ai = await api<{ suggestions: string[] }>('/ai/suggest', {
      token: aanya.token,
      body: { matchId: id, tone: 'playful' },
    });
    if (!ai.suggestions?.length) throw new Error('No AI suggestions returned');
    ok('POST /ai/suggest', `${ai.suggestions.length} drafts (mock)`);
  } catch (e) {
    fail('chat/ai', e);
  }
}

async function scenarioBillingAndSafety(
  users: Record<string, { token: string; userId: string; phone: string }>,
) {
  console.log('\n[5] Billing dev grant + safety report');
  const aanya = users[SEED_PHONES[0]]!;
  const target = users[EXTRA.reportTarget]!;

  try {
    const grant = await api<{ is_plus?: boolean; extra_sparks?: number }>(
      '/billing/dev/grant',
      {
        token: aanya.token,
        body: { plus: true, extraSparks: 1 },
      },
    );
    if (!grant.is_plus) throw new Error(`Expected is_plus, got ${JSON.stringify(grant)}`);
    ok('POST /billing/dev/grant', `plus + extra_sparks=${grant.extra_sparks}`);

    const report = await api<{ ok: boolean; reportId?: string }>('/safety/report', {
      token: aanya.token,
      body: {
        reportedUserId: target.userId,
        reason: 'spam',
        details: 'e2e-smoke disposable report target',
      },
    });
    if (!report.ok) throw new Error(`Report failed: ${JSON.stringify(report)}`);
    ok('POST /safety/report', report.reportId?.slice(0, 8) ?? 'ok');
  } catch (e) {
    fail('billing/safety', e);
  }
}

/** HARDEN contract: admin routes require x-admin-key; JWT alone is not enough. */
async function scenarioAdminKey(
  users: Record<string, { token: string; userId: string; phone: string }>,
) {
  console.log('\n· admin key');
  const aanya = users[SEED_PHONES[0]]!;

  try {
    const noKey = await apiRaw('/admin/health');
    if (noKey.status !== 401) {
      throw new Error(`Expected 401 without key, got ${noKey.status}`);
    }
    ok('GET /admin/health without key → 401');

    const wrongKey = await apiRaw('/admin/health', {
      headers: { 'x-admin-key': 'wrong-key' },
    });
    if (wrongKey.status !== 401) {
      throw new Error(`Expected 401 with wrong key, got ${wrongKey.status}`);
    }
    ok('GET /admin/health wrong key → 401');

    const jwtOnly = await apiRaw('/admin/stats', { token: aanya.token });
    if (jwtOnly.status !== 401) {
      throw new Error(`Expected 401 with JWT only, got ${jwtOnly.status}`);
    }
    ok('GET /admin/stats JWT only → 401');

    const health = await api<{ ok?: boolean; db?: unknown }>('/admin/health', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    if (!health.ok) throw new Error(`Expected ok, got ${JSON.stringify(health)}`);
    ok('GET /admin/health with admin key → 200', `db=${JSON.stringify(health.db)}`);

    const stats = await api<Json>('/admin/stats', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    if (typeof stats !== 'object' || stats === null) {
      throw new Error('Expected stats object');
    }
    ok('GET /admin/stats with admin key → 200');
  } catch (e) {
    fail('admin key', e);
  }
}

async function main() {
  console.log(`Novae e2e smoke → ${BASE_URL}`);
  console.log(`OTP code: ${OTP_CODE}`);

  try {
    await probeApi();
    ok('API reachable');
  } catch (e) {
    if (e instanceof InfraError) {
      console.error(`\n⚠ Soft-fail (infra): ${e.message}`);
      process.exit(2);
    }
    throw e;
  }

  let users: Record<string, { token: string; userId: string; phone: string }>;
  try {
    users = await scenarioAuthAndProfiles();
  } catch {
    console.error('\nCannot continue without auth. Aborting.');
    printSummary();
    process.exit(1);
  }

  await resetLocalDatingState(users);

  const { matchId } = await scenarioSparkOrExplore(users);
  await scenarioMatchCap(users);
  await scenarioChatAndAi(users, matchId);
  await scenarioBillingAndSafety(users);
  await scenarioAdminKey(users);

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  console.log('\n── summary ──');
  console.log(`passed: ${passed}  failed: ${failed}`);
  if (failures.length) {
    console.log('failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main().catch((e) => {
  if (e instanceof InfraError) {
    console.error(`\n⚠ Soft-fail (infra): ${e.message}`);
    process.exit(2);
  }
  console.error('\nUnexpected error:', e);
  process.exit(1);
});
