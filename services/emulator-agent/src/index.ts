import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import Docker from 'dockerode';
import fs from 'node:fs';
import { VersionedAccountCache } from './account-cache.js';
import { runContainerCommand } from './container-command.js';
import { CompanionController } from './companion-stack.js';
import { logoutViber } from './viber-logout.js';
import { buildScrcpyUrl } from './scrcpy-url.js';
import {
  HEALTH_CHECK_CMD,
  parseContainerHealthOutput,
  type ContainerHealthResult,
  type ViberAccountInfo,
} from './health-check.js';

const app = express();
const port = Number(process.env.PORT || 9000);
const secretToken = process.env.AGENT_SECRET || process.env.VPS_AGENT_SECRET || '';
const emulatorImage = process.env.EMULATOR_IMAGE || 'shmayro/dockerify-android:1.0.0';
const hostProjectDir = (process.env.HOST_PROJECT_DIR || '/home/kkurzau/Viber-parser').replace(/\/+$/, '');
const adbPortStart = Number(process.env.ADB_PORT_START || 5556);
const adbPortEnd = Number(process.env.ADB_PORT_END || 5599);
const vncPortStart = Number(process.env.VNC_PORT_START || 6081);
const vncPortEnd = Number(process.env.VNC_PORT_END || 6120);
const scrcpyPort = Number(process.env.SCRCPY_PORT || 8000);
const hostPublicIp = process.env.HOST_PUBLIC_IP || 'localhost';
const companionNetwork = process.env.COMPANION_NETWORK || '';
const companionAppiumImage = process.env.COMPANION_APPIUM_IMAGE || '';
const companionBotImage = process.env.COMPANION_BOT_IMAGE || '';
const companionRabbitMqUrl = process.env.COMPANION_RABBITMQ_URL || '';
const companionDefaultPhone = process.env.VIBER_DEFAULT_PHONE;
const companionDefaultCountry = process.env.VIBER_DEFAULT_COUNTRY;
const companionDefaultName = process.env.VIBER_DEFAULT_NAME;

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
const companions = new CompanionController(docker, {
  network: companionNetwork,
  appiumImage: companionAppiumImage,
  botImage: companionBotImage,
  rabbitMqUrl: companionRabbitMqUrl,
  defaultPhone: companionDefaultPhone,
  defaultCountry: companionDefaultCountry,
  defaultName: companionDefaultName,
});

app.use(cors());
app.use(express.json());

// Auth middleware
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!secretToken) {
    next();
    return;
  }
  const provided = req.headers['x-agent-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (provided && provided === secretToken) {
    next();
    return;
  }
  // Allow health endpoint without token
  if (req.path === '/health' || req.path === '/api/health') {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized: invalid agent secret token' });
}

app.use(authMiddleware);

// Helper: Check KVM availability
function checkKvm(): boolean {
  try {
    return fs.existsSync('/dev/kvm');
  } catch {
    return false;
  }
}

// Helper: Ensure scrcpy-web ADB container connects to device port
async function ensureScrcpyConnected(adbPort: number): Promise<void> {
  try {
    const containers = await docker.listContainers({
      filters: { name: ['scrcpy-web', 'viber-scrcpy-web'] },
    });
    const scrcpyInfo = containers.find((c) =>
      c.Names.some((n) => n.includes('scrcpy-web')),
    );
    if (!scrcpyInfo) return;

    const scrcpyContainer = docker.getContainer(scrcpyInfo.Id);
    if (adbPort === 5555) {
      // android-emulator is connected directly; disconnect duplicate host.docker.internal:5555
      const exec = await scrcpyContainer.exec({
        Cmd: ['adb', 'disconnect', 'host.docker.internal:5555'],
        AttachStdout: true,
        AttachStderr: true,
      });
      await exec.start({});
      return;
    }

    const exec = await scrcpyContainer.exec({
      Cmd: ['adb', 'connect', `host.docker.internal:${adbPort}`],
      AttachStdout: true,
      AttachStderr: true,
    });
    await exec.start({});
  } catch {
    // Ignore if scrcpy-web is not running
  }
}

