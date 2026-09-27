import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import Docker from 'dockerode';
import fs from 'node:fs';
import { runContainerCommand } from './container-command.js';

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
const hostPublicIp = process.env.HOST_PUBLIC_IP || '136.92.24.88';

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

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

// Helper: Build Scrcpy-Web Stream URL
function buildScrcpyUrl(publicIp: string, port: number, adbPort: number | null): string | null {
  if (!adbPort) return null;
  const udid = `host.docker.internal:${adbPort}`;
  const wsUrl = `ws://${publicIp}:${port}/`;
  const hash = `#!action=stream&udid=${encodeURIComponent(udid)}&player=mse&ws=${encodeURIComponent(wsUrl)}`;
  return `http://${publicIp}:${port}/${hash}`;
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
    name: instanceName,
    containerName,
    adbPort,
    vncPort,
    adbSerial: `${hostPublicIp}:${adbPort}`,
    scrcpyUrl: buildScrcpyUrl(hostPublicIp, scrcpyPort, adbPort),
  };
}

async function checkContainerHealth(containerId: string): Promise<{ bootCompleted: boolean; viberRunning: boolean }> {
  try {
    const container = docker.getContainer(containerId);
    const result = await runContainerCommand(container, {
      Cmd: ['sh', '-c', 'adb shell "getprop sys.boot_completed; pidof com.viber.voip || true" 2>/dev/null || true'],
    }, 3000);
    const lines = (result.exitCode === 0 ? result.output : '').trim().split('\n');
    const bootCompleted = lines.some((l) => l.trim() === '1');
    const viberRunning = lines.some((l) => /\b\d{2,}\b/.test(l.trim()));
    return { bootCompleted, viberRunning };
  } catch {
    return { bootCompleted: false, viberRunning: false };
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

        let bootCompleted = false;
        let viberRunning = false;

        if (c.State === 'running') {
          const h = await checkContainerHealth(c.Id);
          bootCompleted = h.bootCompleted;
          viberRunning = h.viberRunning;
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

        return {
          id: c.Id,
          name,
          containerName: rawName,
          status: statusText,
          state: c.State,
          created: c.Created,
          adbPort,
          adbSerial: adbPort ? `${hostPublicIp}:${adbPort}` : null,
          scrcpyUrl: buildScrcpyUrl(hostPublicIp, scrcpyPort, adbPort),
          bootCompleted,
          viberRunning,
          adbOnline: isOnline,
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

    res.status(201).json({
      ...result,
      status: 'Запуск сервиса...',
      state: 'running',
      bootCompleted: false,
      viberRunning: false,
      adbOnline: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleStartEmulator(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    await container.start();
    const inspect = await container.inspect();
    const portBindings = inspect.HostConfig?.PortBindings || {};
    const adbBinding = portBindings['5555/tcp'];
    const adbPort = adbBinding?.[0]?.HostPort ? Number(adbBinding[0].HostPort) : null;
    if (adbPort) {
      void ensureScrcpyConnected(adbPort);
    }
    res.json({ success: true, message: 'Инстанс запущен' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleStopEmulator(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    await container.stop();
    res.json({ success: true, message: 'Инстанс остановлен' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleRestartEmulator(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    await container.restart();
    res.json({ success: true, message: 'Инстанс перезапущен' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function handleDeleteEmulator(req: Request, res: Response): Promise<void> {
  try {
    const container = docker.getContainer(req.params.id);
    const inspect = await container.inspect().catch(() => null);
    const deleteVolumes = req.query.deleteData === 'true';

    await container.remove({ force: true });

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

app.delete('/emulators/:id', handleDeleteEmulator);
app.delete('/api/emulators/:id', handleDeleteEmulator);

app.get('/emulators/:id/logs', handleLogsEmulator);
app.get('/api/emulators/:id/logs', handleLogsEmulator);

app.listen(port, '0.0.0.0', () => {
  console.log(`[emulator-agent] Listening on port ${port} (public IP: ${hostPublicIp}, KVM: ${checkKvm()})`);
});
