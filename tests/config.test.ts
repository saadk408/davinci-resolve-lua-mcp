import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandHome, loadConfig, stateDirStampProblem } from '../src/config.js';

// Every default-path assertion pins the platform: the suite also runs on a Windows CI runner,
// where process.platform would otherwise select the Windows defaults.
const D = 'darwin';
const HOME = '/Users/tester';

test('defaults derive from HOME and the docs live under /Library', () => {
  const c = loadConfig({}, HOME, D);
  assert.equal(c.platform, 'darwin');
  assert.equal(c.home, HOME);
  assert.equal(c.stateDir, '/Users/tester/.davinci-resolve-lua-mcp');
  assert.equal(c.scriptsDir, '/Users/tester/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility');
  assert.equal(c.prefsDir, '/Users/tester/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles');
  assert.equal(c.docsDir, '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting');
  assert.equal(c.autoInstall, true);
  assert.equal(c.defaultTimeoutS, 30);
  assert.equal(c.maxResponseKb, 64);
  assert.equal(c.logLevel, 'info');
  assert.deepEqual(c.problems, []);
});

test('values are read, ~ expanded, trailing slashes dropped and empty strings treated as unset', () => {
  const c = loadConfig(
    {
      RLB_STATE_DIR: '~/state/',
      RLB_SCRIPTS_DIR: '',
      RLB_AUTO_INSTALL: 'false',
      RLB_DEFAULT_TIMEOUT_S: '120',
      RLB_MAX_RESPONSE_KB: '192',
      RLB_LOG_LEVEL: 'DEBUG',
      RLB_PREFS_DIR: '/p',
      RLB_DOCS_DIR: '/d',
    },
    HOME,
    D,
  );
  assert.equal(c.stateDir, '/Users/tester/state');
  assert.equal(c.scriptsDir, '/Users/tester/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility');
  assert.equal(c.autoInstall, false);
  assert.equal(c.defaultTimeoutS, 120);
  assert.equal(c.maxResponseKb, 192);
  assert.equal(c.logLevel, 'debug');
  assert.equal(c.prefsDir, '/p');
  assert.equal(c.docsDir, '/d');
  assert.deepEqual(c.problems, []);
  assert.equal(expandHome('~', HOME, D), HOME);
  assert.equal(expandHome('~/x', HOME, D), '/Users/tester/x');
  assert.equal(expandHome('~x', HOME, D), '~x');
  assert.equal(expandHome('${HOME}', HOME, D), HOME);
  assert.equal(expandHome('${HOME}/.davinci-resolve-lua-mcp', HOME, D), '/Users/tester/.davinci-resolve-lua-mcp');
  assert.equal(expandHome('${HOMEX}/y', HOME, D), '${HOMEX}/y');
  assert.equal(expandHome('${HOME}\\x', HOME, D), '${HOME}\\x', 'a backslash is a file-name character on macOS');
});

test('bad values fall back and are recorded as problems', () => {
  const c = loadConfig(
    {
      RLB_STATE_DIR: 'relative/dir',
      RLB_AUTO_INSTALL: 'maybe',
      RLB_DEFAULT_TIMEOUT_S: '0',
      RLB_MAX_RESPONSE_KB: '1.5',
      RLB_LOG_LEVEL: 'loud',
    },
    HOME,
    D,
  );
  assert.equal(c.stateDir, '/Users/tester/.davinci-resolve-lua-mcp');
  assert.equal(c.autoInstall, true);
  assert.equal(c.defaultTimeoutS, 30);
  assert.equal(c.maxResponseKb, 64);
  assert.equal(c.logLevel, 'info');
  assert.equal(c.problems.length, 5);
  assert.match(c.problems[0] ?? '', /RLB_STATE_DIR/);
  assert.match(c.problems[4] ?? '', /RLB_LOG_LEVEL/);
});

test('a state dir that cannot be stamped disables auto-install', () => {
  assert.equal(stateDirStampProblem('/Users/x/.davinci-resolve-lua-mcp'), undefined);
  assert.match(stateDirStampProblem('/x/]==]/y') ?? '', /]==]/);
  assert.match(stateDirStampProblem('/x/"q"') ?? '', /quote/);
  assert.match(stateDirStampProblem('/x/back\\slash') ?? '', /backslash/);
  assert.match(stateDirStampProblem('/x/new\nline') ?? '', /line break/);
  assert.match(stateDirStampProblem('@@/x') ?? '', /@@/);
  const c = loadConfig({ RLB_STATE_DIR: '/tmp/a]==]b' }, HOME, D);
  assert.equal(c.autoInstall, false);
  assert.equal(c.stateDir, '/tmp/a]==]b');
  assert.match(c.problems[0] ?? '', /cannot be installed/);
});

test('the literal ${HOME} defaults Claude Desktop 2.2553.1 passes through are expanded without a problem', () => {
  const c = loadConfig(
    {
      RLB_STATE_DIR: '${HOME}/.davinci-resolve-lua-mcp',
      RLB_SCRIPTS_DIR: '${HOME}/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility',
    },
    HOME,
    D,
  );
  assert.equal(c.stateDir, '/Users/tester/.davinci-resolve-lua-mcp');
  assert.equal(c.scriptsDir, '/Users/tester/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility');
  assert.deepEqual(c.problems, []);
});

