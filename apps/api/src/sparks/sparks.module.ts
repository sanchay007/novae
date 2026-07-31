import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import {
  MAX_ACTIVE_MATCHES,
  SPARK_ACCEPT_WINDOW_HOURS,
  applySparkDecision,
  buildWhyMatched,
  resolveSparkAfterMutualAccept,
  remainingSlots,
  sparkDecisionSchema,
} from '@novae/shared';
import { CurrentUser } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';
import {
  NotificationService,
  NotificationsModule,
} from '../notifications/notifications.module';
import { ProfilesModule, ProfilesService } from '../profiles/profiles.module';

@Injectable()
export class SparksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationService,
  ) {}

  async activeMatchCount(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM matches
       WHERE status = 'active' AND (user_a_id = $1 OR user_b_id = $1)`,
      [userId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  async getTodaySpark(userId: string) {
    await this.profiles.touchActive(userId);
    // Prefer free Daily Spark over paid extras so extras never shadow the ritual.
    const { rows } = await this.db.query(
      `SELECT * FROM sparks
       WHERE spark_date = CURRENT_DATE
         AND (user_a_id = $1 OR user_b_id = $1)
         AND status NOT IN ('declined', 'expired')
       ORDER BY
         CASE WHEN is_paid_extra THEN 1 ELSE 0 END ASC,
         CASE
           WHEN status IN ('pending', 'accepted_a', 'accepted_b', 'held_for_slot') THEN 0
           ELSE 1
         END ASC,
         created_at DESC
       LIMIT 5`,
      [userId],
    );
    const spark = rows[0];
    const extras = rows.filter((r) => r.is_paid_extra);
    const slots = remainingSlots(await this.activeMatchCount(userId));
    if (!spark) {
      return {
        spark: null,
        slotsRemaining: slots,
        message: 'Your Daily Spark is on the way',
        extrasPending: 0,
      };
    }
    const otherId = spark.user_a_id === userId ? spark.user_b_id : spark.user_a_id;
    const profile = await this.profiles.getPublicProfile(userId, otherId);
    return {
      sparkId: spark.id,
      status: spark.status,
      expiresAt: spark.expires_at,
      whyMatched: spark.why_matched,
      isPaidExtra: !!spark.is_paid_extra,
      kind: spark.is_paid_extra ? 'extra' : 'daily',
      acceptedByMe:
        spark.user_a_id === userId ? spark.accepted_by_a : spark.accepted_by_b,
      profile,
      slotsRemaining: slots,
      extrasPending: extras.filter((e) =>
        ['pending', 'accepted_a', 'accepted_b', 'held_for_slot'].includes(e.status),
      ).length,
    };
  }

  async decide(userId: string, sparkId: string, accept: boolean) {
    const spark = (
      await this.db.query(`SELECT * FROM sparks WHERE id = $1`, [sparkId])
    ).rows[0];
    if (!spark) throw new BadRequestException('Spark not found');
    if (spark.user_a_id !== userId && spark.user_b_id !== userId) {
      throw new ForbiddenException();
    }
    if (new Date(spark.expires_at) < new Date()) {
      await this.db.query(`UPDATE sparks SET status = 'expired' WHERE id = $1`, [
        sparkId,
      ]);
      throw new BadRequestException('Spark expired');
    }

    const next = applySparkDecision(
      {
        userAId: spark.user_a_id,
        userBId: spark.user_b_id,
        createdAt: new Date(spark.created_at),
        status: spark.status,
        acceptedByA: spark.accepted_by_a,
        acceptedByB: spark.accepted_by_b,
      },
      userId,
      accept,
    );

    await this.db.query(
      `UPDATE sparks SET status = $1, accepted_by_a = $2, accepted_by_b = $3 WHERE id = $4`,
      [next.status, !!next.acceptedByA, !!next.acceptedByB, sparkId],
    );

    if (next.status !== 'matched') {
      return { status: next.status, matchId: null };
    }

    const countA = await this.activeMatchCount(spark.user_a_id);
    const countB = await this.activeMatchCount(spark.user_b_id);
    const resolved = resolveSparkAfterMutualAccept(
      next,
      { id: spark.user_a_id, activeMatchCount: countA },
      { id: spark.user_b_id, activeMatchCount: countB },
      MAX_ACTIVE_MATCHES,
    );

    if (!resolved.createMatch) {
      await this.db.query(`UPDATE sparks SET status = 'held_for_slot' WHERE id = $1`, [
        sparkId,
      ]);
      return {
        status: 'held_for_slot',
        matchId: null,
        message: 'Both accepted — free a match slot to unlock this Spark',
      };
    }

    const match = (
      await this.db.query(
        `INSERT INTO matches (user_a_id, user_b_id, spark_id, why_matched, source)
         VALUES ($1, $2, $3, $4, 'spark')
         RETURNING *`,
        [spark.user_a_id, spark.user_b_id, sparkId, spark.why_matched],
      )
    ).rows[0]!;
    await this.db.query(`UPDATE sparks SET status = 'matched' WHERE id = $1`, [sparkId]);
    void this.notifications.notifyMatch(
      [spark.user_a_id, spark.user_b_id],
      match.id,
    );
    return { status: 'matched', matchId: match.id, whyMatched: spark.why_matched };
  }

  async consumeExtraSpark(userId: string) {
    const ent = (
      await this.db.query(`SELECT * FROM entitlements WHERE user_id = $1`, [userId])
    ).rows[0];
    if (!ent || ent.extra_sparks < 1) {
      throw new BadRequestException('No extra Sparks available');
    }
    await this.db.query(
      `UPDATE entitlements SET extra_sparks = extra_sparks - 1, updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
    return { extraSparks: ent.extra_sparks - 1 };
  }

  /** Consume one Extra Spark entitlement and queue a worker fulfill job. */
  async requestExtraSpark(userId: string) {
    const { extraSparks } = await this.consumeExtraSpark(userId);
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO spark_requests (user_id, status)
       VALUES ($1, 'pending') RETURNING id`,
      [userId],
    );
    return {
      ok: true,
      requestId: rows[0]!.id,
      extraSparks,
      message: 'Extra Spark queued — worker will assign shortly',
    };
  }

  async createSparkPair(
    userAId: string,
    userBId: string,
    score: number,
    shared: Parameters<typeof buildWhyMatched>[0],
    isPaidExtra = false,
  ) {
    const why = buildWhyMatched(shared);
    const expires = new Date(
      Date.now() + SPARK_ACCEPT_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const { rows } = await this.db.query(
      `INSERT INTO sparks
       (user_a_id, user_b_id, why_matched, score, is_paid_extra, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userAId, userBId, why, score, isPaidExtra, expires],
    );
    return rows[0];
  }

  async releaseHeldSparks(userId: string) {
    if ((await this.activeMatchCount(userId)) >= MAX_ACTIVE_MATCHES) return [];
    const { rows } = await this.db.query(
      `SELECT * FROM sparks
       WHERE status = 'held_for_slot'
         AND (user_a_id = $1 OR user_b_id = $1)
       ORDER BY created_at ASC LIMIT 5`,
      [userId],
    );
    const created: string[] = [];
    for (const spark of rows) {
      const countA = await this.activeMatchCount(spark.user_a_id);
      const countB = await this.activeMatchCount(spark.user_b_id);
      if (countA >= MAX_ACTIVE_MATCHES || countB >= MAX_ACTIVE_MATCHES) continue;
      const match = (
        await this.db.query(
          `INSERT INTO matches (user_a_id, user_b_id, spark_id, why_matched, source)
           VALUES ($1, $2, $3, $4, 'spark') RETURNING id`,
          [spark.user_a_id, spark.user_b_id, spark.id, spark.why_matched],
        )
      ).rows[0];
      await this.db.query(`UPDATE sparks SET status = 'matched' WHERE id = $1`, [
        spark.id,
      ]);
      if (match) {
        created.push(match.id);
        void this.notifications.notifyMatch(
          [spark.user_a_id, spark.user_b_id],
          match.id,
        );
      }
    }
    return created;
  }
}

@Controller('sparks')
export class SparksController {
  constructor(private readonly sparks: SparksService) {}

  @Get('today')
  today(@CurrentUser() user: { userId: string }) {
    return this.sparks.getTodaySpark(user.userId);
  }

  @Post('decide')
  async decide(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = sparkDecisionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.sparks.decide(
      user.userId,
      parsed.data.sparkId,
      parsed.data.accept,
    );
  }

  @Post('extra')
  async extra(@CurrentUser() user: { userId: string }) {
    return this.sparks.requestExtraSpark(user.userId);
  }
}

@Module({
  imports: [ProfilesModule, NotificationsModule],
  controllers: [SparksController],
  providers: [SparksService],
  exports: [SparksService],
})
export class SparksModule {}
