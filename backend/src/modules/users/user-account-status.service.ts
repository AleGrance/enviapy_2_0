import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

const ACCOUNT_EXPIRATION_SYNC_INTERVAL_MS = 60_000;

@Injectable()
export class UserAccountStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserAccountStatusService.name);
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.syncExpiredUsers();
    this.intervalHandle = setInterval(() => {
      void this.syncExpiredUsers();
    }, ACCOUNT_EXPIRATION_SYNC_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async syncExpiredUsers() {
    try {
      const result = await this.prisma.user.updateMany({
        where: {
          status: 'ACTIVE',
          accountExpiresAt: {
            lte: new Date(),
          },
        },
        data: {
          status: 'INACTIVE',
        },
      });

      if (result.count > 0) {
        this.logger.log(`Marked ${result.count} expired user account(s) as INACTIVE`);
      }
    } catch (error: any) {
      this.logger.warn(`Could not sync expired user accounts: ${error?.message || 'Unknown error'}`);
    }
  }
}
