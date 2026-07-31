import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser, Public } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';

@Injectable()
export class BillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async getEntitlements(userId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM entitlements WHERE user_id = $1`,
      [userId],
    );
    return (
      rows[0] ?? {
        user_id: userId,
        is_plus: false,
        extra_sparks: 0,
        unlimited_ai: false,
      }
    );
  }

  async applyRevenueCatEvent(event: Record<string, unknown>) {
    const appUserId = String(
      event.app_user_id ?? event.original_app_user_id ?? '',
    );
    if (!appUserId) throw new BadRequestException('missing app_user_id');

    const type = String(event.type ?? event.event_type ?? '');
    const productId = String(event.product_id ?? '');

    if (
      type.includes('INITIAL_PURCHASE')
      || type.includes('RENEWAL')
      || type.includes('UNCANCELLATION')
      || type === 'TEST'
    ) {
      const isPlus =
        productId.includes('plus') || productId.includes('Plus') || type === 'TEST';
      const unlimitedAi = isPlus;
      await this.db.query(
        `INSERT INTO entitlements (user_id, is_plus, unlimited_ai, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           is_plus = EXCLUDED.is_plus,
           unlimited_ai = EXCLUDED.unlimited_ai,
           updated_at = NOW()`,
        [appUserId, isPlus, unlimitedAi],
      );
    }

    if (productId.includes('spark') || productId.includes('Spark')) {
      const qty = Number(event.quantity ?? 1);
      await this.db.query(
        `INSERT INTO entitlements (user_id, extra_sparks, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           extra_sparks = entitlements.extra_sparks + $2,
           updated_at = NOW()`,
        [appUserId, qty],
      );
    }

    if (type.includes('EXPIRATION') || type.includes('CANCELLATION')) {
      await this.db.query(
        `UPDATE entitlements SET is_plus = FALSE, unlimited_ai = FALSE, updated_at = NOW()
         WHERE user_id = $1`,
        [appUserId],
      );
    }

    if (productId.includes('boost')) {
      await this.db.query(
        `UPDATE entitlements SET boost_until = NOW() + INTERVAL '30 minutes', updated_at = NOW()
         WHERE user_id = $1`,
        [appUserId],
      );
    }

    return { ok: true };
  }

  /** Dev-only grant for simulator testing without RevenueCat. */
  async devGrant(
    userId: string,
    body: { plus?: boolean; extraSparks?: number; boost?: boolean },
  ) {
    if (this.config.get('NODE_ENV') === 'production') {
      throw new UnauthorizedException();
    }
    await this.db.query(
      `INSERT INTO entitlements (user_id, is_plus, unlimited_ai, extra_sparks, boost_until, updated_at)
       VALUES ($1, $2, $2, $3, CASE WHEN $4 THEN NOW() + INTERVAL '30 minutes' ELSE NULL END, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         is_plus = COALESCE($2, entitlements.is_plus),
         unlimited_ai = COALESCE($2, entitlements.unlimited_ai),
         extra_sparks = entitlements.extra_sparks + COALESCE($3, 0),
         boost_until = CASE WHEN $4 THEN NOW() + INTERVAL '30 minutes' ELSE entitlements.boost_until END,
         updated_at = NOW()`,
      [userId, body.plus ?? null, body.extraSparks ?? 0, !!body.boost],
    );
    return this.getEntitlements(userId);
  }
}

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  @Get('entitlements')
  entitlements(@CurrentUser() user: { userId: string }) {
    return this.billing.getEntitlements(user.userId);
  }

  @Public()
  @Post('revenuecat/webhook')
  async webhook(
    @Headers('authorization') auth: string | undefined,
    @Body() body: { event?: Record<string, unknown> } & Record<string, unknown>,
  ) {
    const secret = this.config.get('REVENUECAT_WEBHOOK_SECRET');
    if (secret && auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Invalid webhook auth');
    }
    const event = body.event ?? body;
    return this.billing.applyRevenueCatEvent(event);
  }

  @Post('dev/grant')
  devGrant(
    @CurrentUser() user: { userId: string },
    @Body() body: { plus?: boolean; extraSparks?: number; boost?: boolean },
  ) {
    return this.billing.devGrant(user.userId, body);
  }

  @Get('products')
  products() {
    return {
      products: [
        {
          id: 'novae_plus_monthly',
          title: 'Novae Plus',
          benefits: [
            'See who liked you',
            'Unlimited AI assist',
            '1 extra Spark / day',
            'Passport radius',
          ],
        },
        {
          id: 'novae_spark_pack_3',
          title: 'Spark Pack (3)',
          benefits: ['3 extra Daily Sparks'],
        },
        {
          id: 'novae_boost_30m',
          title: 'Boost',
          benefits: ['30 minutes of Discover priority'],
        },
      ],
    };
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
