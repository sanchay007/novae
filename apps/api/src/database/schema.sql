-- Novae schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  apple_sub TEXT UNIQUE,
  google_sub TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  birth_date DATE,
  bio TEXT,
  headline TEXT,
  gender TEXT,
  orientation TEXT,
  intent TEXT,
  height_cm INT,
  city TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  interests TEXT[] NOT NULL DEFAULT '{}',
  date_ideas TEXT[] NOT NULL DEFAULT '{}',
  custom_date_idea TEXT,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  photo_verified BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  genders TEXT[] NOT NULL DEFAULT '{}',
  min_age INT NOT NULL DEFAULT 18,
  max_age INT NOT NULL DEFAULT 45,
  max_distance_km INT NOT NULL DEFAULT 50,
  intents TEXT[] NOT NULL DEFAULT '{}',
  dealbreakers TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_verified_selfie BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_key TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, prompt_key)
);

CREATE TABLE IF NOT EXISTS friend_sparks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_token TEXT NOT NULL UNIQUE,
  prompt_key TEXT,
  answer TEXT,
  media_url TEXT,
  media_type TEXT DEFAULT 'text',
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS swipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swiper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_photo_id UUID,
  target_prompt_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (swiper_id, target_id)
);

CREATE TABLE IF NOT EXISTS sparks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  why_matched TEXT[] NOT NULL DEFAULT '{}',
  score DOUBLE PRECISION,
  accepted_by_a BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_by_b BOOLEAN NOT NULL DEFAULT FALSE,
  is_paid_extra BOOLEAN NOT NULL DEFAULT FALSE,
  spark_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spark_id UUID REFERENCES sparks(id),
  status TEXT NOT NULL DEFAULT 'active',
  why_matched TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'spark',
  unmatched_by UUID,
  unmatch_reason TEXT,
  anonymous_feedback TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT,
  image_url TEXT,
  voice_url TEXT,
  client_message_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id),
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_plus BOOLEAN NOT NULL DEFAULT FALSE,
  extra_sparks INT NOT NULL DEFAULT 0,
  unlimited_ai BOOLEAN NOT NULL DEFAULT FALSE,
  boost_until TIMESTAMPTZ,
  passport_city TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  suggestions_count INT NOT NULL DEFAULT 0,
  UNIQUE (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE TABLE IF NOT EXISTS embeddings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  embedding vector(64),
  model TEXT NOT NULL DEFAULT 'pseudo-v1',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON profiles (last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sparks_users_date ON sparks (user_a_id, spark_date);
CREATE INDEX IF NOT EXISTS idx_sparks_b_date ON sparks (user_b_id, spark_date);
CREATE INDEX IF NOT EXISTS idx_matches_users ON matches (user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches (status);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages (match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_swipes_target ON swipes (target_id, action);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);
