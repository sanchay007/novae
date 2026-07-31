import { Injectable, Module } from '@nestjs/common';
import { DatabaseModule, DatabaseService } from '../database/database.module';

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

@Injectable()
export class NotificationService {
  constructor(private readonly db: DatabaseService) {}

  async notifyUser(userId: string, payload: PushPayload) {
    const { rows: tokens } = await this.db.query<{
      token: string;
      platform: string;
    }>(`SELECT token, platform FROM device_tokens WHERE user_id = $1`, [userId]);

    console.log(
      `[push] user=${userId} tokens=${tokens.length} title=${payload.title}`,
      payload,
    );

    await this.db.query(
      `INSERT INTO moderation_events (user_id, kind, payload)
       VALUES ($1, 'push_log', $2)`,
      [
        userId,
        JSON.stringify({
          ...payload,
          tokenCount: tokens.length,
          at: new Date().toISOString(),
        }),
      ],
    );

    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    if (!accessToken || tokens.length === 0) {
      return { logged: true, sent: 0 };
    }

    const messages = tokens
      .filter(
        (t) =>
          t.token.startsWith('ExponentPushToken')
          || t.token.startsWith('ExpoPushToken'),
      )
      .map((t) => ({
        to: t.token,
        sound: 'default' as const,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
      }));

    if (!messages.length) return { logged: true, sent: 0 };

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        console.warn('[push] Expo push failed', res.status, await res.text());
        return { logged: true, sent: 0 };
      }
      return { logged: true, sent: messages.length };
    } catch (err) {
      console.warn('[push] Expo push error', err);
      return { logged: true, sent: 0 };
    }
  }

  async notifyUsers(userIds: string[], payload: PushPayload) {
    const unique = [...new Set(userIds)];
    await Promise.all(unique.map((id) => this.notifyUser(id, payload)));
  }

  notifyNewSpark(userIds: string[], sparkId: string) {
    return this.notifyUsers(userIds, {
      title: 'Your Daily Spark is ready',
      body: 'Someone new is waiting — open Novae to decide.',
      data: { type: 'spark', sparkId },
    });
  }

  notifyMatch(userIds: string[], matchId: string) {
    return this.notifyUsers(userIds, {
      title: "It's a match",
      body: 'You both said yes. Say hello.',
      data: { type: 'match', matchId },
    });
  }

  notifyMessage(recipientId: string, matchId: string, preview?: string) {
    return this.notifyUser(recipientId, {
      title: 'New message',
      body: preview?.slice(0, 120) || 'You have a new message',
      data: { type: 'message', matchId },
    });
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
