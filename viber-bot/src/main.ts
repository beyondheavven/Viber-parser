import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './rabbitmq/rpc-exception.filter.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const rmqUrl = process.env['RABBITMQ_URL'] ?? 'amqp://viber:viber_secret@localhost:5672';
  const queueEnv = process.env['RABBITMQ_QUEUE'] ?? 'viber_commands_queue';
  const queueNames = queueEnv.split(',').map((q) => q.trim()).filter(Boolean);
  const queues = queueNames.length > 0 ? queueNames : ['viber_commands_queue'];

  await Promise.all(
    queues.map(async (queue) => {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
        transport: Transport.RMQ,
        options: {
          urls: [rmqUrl],
          queue,
          queueOptions: {
            durable: true,
          },
          prefetchCount: 1,
        },
      });

      app.useGlobalFilters(new AllExceptionsFilter());
      await app.listen();
      logger.log(`Viber Bot Microservice listening queue: ${queue}`);
    }),
  );

  logger.log(`Viber Bot Microservice fully initialized for: ${queues.join(', ')}`);
}

void bootstrap();

