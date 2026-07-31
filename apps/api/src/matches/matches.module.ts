import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { swipeSchema, unmatchSchema } from '@novae/shared';
import { CurrentUser } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';
import {
  NotificationService,
  NotificationsModule,
} from '../notifications/notifications.module';
import { ProfilesService } from '../profiles/profiles.module';
import { SparksService } from '../sparks/sparks.module';

@Injectable()
export class MatchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly profiles: ProfilesService,
    private readonly sparks: SparksService,
    private readonly notifications: NotificationService,
  ) {}

  async list(userId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM matches
       WHERE status = 'active' AND (user_a_id = $1 OR user_b_id = $1)
       ORDER BY COALESCE(last_message_at, created_at) DESC`,
      [userId],
    );
    const views = [];
    for (const m of rows) {
      const otherId = m.user_a_id === userId ? m.user_b_id : m.user_a_id;
      const other = await this.profiles.getPublicProfile(userId, otherId);
      views.push({
        matchId: m.id,
        status: m.status,
        whyMatched: m.why_matched,
        createdAt: m.created_at,
        lastMessageAt: m.last_message_at,
        other,
      });
    }
    return {
      matches: views,
      slotsRemaining: Math.max(
        0,
        3 - (await this.sparks.activeMatchCount(userId)),
      ),
    };
  }

  async unmatch(userId: string, matchId: string, reason?: string, feedback?: string) {
    const match = (
      await this.db.query(`SELECT * FROM matches WHERE id = $1`, [matchId])
    ).rows[0];
    if (!match) throw new BadRequestException('Match not found');
    if (match.user_a_id !== userId && match.user_b_id !== userId) {
      throw new ForbiddenException();
    }
    await this.db.query(
      `UPDATE matches SET status = 'unmatched', unmatched_by = $1,
       unmatch_reason = $2, anonymous_feedback = $3, updated_at = NOW()
       WHERE id = $4`,
      [userId, reason ?? null, feedback ?? null, matchId],
    );
    await this.sparks.releaseHeldSparks(match.user_a_id);
    await this.sparks.releaseHeldSparks(match.user_b_id);
    return { ok: true, slotsFreed: true };
  }

  async swipe(userId: string, input: {
    targetUserId: string;
    action: string;
    targetPhotoId?: string;
    targetPromptId?: string;
  }) {
    if (input.targetUserId === userId) {
      throw new BadRequestException('Cannot swipe on yourself');
    }
    await this.db.query(
      `INSERT INTO swipes (swiper_id, target_id, action, target_photo_id, target_prompt_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (swiper_id, target_id) DO UPDATE SET action = EXCLUDED.action`,
      [
        userId,
        input.targetUserId,
        input.action,
        input.targetPhotoId ?? null,
        input.targetPromptId ?? null,
      ],
    );

    if (input.action === 'pass') {
      return { matched: false };
    }

    const reciprocal = (
      await this.db.query(
        `SELECT action FROM swipes WHERE swiper_id = $1 AND target_id = $2`,
        [input.targetUserId, userId],
      )
    ).rows[0];

    if (!reciprocal || reciprocal.action === 'pass') {
      return { matched: false };
    }

    const existing = (
      await this.db.query(
        `SELECT id FROM matches
         WHERE status = 'active'
           AND ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))`,
        [userId, input.targetUserId],
      )
    ).rows[0];
    if (existing) return { matched: true, matchId: existing.id };

    const countA = await this.sparks.activeMatchCount(userId);
    const countB = await this.sparks.activeMatchCount(input.targetUserId);
    if (countA >= 3 || countB >= 3) {
      return {
        matched: false,
        heldForSlot: true,
        message: 'Mutual like — free a slot to match',
      };
    }

    const match = (
      await this.db.query(
        `INSERT INTO matches (user_a_id, user_b_id, why_matched, source)
         VALUES ($1, $2, $3, 'explore') RETURNING id`,
        [
          userId,
          input.targetUserId,
          ['You liked each other on Explore'],
        ],
      )
    ).rows[0]!;
    void this.notifications.notifyMatch(
      [userId, input.targetUserId],
      match.id,
    );
    return { matched: true, matchId: match.id };
  }

  async expireInactive() {
    const { rowCount } = await this.db.query(
      `UPDATE matches SET status = 'expired', updated_at = NOW()
       WHERE status = 'active'
         AND COALESCE(last_message_at, created_at) < NOW() - INTERVAL '7 days'
       RETURNING id`,
    );
    return { expired: rowCount ?? 0 };
  }
}

@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  list(@CurrentUser() user: { userId: string }) {
    return this.matches.list(user.userId);
  }

  @Post('unmatch')
  async unmatch(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = unmatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.matches.unmatch(
      user.userId,
      parsed.data.matchId,
      parsed.data.reason,
      parsed.data.anonymousFeedback,
    );
  }

  @Post('swipe')
  async swipe(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = swipeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.matches.swipe(user.userId, parsed.data);
  }

  @Get(':matchId')
  async one(
    @CurrentUser() user: { userId: string },
    @Param('matchId') matchId: string,
  ) {
    const list = await this.matches.list(user.userId);
    const found = list.matches.find((m) => m.matchId === matchId);
    if (!found) throw new BadRequestException('Match not found');
    return found;
  }
}

import { ProfilesModule } from '../profiles/profiles.module';
import { SparksModule } from '../sparks/sparks.module';

@Module({
  imports: [ProfilesModule, SparksModule, NotificationsModule],
  controllers: [MatchesController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
