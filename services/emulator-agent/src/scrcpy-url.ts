/**
 * Link to an emulator's screen in scrcpy-web (ws-scrcpy).
 *
 * ws-scrcpy streams only through `proxy-adb` to the scrcpy server on the
 * device (tcp:8886): a bare `ws://host:port/` opens the page with a black
 * screen. The broadway player works in an iframe where MSE does not.
 *
 * `publicIp` must be the VM's address (HOST_PUBLIC_IP): the link is opened
 * from the browser, where `localhost` is the viewer's own machine.
 */
export function buildScrcpyUrl(publicIp: string, port: number, adbPort: number | null): string | null {
  if (!adbPort) return null;
  const udid = adbPort === 5555 ? 'android-emulator:5555' : `host.docker.internal:${adbPort}`;
  const ws = new URLSearchParams({ action: 'proxy-adb', remote: 'tcp:8886', udid });
  const wsUrl = `ws://${publicIp}:${port}/?${ws.toString()}`;
  const hash = new URLSearchParams({ action: 'stream', udid, player: 'broadway', ws: wsUrl });
  return `http://${publicIp}:${port}/#!${hash.toString()}`;
}
