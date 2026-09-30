import {
  Server,
  ServerRMQ,
  type CustomTransportStrategy,
  type MessageHandler,
  type RmqOptions,
} from '@nestjs/microservices';

export type RmqServerOptions = NonNullable<RmqOptions['options']>;

/** The slice of ServerRMQ this strategy drives; lets tests swap in a fake. */
export interface QueueServer {
  addHandler(
    pattern: unknown,
    handler: MessageHandler,
    isEventHandler?: boolean,
    extras?: Record<string, unknown>,
  ): void;
  listen(callback: (err?: unknown, ...optionalParams: unknown[]) => void): unknown;
  close(): unknown;
  on(event: string, callback: Function): unknown;
  unwrap<T>(): T;
}

/**
 * Consumes several RabbitMQ queues from one Nest application.
 *
 * Creating one microservice per queue gives every queue its own DI container,
 * so singletons such as the message monitor and the device mutex were
 * duplicated per queue and overwrote each other's state. This strategy keeps a
 * single container and starts one ServerRMQ per queue, all dispatching to the
 * same handlers.
 */
export class MultiQueueRmqServer extends Server implements CustomTransportStrategy {
  private readonly servers: QueueServer[];

  constructor(
    readonly queues: readonly string[],
    options: RmqServerOptions,
    createServer: (options: RmqServerOptions) => QueueServer = (queueOptions) =>
      new ServerRMQ(queueOptions) as unknown as QueueServer,
  ) {
    super();
    this.servers = queues.map((queue) => createServer({ ...options, queue }));
  }

  async listen(callback: (err?: unknown, ...optionalParams: unknown[]) => void): Promise<void> {
    for (const server of this.servers) {
      for (const [pattern, handler] of this.getHandlers()) {
        server.addHandler(pattern, handler, handler.isEventHandler, handler.extras);
      }
    }
    try {
      await Promise.all(this.servers.map((server) => listenOn(server)));
    } catch (err) {
      callback(err);
      return;
    }
    callback();
  }

  async close(): Promise<void> {
    await Promise.all(this.servers.map((server) => server.close()));
  }

  on<EventKey extends string = string, EventCallback extends Function = Function>(
    event: EventKey,
    callback: EventCallback,
  ): void {
    for (const server of this.servers) server.on(event, callback);
  }

  unwrap<T>(): T {
    return this.servers.map((server) => server.unwrap<unknown>()) as T;
  }
}

function listenOn(server: QueueServer): Promise<void> {
  return new Promise((resolve, reject) => {
    const listening = server.listen((err?: unknown) => {
      if (err === undefined || err === null) resolve();
      else reject(err);
    });
    Promise.resolve(listening).catch(reject);
  });
}
