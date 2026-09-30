import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createMicroservice: vi.fn() }));

vi.mock('@nestjs/core', () => ({ NestFactory: { createMicroservice: mocks.createMicroservice } }));
vi.mock('../../src/app.module.js', () => ({ AppModule: class AppModule {} }));

import { bootstrap } from '../../src/bootstrap.js';

describe('bootstrap', () => {
  beforeEach(() => {
    mocks.createMicroservice.mockReset();
    mocks.createMicroservice.mockResolvedValue({
      useGlobalFilters: vi.fn(),
      listen: vi.fn(() => Promise.resolve()),
    });
  });

  it('serves every queue from a single application so services are shared', async () => {
    await bootstrap({
      RABBITMQ_URL: 'amqp://localhost:5672',
      RABBITMQ_QUEUE: 'q.device.worker, q.device.1.2.3.4:5556, q.device.localhost:5556',
    });

    expect(mocks.createMicroservice).toHaveBeenCalledTimes(1);
    const options = mocks.createMicroservice.mock.calls[0]?.[1] as { strategy?: { queues?: string[] } };
    expect(options.strategy?.queues).toEqual([
      'q.device.worker',
      'q.device.1.2.3.4:5556',
      'q.device.localhost:5556',
    ]);
  });
});