// Helper: Find free ports for ADB and VNC
async function findFreePorts(): Promise<{ adbPort: number; vncPort: number }> {
  const containers = await docker.listContainers({ all: true });
  const occupiedPorts = new Set<number>();

  for (const c of containers) {
    for (const p of c.Ports || []) {
      if (p.PublicPort) {
        occupiedPorts.add(p.PublicPort);
      }
    }
  }

  let adbPort: number | null = null;
  for (let p = adbPortStart; p <= adbPortEnd; p++) {
    if (!occupiedPorts.has(p)) {
      adbPort = p;
      occupiedPorts.add(p);
      break;
    }
  }
  if (!adbPort) {
    throw new Error(`No free ADB ports available in range ${adbPortStart}-${adbPortEnd}`);
  }

  let vncPort: number | null = null;
  for (let p = vncPortStart; p <= vncPortEnd; p++) {
    if (!occupiedPorts.has(p)) {
      vncPort = p;
      occupiedPorts.add(p);
      break;
    }
  }
  if (!vncPort) {
    vncPort = adbPort + 525; // fallback
  }

  return { adbPort, vncPort };
}

function requireCompanionConfig(): void {
  const missing = [
    ['COMPANION_NETWORK', companionNetwork],
    ['COMPANION_APPIUM_IMAGE', companionAppiumImage],
    ['COMPANION_BOT_IMAGE', companionBotImage],
    ['COMPANION_RABBITMQ_URL', companionRabbitMqUrl],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing companion configuration: ${missing.join(', ')}`);
  }
}

function routingIdFor(adbPort: number, instanceName?: string): string {
  const ids = new Set<string>();
  if (instanceName) ids.add(instanceName);
  ids.add(`${hostPublicIp}:${adbPort}`);
  if (hostPublicIp !== 'localhost') {
    ids.add(`localhost:${adbPort}`);
  }
  return Array.from(ids).join(',');
}

async function reconcileCompanionStack(deviceId: string, adbPort: number, instanceName?: string): Promise<void> {
  requireCompanionConfig();
  await companions.reconcileRunning(deviceId, adbPort, routingIdFor(adbPort, instanceName));
}

async function inspectManagedEmulator(container: Docker.Container): Promise<{
  deviceId: string;
  adbPort: number;
  dynamic: boolean;
  name: string;
  inspect: Docker.ContainerInspectInfo;
}> {
  const inspect = await container.inspect();
  const name = (inspect.Name || '').replace(/^\//, '');
  const dynamic = name !== 'android-emulator';
  if (dynamic && inspect.Config?.Labels?.app !== 'viber-emulator' && !name.startsWith('viber-emu-')) {
    throw new Error('Container is not a Viber emulator');
  }
  const instanceName = inspect.Config?.Labels?.instance || name.replace(/^viber-emu-/, '');
  const adbBinding = inspect.HostConfig?.PortBindings?.['5555/tcp'];
  const adbPort = adbBinding?.[0]?.HostPort ? Number(adbBinding[0].HostPort) : (dynamic ? 0 : 5555);
  if (!adbPort) throw new Error('Emulator has no published ADB port');
  return { deviceId: inspect.Id, adbPort, dynamic, name: instanceName, inspect };
}

// Parse proxy URL (http://user:pass@host:port or socks5://...)
function parseProxy(proxyUrl?: string): Record<string, string> {
  if (!proxyUrl || typeof proxyUrl !== 'string') return {};
  try {
    const parsed = new URL(proxyUrl.trim());
    const type = parsed.protocol.replace(':', '').toLowerCase() || 'socks5';
    const host = parsed.hostname;
    const port = parsed.port || (type.startsWith('socks') ? '1080' : '8080');
    const user = decodeURIComponent(parsed.username || '');
    const pass = decodeURIComponent(parsed.password || '');

    const env: Record<string, string> = {
      PROXY_HOST: host,
      PROXY_PORT: port,
      PROXY_TYPE: type,
      HTTP_PROXY: proxyUrl.trim(),
      HTTPS_PROXY: proxyUrl.trim(),
    };
    if (user) env.PROXY_USER = user;
    if (pass) env.PROXY_PASS = pass;
    return env;
  } catch {
    return {
      HTTP_PROXY: proxyUrl.trim(),
      HTTPS_PROXY: proxyUrl.trim(),
    };
  }
}

interface EmulatorConfig {
  containerName: string;
  instanceName: string;
  adbPort: number;
  vncPort: number;
  ramSize?: number;
  cpuLimit?: number;
  resolution?: string;
  proxyUrl?: string;
  deviceProfile?: string;
}

async function buildAndStartEmulator(config: EmulatorConfig) {
  const defaultRam = Number(process.env.DEFAULT_RAM_SIZE) || 4096;
  const defaultCpu = Number(process.env.DEFAULT_CPU_LIMIT) || 2;
  const {
    containerName,
    instanceName,
    adbPort,
    vncPort,
    ramSize = defaultRam,
    cpuLimit = defaultCpu,
    resolution = '1280x720',
    proxyUrl,
    deviceProfile = 'samsung-tab-s7',
  } = config;

  const envMap: Record<string, string> = {
    GAPPS_SETUP: 'true',
    ROOT_SETUP: 'true',
    DEVICE_PROFILE: deviceProfile,
    SCREEN_RESOLUTION: resolution,
    SCREEN_DENSITY: '240',
    RAM_SIZE: String(ramSize),
    EMULATOR_LEAN_MODE: 'true',
    ...parseProxy(proxyUrl),
  };

  const envVars = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);

  const devices: any[] = [];
  if (checkKvm()) {
    devices.push({ PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm', CgroupPermissions: 'rwm' });
  }
  if (fs.existsSync('/dev/net/tun')) {
    devices.push({ PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun', CgroupPermissions: 'rwm' });
  }

  // Exact volume mounts and overrides used by Viber-parser
  const binds = [
    `emulator-data-${instanceName}:/data`,
    `${hostProjectDir}/emulator/first-boot.sh:/overrides/first-boot.sh:ro`,
    `${hostProjectDir}/emulator/entrypoint.sh:/overrides/entrypoint.sh:ro`,
    `${hostProjectDir}/emulator/setup-device-profile.sh:/overrides/setup-device-profile.sh:ro`,
    `${hostProjectDir}/apk:/apk:ro`,
  ];

  // Headroom for host QEMU process
  const hostMemoryBytes = Math.floor((ramSize + 1024) * 1024 * 1024);
  const hostSwapBytes = Math.floor((ramSize + 3072) * 1024 * 1024);

  const container = (await docker.createContainer({
    name: containerName,
    Image: emulatorImage,
    Cmd: [
      'sh',
      '-c',
      "tr -d '\\r' < /overrides/entrypoint.sh > /root/entrypoint.sh && chmod +x /root/entrypoint.sh && exec /root/entrypoint.sh",
    ],
    Labels: {
      app: 'viber-emulator',
      instance: instanceName,
    },
    Env: envVars,
    HostConfig: {
      Privileged: true,
      NanoCpus: Math.round(cpuLimit * 1_000_000_000),
      Memory: hostMemoryBytes,
      MemorySwap: hostSwapBytes,
      Devices: devices,
      Binds: binds,
      PortBindings: {
        '5555/tcp': [{ HostPort: String(adbPort) }],
        '6080/tcp': [{ HostPort: String(vncPort) }],
      },
      RestartPolicy: { Name: 'unless-stopped' },
    },
  })) as Docker.Container;

  await container.start();
  void ensureScrcpyConnected(adbPort);

  return {
    id: container.id,
    deviceId: instanceName,
    name: instanceName,
    containerName,
    adbPort,
    vncPort,
    adbSerial: `${hostPublicIp}:${adbPort}`,
    scrcpyUrl: buildScrcpyUrl(hostPublicIp, scrcpyPort, adbPort),
  };
}

const accountCache = new VersionedAccountCache<ViberAccountInfo>();

async function checkContainerHealth(containerId: string): Promise<ContainerHealthResult> {
  const cacheGeneration = accountCache.capture(containerId);
  try {
    const container = docker.getContainer(containerId);
    const result = await runContainerCommand(container, {
      Cmd: ['sh', '-c', HEALTH_CHECK_CMD],
    }, 4000);
    const parsed = parseContainerHealthOutput(result.exitCode === 0 ? result.output : '');
    if (parsed.viberAccount) {
      const accepted = accountCache.setIfCurrent(containerId, cacheGeneration, parsed.viberAccount);
      if (!accepted) parsed.viberAccount = accountCache.get(containerId) || null;
    } else if (parsed.viberRunning) {
      parsed.viberAccount = accountCache.get(containerId) || null;
    }
    return parsed;
  } catch {
    return {
      bootCompleted: false,
      viberRunning: false,
      viberAccount: accountCache.get(containerId) || null,
    };
  }
}

// Handlers for endpoints
async function handleHealth(_req: Request, res: Response): Promise<void> {
  let dockerOk = false;
  try {
    await docker.ping();
    dockerOk = true;
  } catch {
    dockerOk = false;
  }

  res.json({
    status: dockerOk ? 'ok' : 'degraded',
    kvm: checkKvm(),
    docker: dockerOk,
    publicIp: hostPublicIp,
    timestamp: new Date().toISOString(),
  });
}

async function handleListEmulators(_req: Request, res: Response): Promise<void> {
  try {
    const containers = await docker.listContainers({ all: true });

    // Include containers labeled app=viber-emulator OR named android-emulator or viber-emu-*
    const emulatorContainers = containers.filter((c: any) => {
      const isLabeled = c.Labels?.app === 'viber-emulator';
      const name = (c.Names[0] || '').replace(/^\//, '');
      const isNamed = name === 'android-emulator' || name.startsWith('viber-emu-');
      return isLabeled || isNamed;
    });

    const emulators = await Promise.all(
      emulatorContainers.map(async (c: any) => {
        const rawName = (c.Names[0] || '').replace(/^\//, '');
        const name = c.Labels?.instance || rawName.replace(/^viber-emu-/, '');
        const adbPortBinding = c.Ports.find((p: any) => p.PrivatePort === 5555);
        const adbPort = adbPortBinding?.PublicPort || (rawName === 'android-emulator' ? 5555 : null);
        const adbSerial = adbPort ? `${hostPublicIp}:${adbPort}` : null;

        if (rawName !== 'android-emulator' && adbPort && c.State === 'running') {
          await reconcileCompanionStack(c.Id, adbPort, name);
        }

        let bootCompleted = false;
        let viberRunning = false;
        let viberAccount: ViberAccountInfo | null = accountCache.get(c.Id) || null;

        if (c.State === 'running') {
          const h = await checkContainerHealth(c.Id);
          bootCompleted = h.bootCompleted;
          viberRunning = h.viberRunning;
          viberAccount = accountCache.get(c.Id) || h.viberAccount || null;
          if (adbPort) {
            void ensureScrcpyConnected(adbPort);
          }
        }

        const isOnline = c.State === 'running';
        let statusText = 'Остановлен';
        if (isOnline) {
          if (viberRunning) {
            statusText = 'Viber активен';
          } else if (bootCompleted) {
            statusText = 'Android загружен';
          } else {
            statusText = 'Запуск сервиса...';
          }
        }

        const setupStatus = bootCompleted
          ? {
              state: 'ready' as const,
              stage: 'complete',
              updatedAt: new Date().toISOString(),
              exitCode: 0,
            }
          : null;

        return {
          id: c.Id,
          deviceId: rawName === 'android-emulator' ? null : name,
          name,
          containerName: rawName,
          status: statusText,
          state: c.State,
          created: c.Created,
          adbPort,
          adbSerial,
          scrcpyUrl: buildScrcpyUrl(hostPublicIp, scrcpyPort, adbPort),
          bootCompleted,
          viberRunning,
          adbOnline: isOnline,
          setupStatus,
          viberAccount,
          supportsViberLogout: true,
        };
      })
    );

    res.json({
      emulators,
      kvmAvailable: checkKvm(),
      vpsHost: hostPublicIp,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleCreateEmulator(req: Request, res: Response): Promise<void> {
  try {
    const { name, ramSize, cpuLimit, resolution, proxyUrl, deviceProfile } = req.body;

    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      res.status(400).json({ error: 'Valid name (alphanumeric, -, _) is required' });
      return;
    }

    const containerName = `viber-emu-${name}`;

    const existing = await docker.listContainers({
      all: true,
      filters: { name: [`^/${containerName}$`] },
    });
    if (existing.length > 0) {
      res.status(409).json({ error: `Emulator with name "${name}" already exists` });
      return;
    }

    const { adbPort, vncPort } = await findFreePorts();

    requireCompanionConfig();
    const result = await buildAndStartEmulator({
      containerName,
      instanceName: name,
      adbPort,
      vncPort,
      ramSize: ramSize ? Number(ramSize) : 4096,
      cpuLimit: cpuLimit ? Number(cpuLimit) : 2,
      resolution: resolution || '1280x720',
      proxyUrl,
      deviceProfile: deviceProfile || 'samsung-tab-s7',
    });
    await companions.provisionNew(result.id, result.adbPort, routingIdFor(result.adbPort, name), async () => {
      const createdEmulator = docker.getContainer(result.id);
      if (await createdEmulator.inspect().catch(() => null)) {
        await createdEmulator.remove({ force: true });
      }
    });

    res.status(201).json({
      ...result,
      status: 'Запуск сервиса...',
      state: 'running',
      bootCompleted: false,
      viberRunning: false,
      adbOnline: true,
      setupStatus: null,
      viberAccount: null,
      supportsViberLogout: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleStartEmulator(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    const emulator = await inspectManagedEmulator(container);
    await companions.runExclusive(emulator.deviceId, async () => {
      let fresh = await inspectManagedEmulator(container);
      if (!fresh.inspect.State.Running) {
        await container.start();
        fresh = await inspectManagedEmulator(container);
      }
      if (fresh.dynamic) {
        requireCompanionConfig();
        await companions.reconcileRunningLocked(fresh.deviceId, fresh.adbPort, routingIdFor(fresh.adbPort, fresh.name));
      }
      void ensureScrcpyConnected(fresh.adbPort);
    });
    res.json({ success: true, message: 'Инстанс запущен' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleStopEmulator(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    const emulator = await inspectManagedEmulator(container);
    await companions.runExclusive(emulator.deviceId, async () => {
      const fresh = await inspectManagedEmulator(container);
      if (fresh.dynamic) {
        await companions.stopCompanionsLocked(fresh.deviceId);
      }
      if (fresh.inspect.State.Running) await container.stop();
    });
    res.json({ success: true, message: 'Инстанс остановлен' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleRestartEmulator(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    const emulator = await inspectManagedEmulator(container);
    await companions.runExclusive(emulator.deviceId, async () => {
      let fresh = await inspectManagedEmulator(container);
      if (fresh.dynamic) {
        await companions.stopCompanionsLocked(fresh.deviceId);
      }
      await container.restart();
      fresh = await inspectManagedEmulator(container);
      if (fresh.dynamic) {
        requireCompanionConfig();
        await companions.reconcileRunningLocked(fresh.deviceId, fresh.adbPort, routingIdFor(fresh.adbPort, fresh.name));
      }
      void ensureScrcpyConnected(fresh.adbPort);
    });
    res.json({ success: true, message: 'Инстанс перезапущен' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleLogoutViber(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    const emulator = await inspectManagedEmulator(container);

    await companions.runExclusive(emulator.deviceId, async () => {
      const fresh = await inspectManagedEmulator(container);
      if (!fresh.inspect.State.Running) {
        throw new Error('Инстанс остановлен');
      }
      await logoutViber(container);
      accountCache.invalidate(fresh.inspect.Id);
    });

    res.json({ success: true, message: 'Выход из Viber выполнен' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleDeleteEmulator(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    const emulator = await inspectManagedEmulator(container);
    const inspect = emulator.inspect;
    const deleteVolumes = req.query.deleteData === 'true';

    await companions.runExclusive(emulator.deviceId, async () => {
      const fresh = await inspectManagedEmulator(container);
      if (fresh.dynamic) {
        await companions.removeCompanionsLocked(fresh.deviceId);
      }
      await container.remove({ force: true });
      if (deleteVolumes && fresh.dynamic) {
        await companions.removeBotDataVolume(fresh.deviceId);
      }
      accountCache.invalidate(inspect.Id);
    });

    if (deleteVolumes && inspect) {
      const name = inspect.Config?.Labels?.instance || (inspect.Name || '').replace(/^\//, '').replace(/^viber-emu-/, '');
      if (name && name !== 'android-emulator') {
        try {
          await docker.getVolume(`emulator-data-${name}`).remove();
        } catch {}
      }
    }

    res.json({ success: true, message: 'Инстанс удален' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleLogsEmulator(req: Request, res: Response): Promise<void> {
  try {
    const tail = Number(req.query.tail || 100);
    const container = docker.getContainer(req.params.id);
    const logBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });
    res.json({ logs: logBuffer.toString('utf8') });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

// Wire routes (both /emulators and /api/emulators prefixes)
app.get('/health', handleHealth);
app.get('/api/health', handleHealth);

app.get('/emulators', handleListEmulators);
app.get('/api/emulators', handleListEmulators);

app.post('/emulators', handleCreateEmulator);
app.post('/api/emulators', handleCreateEmulator);

app.post('/emulators/:id/start', handleStartEmulator);
app.post('/api/emulators/:id/start', handleStartEmulator);

app.post('/emulators/:id/stop', handleStopEmulator);
app.post('/api/emulators/:id/stop', handleStopEmulator);

app.post('/emulators/:id/restart', handleRestartEmulator);
app.post('/api/emulators/:id/restart', handleRestartEmulator);

app.post('/emulators/:id/viber/logout', handleLogoutViber);
app.post('/api/emulators/:id/viber/logout', handleLogoutViber);

app.delete('/emulators/:id', handleDeleteEmulator);
app.delete('/api/emulators/:id', handleDeleteEmulator);

app.get('/emulators/:id/logs', handleLogsEmulator);
app.get('/api/emulators/:id/logs', handleLogsEmulator);

app.listen(port, '0.0.0.0', () => {
  console.log(`[emulator-agent] Listening on port ${port} (public IP: ${hostPublicIp}, KVM: ${checkKvm()})`);
});
