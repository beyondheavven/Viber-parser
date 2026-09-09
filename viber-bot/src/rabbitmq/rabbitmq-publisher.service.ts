import {Inject, Injectable, Logger} from "@nestjs/common";
import {ClientProxy} from "@nestjs/microservices";
import {MonitoredMessageDto} from "../messages/dto/monitored-message.dto.js";

@Injectable()
export class RabbitMqPublisher {
    private readonly logger = new Logger(RabbitMqPublisher.name);

    constructor(
        @Inject('RABBITMQ_CLIENT') private readonly client: ClientProxy
    ) {}

    publishMessage(message: MonitoredMessageDto): void {
        try {
            this.client.emit('viber.message.received', message);
        }catch (err){
            this.logger.error(`Не удалось отправить сообщение в RabbitMQ: ${String(err)}`);
        }
    }

    publishTaskProgress(payload: { taskId: string; status: string; progress?: number }): void {
        try {
            this.client.emit('viber.task.progress', payload);
        } catch (err) {
            this.logger.error(`Не удалось отправить статус задачи в RabbitMQ: ${String(err)}`);
        }
    }
}