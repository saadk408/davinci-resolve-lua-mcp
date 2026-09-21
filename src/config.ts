// RLB_* environment parsing. Never throws: every bad value falls back to its default and is
// recorded in `problems`, which resolve_status reports (docs/plan.md, Step 3 "Defensive behaviour").
import * as os from 'node:os';
import * as path from 'node:path';
import { isLogLevel, type LogLevel } from './log.js';

export interface Config {
  /** Request slot, lock and server.log live here (mode 0700). */
  stateDir: string;
  /** Resolve's user Utility scripts folder: the only Resolve path the server writes. */
  scriptsDir: string;
  autoInstall: boolean;
  /** Default `timeout_s` for run_lua and the bridge-backed tools, 1..300. */
  defaultTimeoutS: number;
  /** Response cap sent to the bridge as `max_kb`, 1..192. */
  maxResponseKb: number;
  logLevel: LogLevel;
  /** Directory holding `<profile>/Fusion.prefs`; the newest profile file is used. */
  prefsDir: string;
  /** Blackmagic's shipped scripting docs (read-only). */
  docsDir: string;
  problems: string[];
}

export const TIMEOUT_MIN_S = 1;
export const TIMEOUT_MAX_S = 300;
export const RESPONSE_KB_MIN = 1;
export const RESPONSE_KB_MAX = 192;

export const DEFAULT_TIMEOUT_S = 30;
export const DEFAULT_RESPONSE_KB = 64;
export const DEFAULT_DOCS_DIR =
  '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting';

export function defaultStateDir(home: string): string {
  return path.join(home, '.davinci-resolve-lua-mcp');
}

export function defaultScriptsDir(home: string): string {
  return path.join(
    home,
    'Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility',
  );
}

export function defaultPrefsDir(home: string): string {
  return path.join(home, 'Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles');
}

/** Expand a leading `~` or `~/`; anything else is returned unchanged. */
/**
 * `~`, `~/x`, `${HOME}` and `${HOME}/x` become absolute. The MCPB manifest spec lets a
 * `user_config.default` use `${HOME}`, but Claude Desktop 2.2553.1 passed the default through
 * literally (measured 2026-09-21), so the server expands it as well.
 */
export function expandHome(value: string, home: string): string {
  if (value === '~' || value === '${HOME}') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  if (value.startsWith('${HOME}/')) return path.join(home, value.slice('${HOME}/'.length));
  return value;
}

/**
 * The state directory is spliced into the Lua files at install time: into a `[==[...]==]` literal
 * in the bridge and into a double-quoted literal in the diagnostic. Characters that could close
 * either literal, or the `@@` prefix the bridge treats as "unstamped", are refused.
 */
export function stateDirStampProblem(dir: string): string | undefined {
  if (dir.includes(']==]')) return 'contains "]==]", which would close the Lua long-bracket stamp';
  if (dir.includes('"')) return 'contains a double quote, which would break the diagnostic stamp';
  if (dir.includes('\\')) return 'contains a backslash, which would break the diagnostic stamp';
  if (/[\r\n]/.test(dir)) return 'contains a line break';
  if (dir.startsWith('@@')) return 'starts with "@@", which the bridge treats as an unstamped placeholder';
  return undefined;
}

function pick(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // MCPB substitutes "" for an unset directory picker; treat it as unset.
  return trimmed === '' ? undefined : trimmed;
}

function readDir(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
  home: string,
  problems: string[],
): string {
  const raw = pick(env, name);
  if (raw === undefined) return fallback;
  const expanded = expandHome(raw, home);
  if (!path.isAbsolute(expanded)) {
    problems.push(`${name}="${raw}" is not an absolute path; using ${fallback}`);
    return fallback;
  }
  return path.normalize(expanded).replace(/(.)\/+$/, '$1');
}

function readInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const raw = pick(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name}="${raw}" is not an integer in ${min}..${max}; using ${fallback}`);
    return fallback;
  }
  return n;
}

function readBool(env: NodeJS.ProcessEnv, name: string, fallback: boolean, problems: string[]): boolean {
  const raw = pick(env, name);
  if (raw === undefined) return fallback;
  const v = raw.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  problems.push(`${name}="${raw}" is not a boolean; using ${fallback}`);
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): Config {
  const problems: string[] = [];
  const stateDir = readDir(env, 'RLB_STATE_DIR', defaultStateDir(home), home, problems);
  const stampProblem = stateDirStampProblem(stateDir);
  if (stampProblem) {
    problems.push(`RLB_STATE_DIR="${stateDir}" ${stampProblem}; the bridge files cannot be installed with it`);
  }
  const scriptsDir = readDir(env, 'RLB_SCRIPTS_DIR', defaultScriptsDir(home), home, problems);
  const autoInstall = readBool(env, 'RLB_AUTO_INSTALL', true, problems);
  const defaultTimeoutS = readInt(env, 'RLB_DEFAULT_TIMEOUT_S', DEFAULT_TIMEOUT_S, TIMEOUT_MIN_S, TIMEOUT_MAX_S, problems);
  const maxResponseKb = readInt(env, 'RLB_MAX_RESPONSE_KB', DEFAULT_RESPONSE_KB, RESPONSE_KB_MIN, RESPONSE_KB_MAX, problems);
  const rawLevel = pick(env, 'RLB_LOG_LEVEL');
  let logLevel: LogLevel = 'info';
  if (rawLevel !== undefined) {
    if (isLogLevel(rawLevel.toLowerCase())) logLevel = rawLevel.toLowerCase() as LogLevel;
    else problems.push(`RLB_LOG_LEVEL="${rawLevel}" is not one of debug, info, warn, error; using info`);
  }
  const prefsDir = readDir(env, 'RLB_PREFS_DIR', defaultPrefsDir(home), home, problems);
  const docsDir = readDir(env, 'RLB_DOCS_DIR', DEFAULT_DOCS_DIR, home, problems);
  return {
    stateDir,
    scriptsDir,
    autoInstall: autoInstall && stampProblem === undefined,
    defaultTimeoutS,
    maxResponseKb,
    logLevel,
    prefsDir,
    docsDir,
    problems,
  };
}
