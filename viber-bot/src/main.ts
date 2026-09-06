import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Viber Bot Automation API')
    .setDescription(
      'REST API для автоматизированного сбора участников групп и сообществ Viber через Frida и Appium с отслеживанием статусов в реальном времени.',
    )
    .setVersion('1.0')
    .addTag('participants', 'Управление сбором участников')
    .addTag('tasks', 'Отслеживание и управление жизненным циклом фоновых задач')
    .addTag('messages', 'Онлайн-мониторинг сообщений в группах')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
  await app.listen(port);

  logger.log(`Server successfully started on http://localhost:${String(port)}`);
  logger.log(`Swagger documentation available at http://localhost:${String(port)}/api/docs`);
}

void bootstrap();
