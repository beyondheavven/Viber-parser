import type Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_OUTPUT_LENGTH = 256 * 1024;

export interface CommandResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  outputTruncated: boolean;
  execId?: string;
}

export async function runContainerCommand(
  container: Pick<Docker.Container, 'exec'>,
  options: Docker.ExecCreateOptions,
  timeoutMs: number,
): Promise<CommandResult> {
  const controller = new AbortController();
  const timeoutError = new Error('Container command timed out');
  const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const { signal } = controller;
  let output = '';
  let outputTruncated = false;
  let exec: Docker.Exec | undefined;
  let stream: Awaited<ReturnType<Docker.Exec['start']>> | undefined;
  const logs = new PassThrough();
  const decoder = new StringDecoder('utf8');

  const waitFor = <T>(promise: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(timeoutError);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) reject(timeoutError);
  });

  const append = (text: string): void => {
    output += text;
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(-MAX_OUTPUT_LENGTH);
      outputTruncated = true;
    }
  };
  logs.on('data', (chunk: Buffer) => append(decoder.write(chunk)));

  try {
    exec = await waitFor(container.exec({
      ...options,
      Tty: false,
      AttachStdout: true,
      AttachStderr: true,
      abortSignal: signal,
    }));
    stream = await waitFor(exec.start({ abortSignal: signal }));
    const finished = new Promise<void>((resolve, reject) => {
      stream!.once('end', resolve);
      stream!.once('close', resolve);
      stream!.once('error', reject);
    });
    exec.modem.demuxStream(stream, logs, logs);
    await waitFor(finished);
    append(decoder.end());

    while (true) {
      const state = await waitFor(exec.inspect({ abortSignal: signal }));
      if (!state.Running && state.ExitCode !== null) {
        return { output, exitCode: state.ExitCode, timedOut: false, outputTruncated, execId: exec.id };
      }
      await delay(250, undefined, { signal });
    }
  } catch (error) {
    if (signal.aborted) {
      append(decoder.end());
      return { output, exitCode: null, timedOut: true, outputTruncated, execId: exec?.id };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    stream?.destroy();
    logs.destroy();
  }
}
