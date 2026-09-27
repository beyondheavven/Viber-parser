import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompanionSpecs,
  CompanionController,
  commandQueueName,
} from '../src/companion-stack.js';

const deviceId = 'a'.repeat(64);
const runtimeConfig = {
  network: 'viber-parser_default',
  appiumImage: 'appium/appium:latest',
  botImage: 'viber-parser-bot',
  rabbitMqUrl: 'amqp://user:pass@rabbitmq:5672?heartbeat=60',
  defaultPhone: '+48123123123',
  defaultCountry: 'Poland',
  defaultName: 'Maks',
};

test('command queue naming matches the API contract and rejects unsafe ids', () => {
  assert.equal(commandQueueName(undefined), 'viber_commands_queue');
  assert.equal(commandQueueName(deviceId), `viber_commands_queue.device.${deviceId}`);
  assert.equal(commandQueueName('worker_1'), 'viber_commands_queue.device.worker_1');

  for (const invalid of ['', '../worker', 'worker.name', 'worker name', 'a'.repeat(65)]) {
    assert.throws(() => commandQueueName(invalid), /deviceId/);
  }
});

test('companion specs isolate appium and bot for the selected emulator', () => {
  const specs = buildCompanionSpecs({
    deviceId,
    adbPort: 5556,
    ...runtimeConfig,
  });

  assert.equal(specs.appium.name, 'viber-appium-aaaaaaaaaaaa');
  assert.equal(specs.bot.name, 'viber-bot-aaaaaaaaaaaa');
  assert.equal(specs.appium.createOptions.HostConfig?.NetworkMode, 'viber-parser_default');
  assert.deepEqual(specs.appium.createOptions.Env, [
    'RELAXED_SECURITY=true',
    'REMOTE_ADB=true',
    'ANDROID_DEVICES=host.docker.internal:5556',
  ]);
  assert.equal(specs.bot.createOptions.HostConfig?.NetworkMode, 'viber-parser_default');
  assert.ok(specs.bot.createOptions.Env?.includes(`RABBITMQ_QUEUE=viber_commands_queue.device.${deviceId}`));
  assert.ok(specs.bot.createOptions.Env?.includes('APPIUM_HOST=viber-appium-aaaaaaaaaaaa'));
  assert.ok(specs.bot.createOptions.Env?.includes('ANDROID_SERIAL=host.docker.internal:5556'));
});

test('reconciliation replaces companions when image, environment or network drifted', async () => {
  const docker = new FakeDocker();
  docker.images.set('appium/appium:latest', 'sha256:appium-new');
  docker.images.set('viber-parser-bot', 'sha256:bot-new');
  docker.addEmulator(deviceId, true);
  docker.addCompanion('viber-appium-aaaaaaaaaaaa', deviceId, 'appium', {
    imageId: 'sha256:appium-old',
    imageName: 'appium/appium:latest',
    env: ['ANDROID_DEVICES=host.docker.internal:9999'],
    network: 'old_default',
  });
  docker.addCompanion('viber-bot-aaaaaaaaaaaa', deviceId, 'bot', {
    imageId: 'sha256:bot-old',
    imageName: 'viber-parser-bot',
    env: ['RABBITMQ_QUEUE=stale'],
    network: 'old_default',
  });

  const controller = new CompanionController(docker as never, runtimeConfig);
  await controller.reconcileRunning(deviceId, 5556);

  assert.deepEqual(docker.removed.sort(), ['viber-appium-aaaaaaaaaaaa', 'viber-bot-aaaaaaaaaaaa']);
  assert.deepEqual(docker.created, ['viber-appium-aaaaaaaaaaaa', 'viber-bot-aaaaaaaaaaaa']);
  assert.equal(docker.container('viber-appium-aaaaaaaaaaaa').imageId, 'sha256:appium-new');
  assert.equal(docker.container('viber-bot-aaaaaaaaaaaa').imageId, 'sha256:bot-new');
  assert.equal(docker.container('viber-bot-aaaaaaaaaaaa').network, 'viber-parser_default');
});

