import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';
import { ProfilesService } from '../profiles/profiles.module';

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ageFromBirthDate(birthDate: string | Date | null): number {
  if (!birthDate) return 0;
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

@Injectable()
export class ExploreService {
  constructor(
    private readonly db: DatabaseService,
    private readonly profiles: ProfilesService,
  ) {}

  async feed(userId: string, limit = 20) {
    const me = (
      await this.db.query(`SELECT * FROM profiles WHERE user_id = $1`, [userId])
    ).rows[0];
    const prefs = (
      await this.db.query(`SELECT * FROM preferences WHERE user_id = $1`, [userId])
    ).rows[0];
    if (!me || !prefs) throw new BadRequestException('Complete your profile first');

    const { rows } = await this.db.query(
      `SELECT p.* FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id <> $1
         AND p.paused = FALSE
         AND u.is_banned = FALSE
         AND p.onboarding_complete = TRUE
         AND p.user_id NOT IN (SELECT target_id FROM swipes WHERE swiper_id = $1)
         AND p.user_id NOT IN (
           SELECT blocked_id FROM blocks WHERE blocker_id = $1
           UNION
           SELECT blocker_id FROM blocks WHERE blocked_id = $1
         )
         AND p.user_id NOT IN (
           SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END
           FROM matches WHERE status = 'active' AND (user_a_id = $1 OR user_b_id = $1)
         )
       ORDER BY p.last_active_at DESC
       LIMIT 100`,
      [userId],
    );

    const genders: string[] = prefs.genders?.length ? prefs.genders : [];
    const filtered = [];
    for (const p of rows) {
      const age = ageFromBirthDate(p.birth_date);
      if (age < prefs.min_age || age > prefs.max_age) continue;
      if (genders.length && p.gender && !genders.includes(p.gender)) continue;
      if (me.latitude != null && p.latitude != null) {
        const dist = haversineKm(me.latitude, me.longitude, p.latitude, p.longitude);
        if (dist > prefs.max_distance_km) continue;
      }
      filtered.push(p);
      if (filtered.length >= limit) break;
    }

    const cards = [];
    for (const p of filtered) {
      cards.push(await this.profiles.getPublicProfile(userId, p.user_id));
    }
    return { cards };
  }

  async likesYou(userId: string, isPlus: boolean) {
    const { rows } = await this.db.query(
      `SELECT s.swiper_id, s.action, s.created_at
       FROM swipes s
       WHERE s.target_id = $1 AND s.action IN ('like', 'super_spark')
         AND s.swiper_id NOT IN (
           SELECT target_id FROM swipes WHERE swiper_id = $1 AND action = 'pass'
         )
         AND s.swiper_id NOT IN (
           SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END
           FROM matches WHERE status = 'active' AND (user_a_id = $1 OR user_b_id = $1)
         )
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [userId],
    );

    const likes = [];
    for (const row of rows) {
      const profile = await this.profiles.getPublicProfile(userId, row.swiper_id);
      if (isPlus) {
        likes.push({ blurred: false, action: row.action, profile });
      } else {
        likes.push({
          blurred: true,
          action: row.action,
          profile: {
            ...profile,
            displayName: 'Someone',
            photos: profile.photos.slice(0, 1).map((ph) => ({
              ...ph,
              url: ph.url,
            })),
            bio: undefined,
            prompts: [],
          },
        });
      }
    }
    return { likes, upgradeRequired: !isPlus };
  }
}

@Controller('explore')
export class ExploreController {
  constructor(
    private readonly explore: ExploreService,
    private readonly db: DatabaseService,
  ) {}

  @Get('feed')
  feed(
    @CurrentUser() user: { userId: string },
    @Query('limit') limit?: string,
  ) {
    return this.explore.feed(user.userId, Math.min(Number(limit) || 20, 50));
  }

  @Get('likes-you')
  async likesYou(@CurrentUser() user: { userId: string }) {
    const ent = (
      await this.db.query(`SELECT is_plus FROM entitlements WHERE user_id = $1`, [
        user.userId,
      ])
    ).rows[0];
    return this.explore.likesYou(user.userId, !!ent?.is_plus);
  }
}

import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [ProfilesModule],
  controllers: [ExploreController],
  providers: [ExploreService],
  exports: [ExploreService],
})
export class ExploreModule {}
