import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

async function seed() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://novae:novae@localhost:5432/novae',
  });

  const schema = readFileSync(
    join(__dirname, '../../api/src/database/schema.sql'),
    'utf8',
  );
  await pool.query(schema);

  const users = [
    {
      phone: '+919900000001',
      name: 'Aanya',
      gender: 'woman',
      intent: 'long_term',
      city: 'Bangalore',
      lat: 12.97,
      lng: 77.59,
      interests: ['coffee', 'hiking', 'indie music'],
      headline: 'Looking for a Sunday ritual, not a highlight reel',
      bio: 'Product designer who still writes letters.',
      prompt: ['sunday_ideal', 'Farmers market then a long walk'],
    },
    {
      phone: '+919900000002',
      name: 'Rohan',
      gender: 'man',
      intent: 'long_term',
      city: 'Bangalore',
      lat: 12.98,
      lng: 77.6,
      interests: ['hiking', 'film', 'coffee'],
      headline: 'Will argue about the best dosa in town',
      bio: 'Engineer by day, terrible guitar by night.',
      prompt: ['debate_me', 'Whether pineapple belongs on pizza'],
    },
    {
      phone: '+919900000003',
      name: 'Meera',
      gender: 'woman',
      intent: 'long_term_open',
      city: 'Bangalore',
      lat: 12.96,
      lng: 77.58,
      interests: ['museums', 'running', 'poetry'],
      headline: 'Soft mornings, sharp opinions',
      bio: 'Therapist-in-training. Ask me about attachment styles only after coffee.',
      prompt: ['green_flag', 'They remember the small things'],
    },
  ];

  for (const u of users) {
    const existing = await pool.query(`SELECT id FROM users WHERE phone = $1`, [u.phone]);
    let userId = existing.rows[0]?.id as string | undefined;
    if (!userId) {
      userId = (
        await pool.query(
          `INSERT INTO users (phone) VALUES ($1) RETURNING id`,
          [u.phone],
        )
      ).rows[0].id;
    }
    await pool.query(
      `INSERT INTO profiles (
         user_id, display_name, birth_date, bio, headline, gender, orientation,
         intent, city, latitude, longitude, interests, date_ideas, onboarding_complete, photo_verified
       ) VALUES ($1,$2,'1997-04-12',$3,$4,$5,'straight',$6,$7,$8,$9,$10,$11,TRUE,TRUE)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         bio = EXCLUDED.bio,
         headline = EXCLUDED.headline,
         interests = EXCLUDED.interests,
         onboarding_complete = TRUE`,
      [
        userId,
        u.name,
        u.bio,
        u.headline,
        u.gender,
        u.intent,
        u.city,
        u.lat,
        u.lng,
        u.interests,
        ['coffee', 'walk', 'dinner'],
      ],
    );
    await pool.query(
      `INSERT INTO preferences (user_id, genders, min_age, max_age, max_distance_km)
       VALUES ($1, $2, 21, 40, 50)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, ['woman', 'man', 'non_binary']],
    );
    await pool.query(
      `INSERT INTO entitlements (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId],
    );
    await pool.query(`DELETE FROM prompts WHERE user_id = $1`, [userId]);
    await pool.query(
      `INSERT INTO prompts (user_id, prompt_key, answer, sort_order) VALUES ($1,$2,$3,0)`,
      [userId, u.prompt[0], u.prompt[1]],
    );
  }

  console.log('Seeded demo users (+919900000001 … 003). OTP in mock mode: 000000');
  await pool.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
