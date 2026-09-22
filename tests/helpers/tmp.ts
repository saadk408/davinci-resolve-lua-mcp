// Temp directories for the Node tests: a state dir, a prefs profiles dir, a docs dir and a
// scripts dir per test, removed afterwards. Nothing under ~/Library or /Library is ever touched.
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TempDirs {
  root: string;
  stateDir: string;
  prefsDir: string;
  docsDir: string;
  scriptsDir: string;
  cleanup(): Promise<void>;
}

export async function makeTempDirs(prefix = 'rlb-test-'): Promise<TempDirs> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const dirs = {
    stateDir: path.join(root, 'state'),
    prefsDir: path.join(root, 'Profiles'),
    docsDir: path.join(root, 'docs'),
    scriptsDir: path.join(root, 'Utility'),
  };
  // `mode` is ignored on Windows (fs.mkdir documents it as unsupported there); the dirs inherit the temp folder ACLs.
  await Promise.all(Object.values(dirs).map((d) => fsp.mkdir(d, { recursive: true, mode: 0o700 })));
  return {
    root,
    ...dirs,
    // Windows answers EBUSY for a moment when a poller is mid-read at cleanup time; Node retries these.
    cleanup: () => fsp.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  };
}

export function repoRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll until `cond` is true, or fail after `timeoutMs`. */
export async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs = 2000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > deadline) throw new Error(`waitFor: condition not met within ${timeoutMs} ms`);
    await sleep(stepMs);
  }
}
