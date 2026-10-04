import { Controller, Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MessagePattern, type MessageHandler } from '@nestjs/microservices';
import { isObservable, lastValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MultiQueueRmqServer, type QueueServer } from '../../src/rabbitmq/multi-queue-rmq-server.js';

class FakeQueueServer implements QueueServer {
  readonly handlers = new Map<string, MessageHandler>();
  readonly listen = vi.fn((callback: (err?: unknown) => void) => {
    callback();
    return Promise.resolve();
  });
  readonly close = vi.fn(() => Promise.resolve());
  readonly on = vi.fn();

  constructor(readonly queue: string) {}

  addHandler(pattern: unknown, handler: MessageHandler): void {
    this.handlers.set(String(pattern), handler);
  }

  unwrap<T>(): T {
    return this.queue as T;
  }
}

function strategyWithFakes(queues: string[]): { strategy: MultiQueueRmqServer; servers: FakeQueueServer[] } {
  const servers: FakeQueueServer[] = [];
  const strategy = new MultiQueueRmqServer(queues, { urls: ['amqp://localhost'] }, (options) => {
    const server = new FakeQueueServer(String(options.queue));
    servers.push(server);
    return server;
  });
  return { strategy, servers };
}

async function invoke(server: FakeQueueServer, pattern: string, data: unknown): Promise<unknown> {
  const handler = server.handlers.get(pattern);
  if (handler === undefined) throw new Error(`no handler for ${pattern} on ${server.queue}`);
  const result: unknown = await handler(data, {});
  return isObservable(result) ? lastValueFrom(result) : result;
}

@Injectable()
class MonitoredGroups {
  readonly enabled = new Set<number>();
}

@Controller()
class MonitorController {
  constructor(@Inject(MonitoredGroups) private readonly groups: MonitoredGroups) {}

  @MessagePattern('enable')
  enable(id: number): number[] {
    this.groups.enabled.add(id);
    return [...this.groups.enabled];
  }

  @MessagePattern('groups')
  list(): number[] {
    return [...this.groups.enabled];
  }
}

@Module({ controllers: [MonitorController], providers: [MonitoredGroups] })
class MonitorTestModule {}

describe('MultiQueueRmqServer', () => {
  it('starts one consumer per queue with the same handlers and closes them all', async () => {
    const { strategy, servers } = strategyWithFakes(['q.a', 'q.b']);
    const handler = vi.fn() as unknown as MessageHandler;
    strategy.addHandler('viber.ping', handler);

    const listened = vi.fn();
    await strategy.listen(listened);

    expect(strategy.queues).toEqual(['q.a', 'q.b']);
    expect(servers.map((server) => server.queue)).toEqual(['q.a', 'q.b']);
    for (const server of servers) {
      expect(server.handlers.get('viber.ping')).toBe(handler);
      expect(server.listen).toHaveBeenCalledTimes(1);
    }
    expect(listened).toHaveBeenCalledWith();

    await strategy.close();
    for (const server of servers) expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('reports a queue that failed to start', async () => {
    const { strategy, servers } = strategyWithFakes(['q.a', 'q.b']);
    const failure = new Error('channel closed');
    servers[1]?.listen.mockImplementation((callback: (err?: unknown) => void) => {
      callback(failure);
      return Promise.resolve();
    });
    const listened = vi.fn();
    await strategy.listen(listened);

    expect(listened).toHaveBeenCalledWith(failure);
  });

  it('shares one DI container: state changed via one queue is visible via another', async () => {
    const { strategy, servers } = strategyWithFakes(['q.device.worker', 'q.device.localhost:5556']);
    const app = await NestFactory.createMicroservice(MonitorTestModule, { strategy, logger: false });
    await app.listen();
    try {
      const [viaWorker, viaLocalhost] = servers;
      if (viaWorker === undefined || viaLocalhost === undefined) throw new Error('expected two queue servers');

      await invoke(viaWorker, 'enable', 3);
      await invoke(viaWorker, 'enable', 1);

      expect(await invoke(viaLocalhost, 'groups', {})).toEqual([3, 1]);
    } finally {
      await app.close();
    }
    for (const server of servers) expect(server.close).toHaveBeenCalledTimes(1);
  });
});
