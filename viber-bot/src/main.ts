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
  const queueName = process.env['RABBITMQ_QUEUE'] ?? 'viber_commands_queue';

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [rmqUrl],
      queue: queueName,
      queueOptions: {
        durable: true,
      },
      prefetchCount: 1,
    },
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen();
  logger.log(`Viber Bot Microservice started. Listening queue: ${queueName}`);
}

void bootstrap();

