import 'dotenv/config';
import { Pool } from 'pg';
import {
  MAX_ACTIVE_MATCHES,
  SPARK_ACCEPT_WINDOW_HOURS,
  buildWhyMatched,
  cosineSimilarity,
  scoreMatchCandidate,
} from '@novae/shared';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://novae:novae@localhost:5432/novae',
});

function ageFromBirthDate(birthDate: string | Date | null): number {
  if (!birthDate) return 0;
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pseudoEmbed(text: string, dims = 64): number[] {
  return new Array(dims).fill(0).map((_, i) => {
    let h = 0;
    for (let c = 0; c < text.length; c++) {
      h = (h * 31 + text.charCodeAt(c) * (i + 1)) % 1000;
    }
    return (h / 1000) * 2 - 1;
  });
}

async function profileText(userId: string): Promise<string> {
  const profile = (
    await pool.query(`SELECT * FROM profiles WHERE user_id = $1`, [userId])
  ).rows[0];
  const prompts = (
    await pool.query(`SELECT prompt_key, answer FROM prompts WHERE user_id = $1`, [
      userId,
    ])
  ).rows;
  if (!profile) return '';
  return [
    profile.display_name,
    profile.bio,
    profile.headline,
    profile.intent,
    (profile.interests ?? []).join(' '),
    prompts.map((p: { prompt_key: string; answer: string }) => `${p.prompt_key} ${p.answer}`).join(' '),
  ]
    .filter(Boolean)
    .join('\n');
}

async function upsertEmbedding(userId: string): Promise<number[] | null> {
  const text = await profileText(userId);
  if (!text) return null;
  const embedding = pseudoEmbed(text);
  const vectorLiteral = `[${embedding.join(',')}]`;
  const jsonLiteral = JSON.stringify(embedding);

  try {
    await pool.query(
      `INSERT INTO embeddings (user_id, embedding, updated_at)
       VALUES ($1, $2::vector, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET embedding = EXCLUDED.embedding, updated_at = NOW()`,
      [userId, vectorLiteral],
    );
    // Best-effort JSON sidecar (column may be absent pre-migrate)
    await pool
      .query(
        `UPDATE embeddings SET embedding_json = $2::jsonb WHERE user_id = $1`,
        [userId, jsonLiteral],
      )
      .catch(() => undefined);
    return embedding;
  } catch {
    // pgvector cast/dim mismatch or missing extension — JSON fallback
    try {
      await pool.query(
        `INSERT INTO embeddings (user_id, embedding, embedding_json, updated_at)
         VALUES ($1, NULL, $2::jsonb, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET embedding_json = EXCLUDED.embedding_json, updated_at = NOW()`,
        [userId, jsonLiteral],
      );
      return embedding;
    } catch (fallbackErr) {
      // Skip cleanly — never crash the tick loop for one profile
      console.warn(
        `[worker] embedding upsert skipped for ${userId}:`,
        fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
      );
      return null;
    }
  }
}

async function activeCount(userId: string) {
  const { rows } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM matches
     WHERE status = 'active' AND (user_a_id = $1 OR user_b_id = $1)`,
    [userId],
  );
  return Number(rows[0]?.c ?? 0);
}

async function alreadySparkedToday(userId: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM sparks
     WHERE spark_date = CURRENT_DATE
       AND (user_a_id = $1 OR user_b_id = $1)
       AND status NOT IN ('declined', 'expired')
       AND is_paid_extra = FALSE
     LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

async function blockedPair(a: string, b: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 1`,
    [a, b],
  );
  return rows.length > 0;
}

async function hasOpenPair(a: string, b: string) {
  const { rows } = await pool.query(
    `SELECT 1 FROM sparks
     WHERE status NOT IN ('declined', 'expired')
       AND ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
     LIMIT 1`,
    [a, b],
  );
  if (rows.length) return true;
  const matches = await pool.query(
    `SELECT 1 FROM matches
     WHERE status = 'active'
       AND ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
     LIMIT 1`,
    [a, b],
  );
  return matches.rows.length > 0;
}

