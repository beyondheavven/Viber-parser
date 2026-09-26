/**
 * Abortable delay. Resolves early when `signal` fires so a running campaign
 * can stop without waiting out the full interval.
 */
export async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
