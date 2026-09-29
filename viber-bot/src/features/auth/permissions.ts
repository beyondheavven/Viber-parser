/** The slice of `Adb` this module needs, so tests can hand in a stub. */
export interface ShellRunner {
  shell(command: string, options?: { allowFailure?: boolean; timeout?: number }): string;
}

const PERMISSION_NAME = /^[A-Za-z0-9_.]+$/u;

/**
 * Permissions an app declares, from `dumpsys package <pkg>`: the lines of the
 * "requested permissions:" block, up to the next section header.
 */
export function parseRequestedPermissions(dumpsys: string): string[] {
  const permissions = new Set<string>();
  let blockIndent: number | null = null;

  for (const line of dumpsys.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = line.length - line.trimStart().length;

    if (blockIndent === null) {
      if (trimmed === 'requested permissions:') blockIndent = indent;
      continue;
    }
    if (indent <= blockIndent) break;

    const name = trimmed.split(':')[0]?.trim() ?? '';
    if (PERMISSION_NAME.test(name)) permissions.add(name);
  }

  return [...permissions];
}

/**
 * Grants the app every permission it asks for, before the UI flow starts.
 *
 * Every runtime permission granted here is one "Allow" dialog that never
 * shows up during activation — contacts, call log, notifications, camera and
 * the rest. `pm grant` refuses install-time and signature permissions; those
 * failures are expected and ignored.
 */
export function grantAppPermissions(adb: ShellRunner, appPackage: string): string[] {
  const dumpsys = adb.shell(`dumpsys package ${appPackage}`, { allowFailure: true });
  const permissions = parseRequestedPermissions(dumpsys);
  if (permissions.length === 0) return [];

  // Names were checked against PERMISSION_NAME and this shell is root:
  // nothing from the dump reaches it unchecked.
  adb.shell(
    `for p in ${permissions.join(' ')}; do pm grant ${appPackage} "$p" >/dev/null 2>&1; done; true`,
    { allowFailure: true },
  );
  return permissions;
}