test('device operations are serialized and stopped emulators cannot recreate companions', async () => {
  const docker = new FakeDocker();
  docker.images.set('appium/appium:latest', 'sha256:appium');
  docker.images.set('viber-parser-bot', 'sha256:bot');
  docker.addEmulator(deviceId, true);
  const controller = new CompanionController(docker as never, runtimeConfig);
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = controller.runExclusive(deviceId, async () => {
    events.push('first-start');
    await firstGate;
    docker.container(deviceId).running = false;
    events.push('first-end');
  });
  const second = controller.runExclusive(deviceId, async () => {
    events.push('second');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);

  await controller.reconcileRunning(deviceId, 5556);
  assert.deepEqual(docker.created, []);
});

test('new emulator provisioning rolls back partial companions and the emulator on failure', async () => {
  const docker = new FakeDocker();
  docker.images.set('appium/appium:latest', 'sha256:appium');
  docker.images.set('viber-parser-bot', 'sha256:bot');
  docker.addEmulator(deviceId, true);
  docker.failCreate.add('viber-bot-aaaaaaaaaaaa');
  const controller = new CompanionController(docker as never, runtimeConfig);
  let rolledBack = false;

  await assert.rejects(
    controller.provisionNew(deviceId, 5556, async () => {
      rolledBack = true;
      await docker.container(deviceId).remove({ force: true });
    }),
    /create failed/,
  );

  assert.equal(rolledBack, true);
  assert.equal(docker.has(deviceId), false);
  assert.equal(docker.has('viber-appium-aaaaaaaaaaaa'), false);
  assert.equal(docker.has('viber-bot-aaaaaaaaaaaa'), false);
});

interface FakeContainerConfig {
  imageId: string;
  imageName: string;
  env: string[];
  network: string;
}

class FakeContainer {
  running = false;

  constructor(
    private readonly docker: FakeDocker,
    readonly id: string,
    readonly name: string,
    readonly labels: Record<string, string>,
    readonly imageId: string,
    readonly imageName: string,
    readonly env: string[],
    readonly network: string,
  ) {}

  async inspect() {
    return {
      Id: this.id,
      Name: `/${this.name}`,
      Image: this.imageId,
      State: { Running: this.running },
      Config: { Image: this.imageName, Env: this.env, Labels: this.labels },
      HostConfig: { NetworkMode: this.network, PortBindings: { '5555/tcp': [{ HostPort: '5556' }] } },
    };
  }

  async start() { this.running = true; }
  async stop() { this.running = false; }
  async restart() { this.running = true; }
  async remove(_options?: unknown) {
    this.docker.removed.push(this.name);
    this.docker.delete(this);
  }
}

class MissingContainer {
  constructor(private readonly docker: FakeDocker, private readonly ref: string) {}
  async inspect(): Promise<never> { throw Object.assign(new Error('not found'), { statusCode: 404 }); }
  async remove(): Promise<void> { this.docker.deleteRef(this.ref); }
}

class FakeDocker {
  readonly images = new Map<string, string>();
  readonly created: string[] = [];
  readonly removed: string[] = [];
  readonly failCreate = new Set<string>();
  private readonly containers = new Map<string, FakeContainer>();

  addEmulator(id: string, running: boolean): void {
    const container = new FakeContainer(this, id, `viber-emu-${id.slice(0, 8)}`, { app: 'viber-emulator' }, 'sha256:emu', 'emulator', [], 'viber-parser_default');
    container.running = running;
    this.store(container);
  }

  addCompanion(name: string, emulatorId: string, role: string, config: FakeContainerConfig): void {
    const container = new FakeContainer(this, `${name}-id`, name, {
      app: 'viber-emulator-companion',
      'viber.emulator.id': emulatorId,
      'viber.companion.role': role,
    }, config.imageId, config.imageName, config.env, config.network);
    container.running = true;
    this.store(container);
  }

  getContainer(ref: string): FakeContainer | MissingContainer {
    return this.containers.get(ref) ?? new MissingContainer(this, ref);
  }

  getImage(name: string) {
    return { inspect: async () => ({ Id: this.images.get(name) }) };
  }

  async createContainer(options: any): Promise<FakeContainer> {
    if (this.failCreate.has(options.name)) throw new Error(`create failed: ${options.name}`);
    const container = new FakeContainer(
      this,
      `${options.name}-id`,
      options.name,
      options.Labels ?? {},
      this.images.get(options.Image) ?? options.Image,
      options.Image,
      options.Env ?? [],
      options.HostConfig?.NetworkMode ?? '',
    );
    this.created.push(options.name);
    this.store(container);
    return container;
  }

  async listContainers(): Promise<any[]> {
    return [...new Set(this.containers.values())].map((container) => ({
      Id: container.id,
      Names: [`/${container.name}`],
      Labels: container.labels,
    }));
  }

  container(ref: string): FakeContainer {
    const container = this.containers.get(ref);
    if (!container) throw new Error(`missing fake container: ${ref}`);
    return container;
  }

  has(ref: string): boolean { return this.containers.has(ref); }
  delete(container: FakeContainer): void {
    this.containers.delete(container.id);
    this.containers.delete(container.name);
  }
  deleteRef(ref: string): void { this.containers.delete(ref); }

  private store(container: FakeContainer): void {
    this.containers.set(container.id, container);
    this.containers.set(container.name, container);
  }
}
