import type Docker from 'dockerode';
import { runContainerCommand } from './container-command.js';

type CommandRunner = typeof runContainerCommand;

export async function logoutViber(
  container: Pick<Docker.Container, 'exec'>,
  runCommand: CommandRunner = runContainerCommand,
): Promise<void> {
  const result = await runCommand(container, {
    Cmd: ['adb', 'shell', 'pm', 'clear', 'com.viber.voip'],
  }, 15_000);

  if (result.exitCode !== 0 || result.output.trim() !== 'Success') {
    throw new Error('Не удалось выйти из Viber: данные приложения не очищены');
  }
}
