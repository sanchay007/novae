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

async function upsertEmbedding(userId: string) {
  const text = await profileText(userId);
  if (!text) return;
  const embedding = pseudoEmbed(text);
  // Store as JSON for portability when pgvector dim differs in mock mode
  await pool.query(
    `INSERT INTO embeddings (user_id, embedding, updated_at)
     VALUES ($1, $2::vector, NOW())
     ON CONFLICT (user_id) DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = NOW()`,
    [userId, `[${embedding.join(',')}]`],
  ).catch(async () => {
    // If vector cast fails (dim mismatch), skip silently in mock
  });
  return embedding;
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

async function runDailySparks() {
  console.log('[worker] Running Daily Spark job…');
  const { rows: users } = await pool.query(
    `SELECT p.*, pref.genders, pref.min_age, pref.max_age, pref.max_distance_km, pref.intents
     FROM profiles p
     JOIN preferences pref ON pref.user_id = p.user_id
     JOIN users u ON u.id = p.user_id
     WHERE p.onboarding_complete = TRUE AND p.paused = FALSE AND u.is_banned = FALSE`,
  );

  const embeddings = new Map<string, number[]>();
  for (const u of users) {
    const text = [
      u.display_name,
      u.bio,
      u.headline,
      u.intent,
      (u.interests ?? []).join(' '),
    ].join(' ');
    embeddings.set(u.user_id, pseudoEmbed(text));
  }

  const paired = new Set<string>();
  let created = 0;

  for (const user of users) {
    if (await alreadySparkedToday(user.user_id)) continue;
    if ((await activeCount(user.user_id)) >= MAX_ACTIVE_MATCHES) continue;
    if (paired.has(user.user_id)) continue;

    let best: { id: string; score: number; shared: Parameters<typeof buildWhyMatched>[0] } | null =
      null;
    const myEmbed = embeddings.get(user.user_id) ?? [];

    for (const candidate of users) {
      if (candidate.user_id === user.user_id) continue;
      if (paired.has(candidate.user_id)) continue;
      if (await alreadySparkedToday(candidate.user_id)) continue;
      if ((await activeCount(candidate.user_id)) >= MAX_ACTIVE_MATCHES) continue;
      if (await blockedPair(user.user_id, candidate.user_id)) continue;

      const age = ageFromBirthDate(candidate.birth_date);
      if (age < user.min_age || age > user.max_age) continue;
      const myAge = ageFromBirthDate(user.birth_date);
      if (myAge < candidate.min_age || myAge > candidate.max_age) continue;

      if (user.genders?.length && candidate.gender && !user.genders.includes(candidate.gender)) {
        continue;
      }
      if (
        candidate.genders?.length
        && user.gender
        && !candidate.genders.includes(user.gender)
      ) {
        continue;
      }

      if (
        user.latitude != null
        && candidate.latitude != null
        && haversineKm(user.latitude, user.longitude, candidate.latitude, candidate.longitude)
          > Math.min(user.max_distance_km, candidate.max_distance_km)
      ) {
        continue;
      }

      const sharedInterests = (user.interests ?? []).filter((i: string) =>
        (candidate.interests ?? []).includes(i),
      );
      const sim = cosineSimilarity(myEmbed, embeddings.get(candidate.user_id) ?? []);
      const score = scoreMatchCandidate({
        embeddingSimilarity: (sim + 1) / 2,
        mutualLikePrior: sharedInterests.length ? 0.8 : 0.5,
        activityRecencyScore: 0.7,
      });

      if (!best || score > best.score) {
        best = {
          id: candidate.user_id,
          score,
          shared: {
            interests: sharedInterests,
            intents:
              user.intent && user.intent === candidate.intent ? [user.intent] : [],
            city:
              user.city && user.city === candidate.city ? user.city : undefined,
          },
        };
      }
    }

    if (!best) continue;

    const why = buildWhyMatched(best.shared);
    const expires = new Date(Date.now() + SPARK_ACCEPT_WINDOW_HOURS * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO sparks (user_a_id, user_b_id, why_matched, score, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.user_id, best.id, why, best.score, expires],
    );
    paired.add(user.user_id);
    paired.add(best.id);
    created += 1;
  }

  console.log(`[worker] Created ${created} Daily Sparks`);
  return created;
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

async function expireStale() {
  await pool.query(
    `UPDATE sparks SET status = 'expired'
     WHERE status IN ('pending', 'accepted_a', 'accepted_b')
       AND expires_at < NOW()`,
  );
  const expiredMatches = await pool.query(
    `UPDATE matches SET status = 'expired', updated_at = NOW()
     WHERE status = 'active'
       AND COALESCE(last_message_at, created_at) < NOW() - INTERVAL '7 days'`,
  );
  console.log(`[worker] Expired matches: ${expiredMatches.rowCount ?? 0}`);
}

async function refreshEmbeddings() {
  const { rows } = await pool.query(
    `SELECT user_id FROM profiles WHERE onboarding_complete = TRUE LIMIT 500`,
  );
  for (const row of rows) {
    await upsertEmbedding(row.user_id);
  }
  console.log(`[worker] Refreshed embeddings for ${rows.length} profiles`);
}

async function tick() {
  try {
    await expireStale();
    await refreshEmbeddings();
    await runDailySparks();
    await runMatchingV2Signals();
  } catch (err) {
    console.error('[worker] tick failed', err);
  }
}

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
console.log(`Novae worker started (interval ${intervalMs}ms)`);
tick();
setInterval(tick, intervalMs);
