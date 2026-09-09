import {Global, Module} from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {RabbitMqPublisher} from "./rabbitmq-publisher.service.js";

@Global()
@Module({
    imports: [
        ClientsModule.register([
            {
                name: 'RABBITMQ_CLIENT',
                transport: Transport.RMQ,
                options: {
                    urls: [process.env.RABBITMQ_URL ?? 'amqp://viber:viber_secret@localhost:5672'],
                    queue: 'viber_events_queue',
                    queueOptions: {
                        durable: true,
                    },
                },
            },
        ]),
    ],
    providers: [RabbitMqPublisher],
    exports: [RabbitMqPublisher],
})
export class RabbitMqModule {}