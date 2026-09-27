import type Docker from 'dockerode';

const DEFAULT_QUEUE = 'viber_commands_queue';
const VALID_LEGACY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const VALID_HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export function commandQueueName(deviceId?: string, baseQueue = DEFAULT_QUEUE): string {
  if (deviceId === undefined) return baseQueue;
  if (!isValidRoutingId(deviceId)) {
    throw new Error('deviceId must be a safe instance id or hostname:port (maximum 64 characters)');
  }
  return `${baseQueue}.device.${deviceId}`;
}

export interface CompanionRuntimeConfig {
  network: string;
  appiumImage: string;
  botImage: string;
  rabbitMqUrl: string;
  defaultPhone?: string;
  defaultCountry?: string;
  defaultName?: string;
}

interface CompanionConfig extends CompanionRuntimeConfig {
  deviceId: string;
  routingId: string;
  adbPort: number;
}

export interface CompanionSpec {
  name: string;
  createOptions: Docker.ContainerCreateOptions;
}

export interface CompanionSpecs {
  appium: CompanionSpec;
  bot: CompanionSpec;
}

export function buildCompanionSpecs(config: CompanionConfig): CompanionSpecs {
  const queue = commandQueueName(config.routingId);
  const suffix = config.deviceId.slice(0, 12).toLowerCase();
  const appiumName = `viber-appium-${suffix}`;
  const botName = `viber-bot-${suffix}`;
  const adbTarget = `host.docker.internal:${config.adbPort}`;
  const labels = {
    app: 'viber-emulator-companion',
    'viber.emulator.id': config.deviceId,
  };
  const hostConfig: Docker.HostConfig = {
    NetworkMode: config.network,
    ExtraHosts: ['host.docker.internal:host-gateway'],
    RestartPolicy: { Name: 'unless-stopped' },
  };

  const botEnv = [
    `RABBITMQ_URL=${config.rabbitMqUrl}`,
    `RABBITMQ_QUEUE=${queue}`,
    `APPIUM_HOST=${appiumName}`,
    'APPIUM_PORT=4723',
    `ANDROID_SERIAL=${adbTarget}`,
    `VIBER_INSTANCE_ID=${config.deviceId}`,
    'ADB_BIN=adb',
    'VIBER_PACKAGE=com.viber.voip',
    'VIBER_MESSAGES_DB=/data/data/com.viber.voip/databases/viber_messages',
  ];
  if (config.defaultPhone) botEnv.push(`VIBER_DEFAULT_PHONE=${config.defaultPhone}`);
  if (config.defaultCountry) botEnv.push(`VIBER_DEFAULT_COUNTRY=${config.defaultCountry}`);
  if (config.defaultName) botEnv.push(`VIBER_DEFAULT_NAME=${config.defaultName}`);

  return {
    appium: {
      name: appiumName,
      createOptions: {
        Image: config.appiumImage,
        Labels: { ...labels, 'viber.companion.role': 'appium' },
        Env: [
          'RELAXED_SECURITY=true',
          'REMOTE_ADB=true',
          `ANDROID_DEVICES=${adbTarget}`,
        ],
        HostConfig: hostConfig,
      },
    },
    bot: {
      name: botName,
      createOptions: {
        Image: config.botImage,
        Labels: { ...labels, 'viber.companion.role': 'bot' },
        Env: botEnv,
        HostConfig: hostConfig,
      },
    },
  };
}

const MANAGED_ENV_KEYS = new Set([
  'RELAXED_SECURITY',
  'REMOTE_ADB',
  'ANDROID_DEVICES',
  'RABBITMQ_URL',
  'RABBITMQ_QUEUE',
  'APPIUM_HOST',
  'APPIUM_PORT',
  'ANDROID_SERIAL',
  'VIBER_INSTANCE_ID',
  'ADB_BIN',
  'VIBER_PACKAGE',
  'VIBER_MESSAGES_DB',
  'VIBER_DEFAULT_PHONE',
  'VIBER_DEFAULT_COUNTRY',
  'VIBER_DEFAULT_NAME',
]);

export class CompanionController {
  private readonly operations = new Map<string, Promise<void>>();

  constructor(
    private readonly docker: Docker,
    private readonly config: CompanionRuntimeConfig,
  ) {}

  async runExclusive<T>(deviceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(deviceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.operations.set(deviceId, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.operations.get(deviceId) === current) {
        this.operations.delete(deviceId);
      }
    }
  }

  async reconcileRunning(deviceId: string, adbPort: number, routingId: string): Promise<void> {
    await this.runExclusive(deviceId, () => this.reconcileRunningLocked(deviceId, adbPort, routingId));
  }

