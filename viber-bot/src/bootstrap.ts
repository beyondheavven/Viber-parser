import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { MultiQueueRmqServer } from './rabbitmq/multi-queue-rmq-server.js';
import { AllExceptionsFilter } from './rabbitmq/rpc-exception.filter.js';

export function queuesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const queueEnv = env['RABBITMQ_QUEUE'] ?? 'viber_commands_queue';
  const queueNames = queueEnv.split(',').map((q) => q.trim()).filter(Boolean);
  return queueNames.length > 0 ? queueNames : ['viber_commands_queue'];
}

export async function bootstrap(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const logger = new Logger('Bootstrap');
  const rmqUrl = env['RABBITMQ_URL'] ?? 'amqp://viber:viber_secret@localhost:5672';
  const queues = queuesFromEnv(env);

  // One application for all queues: a microservice per queue would give each
  // queue its own DI container and duplicate every stateful singleton.
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    strategy: new MultiQueueRmqServer(queues, {
      urls: [rmqUrl],
      queueOptions: {
        durable: true,
      },
      prefetchCount: 1,
    }),
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen();
  for (const queue of queues) logger.log(`Viber Bot Microservice listening queue: ${queue}`);

  logger.log(`Viber Bot Microservice fully initialized for: ${queues.join(', ')}`);
}
