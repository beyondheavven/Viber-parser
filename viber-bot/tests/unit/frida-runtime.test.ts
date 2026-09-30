import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }));

vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));
vi.mock('frida', () => ({ getDevice: vi.fn() }));

import { createFridaRuntime } from '../../src/platform/frida/frida-runtime.js';

const VERSION = '17.17.0';

interface FakeDevice {
  commands: string[];
  serverPid: string | null;
}

function fakeDevice(serverStartTicks: number, systemServerStartTicks: number): FakeDevice {
  const device: FakeDevice = { commands: [], serverPid: '2701' };
  mocks.spawnSync.mockImplementation((_bin: string, args: string[]) => {
    const command = args.slice(3).join(' ');
    device.commands.push(command);
    let stdout = '';
    if (command === 'pidof frida-server') stdout = device.serverPid ?? '';
    else if (command.includes('--version')) stdout = `${VERSION}\n`;
    else if (command.startsWith('readlink')) stdout = '/data/local/tmp/frida-server\n';
    else if (command === 'pidof system_server') stdout = '21634\n';
    else if (command.includes('/proc/2701/stat')) stdout = `${String(serverStartTicks)}\n`;
    else if (command.includes('/proc/21634/stat')) stdout = `${String(systemServerStartTicks)}\n`;
    else if (command.startsWith('killall')) device.serverPid = null;
    else if (command.endsWith(' -D')) device.serverPid = '3100';
    return { stdout, stderr: '', status: 0, signal: null };
  });
  return device;
}

function runtime() {
  return createFridaRuntime({ adbBin: 'adb', serial: 'host.docker.internal:5556', pkg: 'com.viber.voip' });
}

describe('ensureServerRunning', () => {
  beforeEach(() => {
    mocks.spawnSync.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('restarts a frida-server that predates the running system_server', async () => {
    const device = fakeDevice(1_000, 9_000);

    await expect(runtime().ensureServerRunning(VERSION, 'x86_64')).resolves.toBe(VERSION);

    expect(device.commands.some((command) => command.startsWith('killall'))).toBe(true);
    expect(device.commands.some((command) => command.endsWith(' -D'))).toBe(true);
    expect(device.serverPid).toBe('3100');
  });

  it('reuses a frida-server started after the running system_server', async () => {
    const device = fakeDevice(9_000, 1_000);

    await expect(runtime().ensureServerRunning(VERSION, 'x86_64')).resolves.toBe(VERSION);

    expect(device.commands.some((command) => command.startsWith('killall'))).toBe(false);
    expect(device.serverPid).toBe('2701');
  });
});
