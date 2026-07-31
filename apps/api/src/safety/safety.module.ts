import {
  BadRequestException,
  Body,
  Controller,
  Injectable,
  Module,
  Post,
  Put,
} from '@nestjs/common';
import { reportSchema } from '@novae/shared';
import { CurrentUser } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';
import { MatchesService } from '../matches/matches.module';
import { MatchesModule } from '../matches/matches.module';

@Injectable()
export class SafetyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly matches: MatchesService,
  ) {}

  async block(userId: string, blockedId: string) {
    if (userId === blockedId) throw new BadRequestException('Cannot block yourself');
    await this.db.query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, blockedId],
    );
    await this.db.query(
      `UPDATE matches SET status = 'blocked', unmatched_by = $1, updated_at = NOW()
       WHERE status = 'active'
         AND ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))`,
      [userId, blockedId],
    );
    return { ok: true };
  }

  async report(
    userId: string,
    input: {
      reportedUserId: string;
      matchId?: string;
      reason: string;
      details?: string;
    },
  ) {
    const report = (
      await this.db.query(
        `INSERT INTO reports (reporter_id, reported_user_id, match_id, reason, details)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          userId,
          input.reportedUserId,
          input.matchId ?? null,
          input.reason,
          input.details ?? null,
        ],
      )
    ).rows[0];
    await this.block(userId, input.reportedUserId);
    await this.db.query(
      `INSERT INTO moderation_events (user_id, kind, payload)
       VALUES ($1, 'report', $2)`,
      [input.reportedUserId, JSON.stringify(report)],
    );
    return { ok: true, reportId: report.id };
  }

  async setEmergencyContact(userId: string, name: string, phone: string) {
    await this.db.query(
      `INSERT INTO emergency_contacts (user_id, name, phone, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET name = $2, phone = $3, updated_at = NOW()`,
      [userId, name, phone],
    );
    return { ok: true };
  }

  async shareMyDate(
    userId: string,
    body: { matchId: string; when: string; place?: string },
  ) {
    const contact = (
      await this.db.query(`SELECT * FROM emergency_contacts WHERE user_id = $1`, [
        userId,
      ])
    ).rows[0];
    await this.db.query(
      `INSERT INTO moderation_events (user_id, kind, payload)
       VALUES ($1, 'share_my_date', $2)`,
      [
        userId,
        JSON.stringify({
          ...body,
          emergencyContact: contact
            ? { name: contact.name, phone: contact.phone }
            : null,
          createdAt: new Date().toISOString(),
        }),
      ],
    );
    return {
      ok: true,
      message: contact
        ? `Date details logged. In production we notify ${contact.name}.`
        : 'Date details logged. Add an emergency contact for SMS alerts.',
    };
  }

  async registerDevice(userId: string, token: string, platform: string) {
    await this.db.query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO NOTHING`,
      [userId, token, platform],
    );
    return { ok: true };
  }
}

@Controller('safety')
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post('block')
  block(
    @CurrentUser() user: { userId: string },
    @Body() body: { userId: string },
  ) {
    if (!body?.userId) throw new BadRequestException('userId required');
    return this.safety.block(user.userId, body.userId);
  }

  @Post('report')
  async report(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.safety.report(user.userId, parsed.data);
  }

  @Put('emergency-contact')
  emergency(
    @CurrentUser() user: { userId: string },
    @Body() body: { name: string; phone: string },
  ) {
    if (!body?.name || !body?.phone) {
      throw new BadRequestException('name and phone required');
    }
    return this.safety.setEmergencyContact(user.userId, body.name, body.phone);
  }

  @Post('share-my-date')
  share(
    @CurrentUser() user: { userId: string },
    @Body() body: { matchId: string; when: string; place?: string },
  ) {
    if (!body?.matchId || !body?.when) {
      throw new BadRequestException('matchId and when required');
    }
    return this.safety.shareMyDate(user.userId, body);
  }

  @Post('device-token')
  device(
    @CurrentUser() user: { userId: string },
    @Body() body: { token: string; platform: string },
  ) {
    if (!body?.token || !body?.platform) {
      throw new BadRequestException('token and platform required');
    }
    return this.safety.registerDevice(user.userId, body.token, body.platform);
  }
}

@Module({
  imports: [MatchesModule],
  controllers: [SafetyController],
  providers: [SafetyService],
  exports: [SafetyService],
})
export class SafetyModule {}