test('the unfilled ${user_config.<key>} placeholders Claude Desktop 2.7032.0 passes for unsaved settings count as unset', () => {
  const c = loadConfig(
    {
      RLB_SCRIPTS_DIR: '${user_config.scripts_dir}',
      RLB_PREFS_DIR: ' ${user_config.prefs_dir} ',
      RLB_AUTO_INSTALL: '${user_config.auto_install_bridge}',
      RLB_DEFAULT_TIMEOUT_S: '${user_config.default_timeout_s}',
    },
    HOME,
    D,
  );
  assert.equal(c.scriptsDir, '/Users/tester/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility');
  assert.equal(c.prefsDir, '/Users/tester/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Profiles');
  assert.equal(c.autoInstall, true);
  assert.equal(c.defaultTimeoutS, 30);
  assert.deepEqual(c.problems, []);
  // Only a whole placeholder means unset; anything around or inside it is still validated.
  const d = loadConfig({ RLB_SCRIPTS_DIR: '${user_config.scripts_dir}/x', RLB_PREFS_DIR: '${user_config.}' }, HOME, D);
  assert.equal(d.problems.length, 2);
  assert.match(d.problems[0] ?? '', /RLB_SCRIPTS_DIR/);
  assert.match(d.problems[1] ?? '', /RLB_PREFS_DIR/);
});

// Windows: Blackmagic's shipped README documents the per-user folders under
// %APPDATA%\Blackmagic Design\DaVinci Resolve\Support\ and the docs under %PROGRAMDATA%; the
// state dir is spelled with forward slashes because it is stamped into the Lua files.
const W = 'win32';
const WHOME = 'C:\\Users\\Tester';
const WENV = { APPDATA: 'C:\\Users\\Tester\\AppData\\Roaming', PROGRAMDATA: 'C:\\ProgramData' };

test('win32 defaults follow the shipped README and the state dir is spelled with forward slashes', () => {
  const c = loadConfig(WENV, WHOME, W);
  assert.equal(c.platform, 'win32');
  assert.equal(c.home, WHOME);
  assert.equal(c.stateDir, 'C:/Users/Tester/.davinci-resolve-lua-mcp');
  assert.equal(c.scriptsDir, 'C:\\Users\\Tester\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility');
  assert.equal(c.prefsDir, 'C:\\Users\\Tester\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Profiles');
  assert.equal(c.docsDir, 'C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting');
  assert.equal(stateDirStampProblem(c.stateDir), undefined);
  assert.equal(c.autoInstall, true);
  assert.deepEqual(c.problems, []);
});

test('win32 without APPDATA and PROGRAMDATA falls back to their documented locations', () => {
  const c = loadConfig({}, WHOME, W);
  assert.equal(c.scriptsDir, 'C:\\Users\\Tester\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility');
  assert.equal(c.prefsDir, 'C:\\Users\\Tester\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Profiles');
  assert.equal(c.docsDir, 'C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting');
  assert.deepEqual(c.problems, []);
});

test('win32 expands ~ and ${HOME} with either separator and slash-normalises only the state dir', () => {
  const c = loadConfig(
    { ...WENV, RLB_STATE_DIR: '${HOME}\\rlb\\', RLB_SCRIPTS_DIR: '~/Scripts/Utility', RLB_PREFS_DIR: 'D:/prefs/', RLB_DOCS_DIR: '${HOME}/docs' },
    WHOME,
    W,
  );
  assert.equal(c.stateDir, 'C:/Users/Tester/rlb');
  assert.equal(c.scriptsDir, 'C:\\Users\\Tester\\Scripts\\Utility');
  assert.equal(c.prefsDir, 'D:\\prefs');
  assert.equal(c.docsDir, 'C:\\Users\\Tester\\docs');
  assert.deepEqual(c.problems, []);
  assert.equal(expandHome('~\\x', WHOME, W), 'C:\\Users\\Tester\\x');
  assert.equal(expandHome('~/x', WHOME, W), 'C:\\Users\\Tester\\x');
  assert.equal(expandHome('${HOME}', WHOME, W), WHOME);
  assert.equal(expandHome('~x', WHOME, W), '~x');
});

test('win32: a relative state dir falls back, UNC and drive roots stay rooted, non-ASCII is a named problem and not a fallback', () => {
  assert.equal(loadConfig({ ...WENV, RLB_STATE_DIR: 'rlb\\state' }, WHOME, W).stateDir, 'C:/Users/Tester/.davinci-resolve-lua-mcp');
  assert.equal(loadConfig({ ...WENV, RLB_STATE_DIR: '\\\\nas\\share\\rlb\\' }, WHOME, W).stateDir, '//nas/share/rlb');
  assert.equal(loadConfig({ ...WENV, RLB_STATE_DIR: 'D:\\' }, WHOME, W).stateDir, 'D:/');
  const jose = loadConfig(WENV, 'C:\\Users\\José', W);
  assert.equal(jose.stateDir, 'C:/Users/José/.davinci-resolve-lua-mcp');
  assert.equal(jose.autoInstall, true);
  assert.equal(jose.problems.length, 1);
  assert.match(jose.problems[0] ?? '', /non-ASCII[\s\S]*RLB_STATE_DIR/);
  assert.deepEqual(loadConfig({}, '/Users/José', D).problems, [], 'macOS never warns');
});