  async provisionNew(
    deviceId: string,
    adbPort: number,
    routingId: string,
    rollbackEmulator: () => Promise<void>,
  ): Promise<void> {
    await this.runExclusive(deviceId, async () => {
      try {
        await this.reconcileRunningLocked(deviceId, adbPort, routingId);
      } catch (cause) {
        try {
          await this.removeCompanionsLocked(deviceId);
        } finally {
          await rollbackEmulator();
        }
        throw cause;
      }
    });
  }

  async reconcileRunningLocked(deviceId: string, adbPort: number, routingId: string): Promise<void> {
    if (!await this.isEmulatorRunning(deviceId)) {
      await this.stopCompanionsLocked(deviceId);
      return;
    }

    const specs = buildCompanionSpecs({ deviceId, routingId, adbPort, ...this.config });
    for (const spec of [specs.appium, specs.bot]) {
      if (!await this.ensureCurrentAndRunning(spec, deviceId)) {
        await this.stopCompanionsLocked(deviceId);
        return;
      }
    }
  }

  async stopCompanionsLocked(deviceId: string): Promise<void> {
    const companions = await this.listCompanions(deviceId);
    await Promise.all(companions.map(async (info) => {
      const container = this.docker.getContainer(info.Id);
      const inspect = await container.inspect().catch(() => null);
      if (inspect?.State.Running) await container.stop();
    }));
  }

  async removeCompanionsLocked(deviceId: string): Promise<void> {
    const companions = await this.listCompanions(deviceId);
    await Promise.all(companions.map((info) => this.docker.getContainer(info.Id).remove({ force: true })));
  }

  private async ensureCurrentAndRunning(spec: CompanionSpec, deviceId: string): Promise<boolean> {
    const imageName = spec.createOptions.Image;
    if (!imageName) throw new Error(`Companion image is not configured: ${spec.name}`);
    const desiredImage = await this.docker.getImage(imageName).inspect();
    let container = this.docker.getContainer(spec.name);
    let inspect = await container.inspect().catch(() => null);

    if (inspect && !this.matchesDesiredSpec(inspect, spec, desiredImage.Id)) {
      await container.remove({ force: true });
      inspect = null;
    }

    if (!inspect) {
      if (!await this.isEmulatorRunning(deviceId)) return false;
      try {
        container = await this.docker.createContainer({ name: spec.name, ...spec.createOptions });
      } catch (error: any) {
        if (error?.statusCode !== 409) throw error;
        container = this.docker.getContainer(spec.name);
      }
      inspect = await container.inspect();
    }

    if (!inspect.State.Running) {
      if (!await this.isEmulatorRunning(deviceId)) return false;
      await container.start();
    }
    return true;
  }

  private matchesDesiredSpec(
    inspect: Docker.ContainerInspectInfo,
    spec: CompanionSpec,
    desiredImageId: string,
  ): boolean {
    if (inspect.Image !== desiredImageId) return false;
    if (inspect.HostConfig.NetworkMode !== spec.createOptions.HostConfig?.NetworkMode) return false;

    const actualEnv = envMap(inspect.Config.Env ?? []);
    const desiredEnv = envMap(spec.createOptions.Env ?? []);
    for (const key of MANAGED_ENV_KEYS) {
      if (actualEnv.get(key) !== desiredEnv.get(key)) return false;
    }

    const desiredLabels = spec.createOptions.Labels ?? {};
    return Object.entries(desiredLabels).every(([key, value]) => inspect.Config.Labels?.[key] === value);
  }

  private async isEmulatorRunning(deviceId: string): Promise<boolean> {
    const inspect = await this.docker.getContainer(deviceId).inspect().catch(() => null);
    return inspect?.State.Running === true;
  }

  private async listCompanions(deviceId: string): Promise<Docker.ContainerInfo[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: [
          'app=viber-emulator-companion',
          `viber.emulator.id=${deviceId}`,
        ],
      },
    });
    return containers.filter((info) =>
      info.Labels?.app === 'viber-emulator-companion'
      && info.Labels?.['viber.emulator.id'] === deviceId,
    );
  }
}

function envMap(entries: string[]): Map<string, string> {
  return new Map(entries.map((entry) => {
    const separator = entry.indexOf('=');
    return separator === -1 ? [entry, ''] : [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

function isValidRoutingId(deviceId: string): boolean {
  if (VALID_LEGACY_ID.test(deviceId)) return true;
  if (deviceId.length > 64) return false;

  const separator = deviceId.lastIndexOf(':');
  if (separator <= 0 || separator === deviceId.length - 1) return false;
  const host = deviceId.slice(0, separator);
  const portText = deviceId.slice(separator + 1);
  if (!/^[0-9]{1,5}$/.test(portText)) return false;
  const port = Number(portText);
  return Number.isInteger(port)
    && port >= 1
    && port <= 65535
    && host.split('.').every((label) => VALID_HOST_LABEL.test(label));
}
