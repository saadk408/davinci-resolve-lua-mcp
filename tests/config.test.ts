import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandHome, loadConfig, stateDirStampProblem } from '../src/config.js';

const HOME = '/Users/tester';

test('defaults derive from HOME and the docs live under /Library', () => {
  const c = loadConfig({}, HOME);
  assert.equal(c.stateDir, '/Users/tester/.resolve-lua-bridge');
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
  assert.equal(expandHome('~', HOME), HOME);
  assert.equal(expandHome('~/x', HOME), '/Users/tester/x');
  assert.equal(expandHome('~x', HOME), '~x');
  assert.equal(expandHome('${HOME}', HOME), HOME);
  assert.equal(expandHome('${HOME}/.resolve-lua-bridge', HOME), '/Users/tester/.resolve-lua-bridge');
  assert.equal(expandHome('${HOMEX}/y', HOME), '${HOMEX}/y');
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
  );
  assert.equal(c.stateDir, '/Users/tester/.resolve-lua-bridge');
  assert.equal(c.autoInstall, true);
  assert.equal(c.defaultTimeoutS, 30);
  assert.equal(c.maxResponseKb, 64);
  assert.equal(c.logLevel, 'info');
  assert.equal(c.problems.length, 5);
  assert.match(c.problems[0] ?? '', /RLB_STATE_DIR/);
  assert.match(c.problems[4] ?? '', /RLB_LOG_LEVEL/);
});

test('a state dir that cannot be stamped disables auto-install', () => {
  assert.equal(stateDirStampProblem('/Users/x/.resolve-lua-bridge'), undefined);
  assert.match(stateDirStampProblem('/x/]==]/y') ?? '', /]==]/);
  assert.match(stateDirStampProblem('/x/"q"') ?? '', /quote/);
  assert.match(stateDirStampProblem('/x/back\\slash') ?? '', /backslash/);
  assert.match(stateDirStampProblem('/x/new\nline') ?? '', /line break/);
  assert.match(stateDirStampProblem('@@/x') ?? '', /@@/);
  const c = loadConfig({ RLB_STATE_DIR: '/tmp/a]==]b' }, HOME);
  assert.equal(c.autoInstall, false);
  assert.equal(c.stateDir, '/tmp/a]==]b');
  assert.match(c.problems[0] ?? '', /cannot be installed/);
});

test('the literal ${HOME} defaults Claude Desktop 2.2553.1 passes through are expanded without a problem', () => {
  const c = loadConfig(
    {
      RLB_STATE_DIR: '${HOME}/.resolve-lua-bridge',
      RLB_SCRIPTS_DIR: '${HOME}/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility',
    },
    HOME,
  );
  assert.equal(c.stateDir, '/Users/tester/.resolve-lua-bridge');
  assert.equal(c.scriptsDir, '/Users/tester/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility');
  assert.deepEqual(c.problems, []);
});