async function notifyUsers(
  userIds: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> },
) {
  for (const userId of userIds) {
    const { rows: tokens } = await pool.query<{ token: string }>(
      `SELECT token FROM device_tokens WHERE user_id = $1`,
      [userId],
    );
    console.log(
      `[worker:push] user=${userId} tokens=${tokens.length} title=${payload.title}`,
    );
    await pool.query(
      `INSERT INTO moderation_events (user_id, kind, payload)
       VALUES ($1, 'push_log', $2)`,
      [
        userId,
        JSON.stringify({
          ...payload,
          tokenCount: tokens.length,
          source: 'worker',
          at: new Date().toISOString(),
        }),
      ],
    );

    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    if (!accessToken || !tokens.length) continue;
    const messages = tokens
      .filter(
        (t) =>
          t.token.startsWith('ExponentPushToken')
          || t.token.startsWith('ExpoPushToken'),
      )
      .map((t) => ({
        to: t.token,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
      }));
    if (!messages.length) continue;
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(messages),
      });
    } catch (err) {
      console.warn('[worker:push] Expo push error', err);
    }
  }
}

type CandidateShared = Parameters<typeof buildWhyMatched>[0];

async function findBestCandidate(
  user: Record<string, unknown>,
  users: Record<string, unknown>[],
  embeddings: Map<string, number[]>,
  opts: { skipSparkedToday: boolean; paired: Set<string> },
): Promise<{ id: string; score: number; shared: CandidateShared } | null> {
  const userId = user.user_id as string;
  let best: { id: string; score: number; shared: CandidateShared } | null = null;
  const myEmbed = embeddings.get(userId) ?? [];

  for (const candidate of users) {
    const candidateId = candidate.user_id as string;
    if (candidateId === userId) continue;
    if (opts.paired.has(candidateId)) continue;
    if (opts.skipSparkedToday && (await alreadySparkedToday(candidateId))) continue;
    if ((await activeCount(candidateId)) >= MAX_ACTIVE_MATCHES) continue;
    if (await blockedPair(userId, candidateId)) continue;
    if (await hasOpenPair(userId, candidateId)) continue;

    const age = ageFromBirthDate(candidate.birth_date as string | Date | null);
    if (age < (user.min_age as number) || age > (user.max_age as number)) continue;
    const myAge = ageFromBirthDate(user.birth_date as string | Date | null);
    if (myAge < (candidate.min_age as number) || myAge > (candidate.max_age as number)) {
      continue;
    }

    const userGenders = user.genders as string[] | null;
    if (userGenders?.length && candidate.gender && !userGenders.includes(candidate.gender as string)) {
      continue;
    }
    const candidateGenders = candidate.genders as string[] | null;
    if (
      candidateGenders?.length
      && user.gender
      && !candidateGenders.includes(user.gender as string)
    ) {
      continue;
    }

    if (
      user.latitude != null
      && candidate.latitude != null
      && haversineKm(
        user.latitude as number,
        user.longitude as number,
        candidate.latitude as number,
        candidate.longitude as number,
      ) > Math.min(user.max_distance_km as number, candidate.max_distance_km as number)
    ) {
      continue;
    }

    const sharedInterests = ((user.interests as string[]) ?? []).filter((i) =>
      ((candidate.interests as string[]) ?? []).includes(i),
    );
    const sim = cosineSimilarity(myEmbed, embeddings.get(candidateId) ?? []);
    const score = scoreMatchCandidate({
      embeddingSimilarity: (sim + 1) / 2,
      mutualLikePrior: sharedInterests.length ? 0.8 : 0.5,
      activityRecencyScore: 0.7,
    });

    if (!best || score > best.score) {
      best = {
        id: candidateId,
        score,
        shared: {
          interests: sharedInterests,
          intents:
            user.intent && user.intent === candidate.intent
              ? [user.intent as string]
              : [],
          city:
            user.city && user.city === candidate.city
              ? (user.city as string)
              : undefined,
        },
      };
    }
  }

  return best;
}

