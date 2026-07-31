# Novae

**New spark everyday.** A dating app that fights swipe burnout with one free AI-curated daily match, a hard cap of 3 active matches, and AI conversation assist.

## Monorepo

| Package | Description |
|---------|-------------|
| `apps/mobile` | React Native + Expo (iOS & Android) |
| `apps/api` | NestJS API + Socket.IO gateway |
| `apps/worker` | Daily Spark matching, embeddings, expiry, matching-v2 signals |
| `apps/admin` | Next.js trust & safety dashboard |
| `packages/shared` | Types, Zod schemas, match-cap rules (unit tested) |

## Quick start

```bash
# Infrastructure (Postgres + pgvector + Redis)
docker compose up -d

# Install
npm install

# Env
cp .env.example .env
cp .env.example apps/api/.env

# Shared package
npm run build -w @novae/shared

# Schema + demo users (OTP mock code: 000000)
npm run db:migrate
npm run db:seed

# API
npm run dev:api

# Worker (separate terminal)
npm run dev:worker

# Mobile (separate terminal)
npm run dev:mobile

# Admin (http://localhost:3002) — header x-admin-key: dev-admin-key
npm run dev:admin
```

Demo phones after seed: `+919900000001`, `+919900000002`, `+919900000003` — OTP `000000`.

## Product rules

- 1 free Daily Spark per user per day
- Max 3 simultaneous active matches
- AI suggestions are drafts only — never auto-send
- Chats are not used for model training by default (`AI_TRAIN_ON_CHATS=false`)

## API surface (v1)

- `POST /v1/auth/otp/request|verify` · `POST /v1/auth/social`
- `GET|PATCH /v1/profiles/me` · photos · prompts · verify-photo · export · delete
- `GET /v1/sparks/today` · `POST /v1/sparks/decide` · `POST /v1/sparks/extra`
- `GET /v1/matches` · swipe · unmatch
- `GET /v1/explore/feed` · `GET /v1/explore/likes-you`
- `GET|POST /v1/chat/...` · WebSocket `/ws`
- `POST /v1/ai/suggest`
- `GET /v1/billing/entitlements|products` · RevenueCat webhook · dev grant
- `POST /v1/safety/block|report|share-my-date` · emergency contact
- `POST /v1/friend-sparks/invite` · `POST /v1/calls/token`
- `GET /v1/admin/stats|reports` (admin key)

## License

Proprietary — all rights reserved.
