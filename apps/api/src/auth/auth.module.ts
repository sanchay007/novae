import {
  BadRequestException,
  Body,
  Controller,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import * as bcrypt from 'bcryptjs';
import { requestOtpSchema, verifyOtpSchema } from '@novae/shared';
import { DatabaseService } from '../database/database.module';
import { Public } from '../common/auth.decorators';
import { JwtStrategy } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async requestOtp(phone: string) {
    const code = this.config.get('OTP_PROVIDER') === 'mock'
      ? '000000'
      : String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, 8);
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await this.db.query(
      `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3)`,
      [phone, codeHash, expires],
    );
    // Mock / MSG91 / Twilio would send here
    return {
      ok: true,
      message: 'OTP sent',
      ...(this.config.get('OTP_PROVIDER') === 'mock' ? { debugCode: code } : {}),
    };
  }

  async verifyOtp(phone: string, code: string) {
    const { rows } = await this.db.query<{ id: string; code_hash: string }>(
      `SELECT id, code_hash FROM otp_codes
       WHERE phone = $1 AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    const otp = rows[0];
    if (!otp || !(await bcrypt.compare(code, otp.code_hash))) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    await this.db.query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1`, [
      otp.id,
    ]);

    let user = (
      await this.db.query<{ id: string; role: string }>(
        `SELECT id, role FROM users WHERE phone = $1`,
        [phone],
      )
    ).rows[0];

    if (!user) {
      user = (
        await this.db.query<{ id: string; role: string }>(
          `INSERT INTO users (phone) VALUES ($1) RETURNING id, role`,
          [phone],
        )
      ).rows[0]!;
      await this.db.query(
        `INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [user.id],
      );
      await this.db.query(
        `INSERT INTO preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [user.id],
      );
      await this.db.query(
        `INSERT INTO entitlements (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [user.id],
      );
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
    });
    return { accessToken, userId: user.id };
  }

  async socialLogin(provider: 'apple' | 'google', subject: string, email?: string) {
    const column = provider === 'apple' ? 'apple_sub' : 'google_sub';
    let user = (
      await this.db.query<{ id: string; role: string }>(
        `SELECT id, role FROM users WHERE ${column} = $1`,
        [subject],
      )
    ).rows[0];

    if (!user && email) {
      user = (
        await this.db.query<{ id: string; role: string }>(
          `SELECT id, role FROM users WHERE email = $1`,
          [email],
        )
      ).rows[0];
      if (user) {
        await this.db.query(`UPDATE users SET ${column} = $1 WHERE id = $2`, [
          subject,
          user.id,
        ]);
      }
    }

    if (!user) {
      user = (
        await this.db.query<{ id: string; role: string }>(
          `INSERT INTO users (${column}, email) VALUES ($1, $2) RETURNING id, role`,
          [subject, email ?? null],
        )
      ).rows[0]!;
      await this.db.query(`INSERT INTO profiles (user_id) VALUES ($1)`, [user.id]);
      await this.db.query(`INSERT INTO preferences (user_id) VALUES ($1)`, [user.id]);
      await this.db.query(`INSERT INTO entitlements (user_id) VALUES ($1)`, [user.id]);
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
    });
    return { accessToken, userId: user.id };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  async requestOtp(@Body() body: unknown) {
    const parsed = requestOtpSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.auth.requestOtp(parsed.data.phone);
  }

  @Public()
  @Post('otp/verify')
  async verifyOtp(@Body() body: unknown) {
    const parsed = verifyOtpSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.auth.verifyOtp(parsed.data.phone, parsed.data.code);
  }

  @Public()
  @Post('social')
  async social(
    @Body()
    body: { provider: 'apple' | 'google'; subject: string; email?: string },
  ) {
    if (!body?.provider || !body?.subject) {
      throw new BadRequestException('provider and subject required');
    }
    return this.auth.socialLogin(body.provider, body.subject, body.email);
  }
}

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get(
          'JWT_SECRET',
          'change-me-in-production-use-long-random-string',
        ),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', '30d'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
