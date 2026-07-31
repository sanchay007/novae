import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, Public } from './common/auth.decorators';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { SparksModule } from './sparks/sparks.module';
import { MatchesModule } from './matches/matches.module';
import { ExploreModule } from './explore/explore.module';
import { ChatModule } from './chat/chat.module';
import { AiModule } from './ai/ai.module';
import { BillingModule } from './billing/billing.module';
import { SafetyModule } from './safety/safety.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';

@Controller()
class HealthController {
  @Public()
  @Get('health')
  health() {
    return { ok: true, service: 'novae-api', version: '0.1.0' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    DatabaseModule,
    AuthModule,
    ProfilesModule,
    SparksModule,
    MatchesModule,
    ExploreModule,
    ChatModule,
    AiModule,
    BillingModule,
    SafetyModule,
    AdminModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
