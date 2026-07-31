import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { friendSparkSchema } from '@novae/shared';
import { randomBytes } from 'crypto';
import { AdminGuard, CurrentUser, Public } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';

@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService) {}

  async listReports(status = 'open') {
    const { rows } = await this.db.query(
      `SELECT r.*, rp.display_name AS reporter_name, tp.display_name AS reported_name
       FROM reports r
       LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
       LEFT JOIN profiles tp ON tp.user_id = r.reported_user_id
       WHERE r.status = $1
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [status],
    );
    return { reports: rows };
  }

  async resolveReport(reportId: string, action: 'dismiss' | 'ban', reason?: string) {
    const report = (
      await this.db.query(`SELECT * FROM reports WHERE id = $1`, [reportId])
    ).rows[0];
    if (!report) throw new BadRequestException('Report not found');
    await this.db.query(`UPDATE reports SET status = $1 WHERE id = $2`, [
      action === 'ban' ? 'actioned' : 'dismissed',
      reportId,
    ]);
    if (action === 'ban') {
      await this.db.query(
        `UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2`,
        [reason ?? report.reason, report.reported_user_id],
      );
    }
    return { ok: true };
  }

  async stats() {
    const q = async (sql: string) =>
      Number((await this.db.query<{ c: string }>(sql)).rows[0]?.c ?? 0);
    return {
      users: await q(`SELECT COUNT(*)::text AS c FROM users`),
      activeMatches: await q(
        `SELECT COUNT(*)::text AS c FROM matches WHERE status = 'active'`,
      ),
      openReports: await q(
        `SELECT COUNT(*)::text AS c FROM reports WHERE status = 'open'`,
      ),
      sparksToday: await q(
        `SELECT COUNT(*)::text AS c FROM sparks WHERE spark_date = CURRENT_DATE`,
      ),
    };
  }
}

@Injectable()
export class FriendSparkService {
  constructor(private readonly db: DatabaseService) {}

  async createInvite(userId: string) {
    const token = randomBytes(16).toString('hex');
    const expires = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await this.db.query(
      `INSERT INTO friend_sparks (user_id, invite_token, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, token, expires],
    );
    return {
      inviteToken: token,
      expiresAt: expires.toISOString(),
      shareUrl: `novae://friend-spark/${token}`,
    };
  }

  async submit(token: string, body: unknown) {
    const parsed = friendSparkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const row = (
      await this.db.query(
        `SELECT * FROM friend_sparks WHERE invite_token = $1 AND expires_at > NOW()`,
        [token],
      )
    ).rows[0];
    if (!row) throw new BadRequestException('Invite expired or invalid');
    await this.db.query(
      `UPDATE friend_sparks SET prompt_key = $1, answer = $2, media_url = $3,
       media_type = $4 WHERE id = $5`,
      [
        parsed.data.promptKey,
        parsed.data.answer,
        parsed.data.mediaUrl ?? null,
        parsed.data.mediaType,
        row.id,
      ],
    );
    return { ok: true };
  }

  async listMine(userId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM friend_sparks WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return { friendSparks: rows };
  }

  async approve(userId: string, id: string, approved: boolean) {
    await this.db.query(
      `UPDATE friend_sparks SET approved = $1 WHERE id = $2 AND user_id = $3`,
      [approved, id, userId],
    );
    return { ok: true };
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Public()
  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Public()
  @Get('reports')
  reports() {
    return this.admin.listReports();
  }

  @Public()
  @Patch('reports/:id')
  resolve(
    @Param('id') id: string,
    @Body() body: { action: 'dismiss' | 'ban'; reason?: string },
  ) {
    return this.admin.resolveReport(id, body.action, body.reason);
  }
}

@Controller('friend-sparks')
export class FriendSparksController {
  constructor(private readonly friend: FriendSparkService) {}

  @Post('invite')
  invite(@CurrentUser() user: { userId: string }) {
    return this.friend.createInvite(user.userId);
  }

  @Get('me')
  mine(@CurrentUser() user: { userId: string }) {
    return this.friend.listMine(user.userId);
  }

  @Patch(':id/approve')
  approve(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: { approved: boolean },
  ) {
    return this.friend.approve(user.userId, id, !!body.approved);
  }

  @Public()
  @Post('submit/:token')
  submit(@Param('token') token: string, @Body() body: unknown) {
    return this.friend.submit(token, body);
  }
}

@Controller('calls')
export class CallsController {
  @Post('token')
  token(
    @CurrentUser() user: { userId: string },
    @Body() body: { matchId: string },
  ) {
    return {
      provider: 'livekit',
      room: `match-${body.matchId}`,
      token: `dev-token-${user.userId}-${body.matchId}`,
      url: process.env.LIVEKIT_URL ?? 'wss://novae-livekit.example',
    };
  }
}

@Module({
  controllers: [AdminController, FriendSparksController, CallsController],
  providers: [AdminService, FriendSparkService],
  exports: [AdminService, FriendSparkService],
})
export class AdminModule {}
