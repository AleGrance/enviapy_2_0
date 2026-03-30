import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

type PrismaLogEvent = 'query' | 'info' | 'warn' | 'error';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, PrismaLogEvent>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const logQueries = process.env.PRISMA_LOG_QUERIES === 'true';
    const logLevels: Prisma.LogLevel[] = logQueries
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'];

    super({
      log: logLevels.map((level) => ({
        emit: 'event',
        level,
      })),
    });

    this.$on('warn', (event) => {
      this.logger.warn(event.message);
    });

    this.$on('error', (event) => {
      this.logger.error(event.message);
    });

    if (logQueries) {
      this.$on('info', (event) => {
        this.logger.log(event.message);
      });

      this.$on('query', (event) => {
        this.logger.debug(
          `Query: ${event.query} | Params: ${event.params} | Duration: ${event.duration}ms`,
        );
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