async function loadEligibleUsers() {
  const { rows } = await pool.query(
    `SELECT p.*, pref.genders, pref.min_age, pref.max_age, pref.max_distance_km, pref.intents
     FROM profiles p
     JOIN preferences pref ON pref.user_id = p.user_id
     JOIN users u ON u.id = p.user_id
     WHERE p.onboarding_complete = TRUE AND p.paused = FALSE AND u.is_banned = FALSE`,
  );
  const embeddings = new Map<string, number[]>();
  for (const u of rows) {
    const text = [
      u.display_name,
      u.bio,
      u.headline,
      u.intent,
      (u.interests ?? []).join(' '),
    ].join(' ');
    embeddings.set(u.user_id, pseudoEmbed(text));
  }
  return { users: rows as Record<string, unknown>[], embeddings };
}

async function runDailySparks() {
  console.log('[worker] Running Daily Spark job…');
  const { users, embeddings } = await loadEligibleUsers();
  const paired = new Set<string>();
  let created = 0;

  for (const user of users) {
    const userId = user.user_id as string;
    if (await alreadySparkedToday(userId)) continue;
    if ((await activeCount(userId)) >= MAX_ACTIVE_MATCHES) continue;
    if (paired.has(userId)) continue;

    const best = await findBestCandidate(user, users, embeddings, {
      skipSparkedToday: true,
      paired,
    });
    if (!best) continue;

    const why = buildWhyMatched(best.shared);
    const expires = new Date(Date.now() + SPARK_ACCEPT_WINDOW_HOURS * 60 * 60 * 1000);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO sparks (user_a_id, user_b_id, why_matched, score, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, best.id, why, best.score, expires],
    );
    paired.add(userId);
    paired.add(best.id);
    created += 1;
    void notifyUsers([userId, best.id], {
      title: 'Your Daily Spark is ready',
      body: 'Someone new is waiting — open Novae to decide.',
      data: { type: 'spark', sparkId: rows[0]?.id },
    });
  }

  console.log(`[worker] Created ${created} Daily Sparks`);
  return created;
}

/**
 * Fulfill pending Extra Spark purchases from spark_requests.
 * Refunds the entitlement if no eligible candidate is available.
 */
