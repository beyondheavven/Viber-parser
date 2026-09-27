import {Inject, Injectable, Logger} from "@nestjs/common";
import {ClientProxy} from "@nestjs/microservices";
import {MonitoredMessageDto} from "../features/messages/dto/monitored-message.dto.js";
import {TaskEvent} from "../features/tasks/entities/task.entity.js";

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

    publishTaskEvent(event: TaskEvent): void {
        try {
            this.client.emit('viber.task.event', event);
        } catch (err) {
            this.logger.error(`Не удалось отправить событие задачи ${event.taskId} в RabbitMQ: ${String(err)}`);
        }
    }
}