// Entry point: config, logging, the lock, the stdio transport, then the self-install check.
// stdout is the MCP transport: nothing here writes to it.
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { installBridgeFiles, type InstallResult } from './bridgeInstall.js';
import { loadConfig } from './config.js';
import { DocsIndex } from './docsSearch.js';
import { createLogger } from './log.js';
import { BridgeClient } from './protocol.js';
import { createServer, SERVER_VERSION } from './server.js';

/** The bundle root (holds bridge/ and scripts/) both from src/ in development and from server/ in the bundle. */
const BUNDLE_DIR = path.resolve(__dirname, '..');
const RETRYABLE_INSTALL = new Set(['scripts_dir_missing', 'permission_denied', 'error']);

async function main(): Promise<void> {
  process.on('uncaughtException', (err) => {
    console.error(`${new Date().toISOString()} ERROR uncaught exception: ${err.stack ?? err.message}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error(`${new Date().toISOString()} ERROR unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
    process.exit(1);
  });

  const config = loadConfig(process.env);
  let logFile: string | undefined = path.join(config.stateDir, 'server.log');
  try {
    await fsp.mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    config.problems.push(`cannot create RLB_STATE_DIR ${config.stateDir}: ${(err as Error).message}`);
    logFile = undefined;
  }
  const logger = createLogger({ file: logFile, level: config.logLevel });
  logger.info('starting', { version: SERVER_VERSION, pid: process.pid, node: process.version, state_dir: config.stateDir });
  for (const p of config.problems) logger.warn('config problem', p);

  const bridge = new BridgeClient({
    stateDir: config.stateDir,
    prefsDir: config.prefsDir,
    maxResponseKb: config.maxResponseKb,
    logger,
  });
  if (await bridge.acquireLock()) {
    await bridge.removeStaleRequest();
  } else {
    logger.warn('request slot lock is held by another server; tools will report it until it is released', bridge.lock);
  }

  const docs = new DocsIndex(config.docsDir);

  let installResult: InstallResult | undefined;
  let installing: Promise<InstallResult> | undefined;
  const install = (): Promise<InstallResult> => {
    if (installResult && !RETRYABLE_INSTALL.has(installResult.outcome)) return Promise.resolve(installResult);
    if (!installing) {
      installing = installBridgeFiles({
        scriptsDir: config.scriptsDir,
        stateDir: config.stateDir,
        autoInstall: config.autoInstall,
        bundleDir: BUNDLE_DIR,
        logger,
      })
        .then((r) => {
          installResult = r;
          return r;
        })
        .finally(() => {
          installing = undefined;
        });
    }
    return installing;
  };

  const handle = serveStdio(() => createServer({ config, bridge, docs, install, logger, logFile }), {
    onerror: (err) => logger.error('transport error', err),
  });
  logger.info('serving on stdio');

  // After the transport is up, so the host never waits on file I/O.
  setImmediate(() => {
    install()
      .then((r) => logger.info('bridge script check', { outcome: r.outcome, message: r.message }))
      .catch((err: unknown) => logger.error('bridge script check failed', err));
  });

  let closing = false;
  const shutdown = (why: string, code: number): void => {
    if (closing) return;
    closing = true;
    logger.info('shutting down', { why });
    // The lock guards an in-flight request's slot: release it only after the transport (and any
    // tool call still polling the prefs file) has finished, never before.
    handle
      .close()
      .catch(() => undefined)
      .finally(() => {
        bridge.releaseLockSync();
        process.exit(code);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  // The host closes stdin to ask for a shutdown, then waits before SIGTERM (MCP stdio transport).
  // In-flight tool calls finish first (the event loop drains on its own); the unref'd timer only
  // forces the exit when something keeps the loop alive.
  process.stdin.on('end', () => {
    logger.info('stdin closed; exiting once in-flight work is done');
    setTimeout(() => shutdown('stdin closed (grace period over)', 0), 5000).unref();
  });
  process.on('exit', () => bridge.releaseLockSync());
}

void main();