async function fulfillExtraSparks() {
  console.log('[worker] Fulfilling Extra Spark requests…');
  const { rows: requests } = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM spark_requests
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 50`,
  );
  if (!requests.length) {
    console.log('[worker] No pending Extra Spark requests');
    return 0;
  }

  const { users, embeddings } = await loadEligibleUsers();
  let fulfilled = 0;

  for (const req of requests) {
    const user = users.find((u) => u.user_id === req.user_id);
    if (!user) {
      await pool.query(
        `UPDATE spark_requests SET status = 'failed', error = 'profile_incomplete',
         fulfilled_at = NOW() WHERE id = $1`,
        [req.id],
      );
      await pool.query(
        `UPDATE entitlements SET extra_sparks = extra_sparks + 1, updated_at = NOW()
         WHERE user_id = $1`,
        [req.user_id],
      );
      continue;
    }

    if ((await activeCount(req.user_id)) >= MAX_ACTIVE_MATCHES) {
      // Keep pending — user needs a free slot; do not refund yet
      console.log(`[worker] Extra Spark ${req.id}: user at match cap, retry later`);
      continue;
    }

    const best = await findBestCandidate(user, users, embeddings, {
      skipSparkedToday: false,
      paired: new Set(),
    });

    if (!best) {
      await pool.query(
        `UPDATE spark_requests SET status = 'failed', error = 'no_candidate',
         fulfilled_at = NOW() WHERE id = $1`,
        [req.id],
      );
      await pool.query(
        `UPDATE entitlements SET extra_sparks = extra_sparks + 1, updated_at = NOW()
         WHERE user_id = $1`,
        [req.user_id],
      );
      console.log(`[worker] Extra Spark ${req.id}: no candidate, refunded`);
      continue;
    }

    const why = buildWhyMatched(best.shared);
    const expires = new Date(Date.now() + SPARK_ACCEPT_WINDOW_HOURS * 60 * 60 * 1000);
    const spark = (
      await pool.query<{ id: string }>(
        `INSERT INTO sparks
         (user_a_id, user_b_id, why_matched, score, is_paid_extra, expires_at)
         VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id`,
        [req.user_id, best.id, why, best.score, expires],
      )
    ).rows[0]!;

    await pool.query(
      `UPDATE spark_requests SET status = 'fulfilled', spark_id = $1, fulfilled_at = NOW()
       WHERE id = $2`,
      [spark.id, req.id],
    );
    fulfilled += 1;
    void notifyUsers([req.user_id, best.id], {
      title: 'Extra Spark unlocked',
      body: 'Your Extra Spark is ready — open Novae to decide.',
      data: { type: 'spark', sparkId: spark.id, extra: true },
    });
  }

  console.log(`[worker] Fulfilled ${fulfilled} Extra Sparks`);
  return fulfilled;
}

/** Matching v2 stub: re-score using reply outcomes as priors. */
async function runMatchingV2Signals() {
  const { rows } = await pool.query(
    `SELECT m.id,
            COALESCE(EXTRACT(EPOCH FROM (NOW() - m.created_at))/86400, 0) AS age_days,
            (SELECT COUNT(*) FROM messages WHERE match_id = m.id) AS msg_count
     FROM matches m WHERE m.status = 'active'`,
  );
  console.log(`[worker] Matching v2 observed ${rows.length} active matches for LTR features`);
}

async function expireStale(): Promise<{ expiredSparks: number; expiredMatches: number }> {
  const expiredSparks = await pool.query(
    `UPDATE sparks SET status = 'expired'
     WHERE status IN ('pending', 'accepted_a', 'accepted_b')
       AND expires_at < NOW()`,
  );
  const expiredMatches = await pool.query(
    `UPDATE matches SET status = 'expired', updated_at = NOW()
     WHERE status = 'active'
       AND COALESCE(last_message_at, created_at) < NOW() - INTERVAL '7 days'`,
  );
  return {
    expiredSparks: expiredSparks.rowCount ?? 0,
    expiredMatches: expiredMatches.rowCount ?? 0,
  };
}

async function refreshEmbeddings(): Promise<{ attempted: number; stored: number }> {
  const { rows } = await pool.query(
    `SELECT user_id FROM profiles WHERE onboarding_complete = TRUE LIMIT 500`,
  );
  let stored = 0;
  for (const row of rows) {
    const result = await upsertEmbedding(row.user_id);
    if (result) stored += 1;
  }
  return { attempted: rows.length, stored };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function tick() {
  const summary = {
    expiredSparks: 0,
    expiredMatches: 0,
    sparksCreated: 0,
    embeddingsStored: 0,
    errors: [] as string[],
  };

  try {
    const expired = await expireStale();
    summary.expiredSparks = expired.expiredSparks;
    summary.expiredMatches = expired.expiredMatches;
  } catch (err) {
    summary.errors.push(`expireStale: ${errMessage(err)}`);
    console.error('[worker] expireStale failed', err);
  }

  try {
    const emb = await refreshEmbeddings();
    summary.embeddingsStored = emb.stored;
  } catch (err) {
    summary.errors.push(`refreshEmbeddings: ${errMessage(err)}`);
    console.error('[worker] refreshEmbeddings failed', err);
  }

  try {
    const extra = await fulfillExtraSparks();
    summary.sparksCreated += extra;
  } catch (err) {
    summary.errors.push(`fulfillExtraSparks: ${errMessage(err)}`);
    console.error('[worker] fulfillExtraSparks failed', err);
  }

  try {
    summary.sparksCreated += await runDailySparks();
  } catch (err) {
    summary.errors.push(`runDailySparks: ${errMessage(err)}`);
    console.error('[worker] runDailySparks failed', err);
  }

  try {
    await runMatchingV2Signals();
  } catch (err) {
    summary.errors.push(`runMatchingV2Signals: ${errMessage(err)}`);
    console.error('[worker] runMatchingV2Signals failed', err);
  }

  console.log(
    `[worker] tick summary: expiredSparks=${summary.expiredSparks} expiredMatches=${summary.expiredMatches} sparksCreated=${summary.sparksCreated} embeddingsStored=${summary.embeddingsStored} errors=${summary.errors.length}`,
  );
  if (summary.errors.length) {
    console.error('[worker] tick errors:', summary.errors);
  }
}

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
console.log(`Novae worker started (interval ${intervalMs}ms)`);
tick();
setInterval(tick, intervalMs);
