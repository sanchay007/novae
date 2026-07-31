import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import Redis from 'ioredis';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;
  readonly redis: Redis;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.get<string>(
        'DATABASE_URL',
        'postgresql://novae:novae@localhost:5432/novae',
      ),
    });
    this.redis = new Redis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      { maxRetriesPerRequest: 3, lazyConnect: true },
    );
    this.redis.connect().catch(() => {
      // Redis optional in local mock mode
    });
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async onModuleDestroy() {
    await this.pool.end();
    try {
      await this.redis.quit();
    } catch {
      // ignore
    }
  }
}

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
