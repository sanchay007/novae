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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { sendMessageSchema } from '@novae/shared';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Server, Socket } from 'socket.io';
import { CurrentUser } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import {
  NotificationService,
  NotificationsModule,
} from '../notifications/notifications.module';

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationService,
  ) {}

  async assertMember(matchId: string, userId: string) {
    const match = (
      await this.db.query(`SELECT * FROM matches WHERE id = $1 AND status = 'active'`, [
        matchId,
      ])
    ).rows[0];
    if (!match) throw new BadRequestException('Match not found');
    if (match.user_a_id !== userId && match.user_b_id !== userId) {
      throw new ForbiddenException();
    }
    return match;
  }

  async listMessages(matchId: string, userId: string, before?: string, limit = 50) {
    await this.assertMember(matchId, userId);
    const params: unknown[] = [matchId];
    let sql = `SELECT * FROM messages WHERE match_id = $1`;
    if (before) {
      params.push(before);
      sql += ` AND created_at < $${params.length}`;
    }
    params.push(Math.min(limit, 100));
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    const { rows } = await this.db.query(sql, params);
    return { messages: rows.reverse() };
  }

  async send(
    userId: string,
    input: {
      matchId: string;
      body?: string;
      imageUrl?: string;
      voiceUrl?: string;
      clientMessageId?: string;
    },
  ) {
    const match = await this.assertMember(input.matchId, userId);
    if (input.clientMessageId) {
      const existing = (
        await this.db.query(
          `SELECT * FROM messages WHERE match_id = $1 AND client_message_id = $2`,
          [input.matchId, input.clientMessageId],
        )
      ).rows[0];
      if (existing) return existing;
    }
    const message = (
      await this.db.query(
        `INSERT INTO messages (match_id, sender_id, body, image_url, voice_url, client_message_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          input.matchId,
          userId,
          input.body ?? null,
          input.imageUrl ?? null,
          input.voiceUrl ?? null,
          input.clientMessageId ?? null,
        ],
      )
    ).rows[0]!;
    await this.db.query(
      `UPDATE matches SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [input.matchId],
    );
    const recipientId =
      match.user_a_id === userId ? match.user_b_id : match.user_a_id;
    void this.notifications.notifyMessage(
      recipientId,
      input.matchId,
      input.body ?? undefined,
    );
    return message;
  }

  async markRead(matchId: string, userId: string) {
    await this.assertMember(matchId, userId);
    await this.db.query(
      `UPDATE messages SET read_at = NOW()
       WHERE match_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [matchId, userId],
    );
    return { ok: true };
  }
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(':matchId/messages')
  messages(
    @CurrentUser() user: { userId: string },
    @Param('matchId') matchId: string,
    @Query('before') before?: string,
  ) {
    return this.chat.listMessages(matchId, user.userId, before);
  }

  @Post('messages')
  async send(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.chat.send(user.userId, parsed.data);
  }

  @Post(':matchId/read')
  read(
    @CurrentUser() user: { userId: string },
    @Param('matchId') matchId: string,
  ) {
    return this.chat.markRead(matchId, user.userId);
  }

  @Post('voice')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads'),
        filename: (_req, file, cb) => {
          cb(null, `voice-${Date.now()}${extname(file.originalname) || '.m4a'}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async voice(
    @CurrentUser() user: { userId: string },
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { matchId: string },
  ) {
    if (!file || !body?.matchId) {
      throw new BadRequestException('file and matchId required');
    }
    return this.chat.send(user.userId, {
      matchId: body.matchId,
      voiceUrl: `/media/${file.filename}`,
    });
  }
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/ws' })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: ChatService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string)
        || (client.handshake.headers.authorization?.replace('Bearer ', '') ?? '');
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('join_match')
  async joinMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { matchId: string },
  ) {
    await this.chat.assertMember(body.matchId, client.data.userId);
    client.join(`match:${body.matchId}`);
    return { ok: true };
  }

  @SubscribeMessage('typing')
  typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { matchId: string },
  ) {
    client.to(`match:${body.matchId}`).emit('typing', {
      matchId: body.matchId,
      userId: client.data.userId,
    });
  }

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) return { error: parsed.error.flatten() };
    const message = await this.chat.send(client.data.userId, parsed.data);
    this.server.to(`match:${parsed.data.matchId}`).emit('message', message);
    return { message };
  }
}

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
