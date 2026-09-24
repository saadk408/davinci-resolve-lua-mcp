import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimecode,
  frameToTimecode,
  makeAnchor,
  parseTimecode,
  timecodeBase,
  timecodeToFrame,
  usesDropFrame,
  type Anchor,
  type TcResult,
} from '../src/timecode.js';

function value<T>(r: TcResult<T>): T {
  if (!r.ok) assert.fail(`expected ok, got error: ${r.error}`);
  return r.value;
}

function error<T>(r: TcResult<T>): string {
  if (r.ok) assert.fail(`expected an error, got ${JSON.stringify(r.value)}`);
  return r.error;
}

// [fps, drop-frame, label, count]; "measured" rows are values Resolve 21.1 reported.
const KNOWN: Array<[number, boolean, string, number]> = [
  [29.97, true, '00:00:59;29', 1799],
  [29.97, true, '00:01:00;02', 1800],
  [29.97, true, '00:09:59;29', 17981],
  [29.97, true, '00:10:00;00', 17982],
  [29.97, true, '00:10:00;01', 17983], // minute 10 drops nothing
  [29.97, true, '01:00:00;00', 107892], // measured
  [29.97, true, '01:00:59;00', 109662], // measured
  [29.97, true, '01:01:00;02', 109692],
  [59.94, true, '00:01:00;04', 3600],
  [59.94, true, '00:10:00;00', 35964],
  [23.976, false, '01:00:00:00', 86400],
  [24, false, '01:00:00:00', 86400],
  [25, false, '01:00:00:00', 90000],
  [29.97, false, '01:00:00:00', 108000], // measured
  [30, false, '01:00:00:00', 108000],
];

test('known labels parse to their counts and format back', () => {
  for (const [fps, df, label, count] of KNOWN) {
    const base = timecodeBase(fps);
    assert.equal(value(parseTimecode(label, base, df)), count, `${fps} ${df ? 'DF' : 'NDF'} parse ${label}`);
    assert.equal(value(formatTimecode(count, base, df)), label, `${fps} ${df ? 'DF' : 'NDF'} format ${count}`);
  }
});

test('timecodeBase rounds to the nominal rate', () => {
  assert.deepEqual([23.976, 24, 25, 29.97, 47.952, 59.94, 119.88].map(timecodeBase), [24, 24, 25, 30, 48, 60, 120]);
});

test('drop-frame against an independent oracle: every label in order, skipped ones left out', () => {
  // Walk every label for two hours; the k-th label that drop-frame keeps must be count k.
  for (const base of [30, 60]) {
    const drop = base / 15;
    let k = 0;
    for (let hh = 0; hh < 2; hh++) {
      for (let mm = 0; mm < 60; mm++) {
        for (let ss = 0; ss < 60; ss++) {
          for (let ff = 0; ff < base; ff++) {
            if (ss === 0 && ff < drop && mm % 10 !== 0) continue;
            const label = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')};${String(ff).padStart(2, '0')}`;
            const f = formatTimecode(k, base, true);
            if (!f.ok || f.value !== label) assert.fail(`base ${base}: count ${k} formatted as ${JSON.stringify(f)}, expected ${label}`);
            const p = parseTimecode(label, base, true);
            if (!p.ok || p.value !== k) assert.fail(`base ${base}: ${label} parsed as ${JSON.stringify(p)}, expected ${k}`);
            k++;
          }
        }
      }
    }
    assert.equal(k, base === 30 ? 215784 : 431568, 'two drop-frame hours hold 2 x (30 x 3600 - 108) frames at base 30');
  }
});

test('labels drop-frame skips are refused, naming the next label', () => {
  assert.match(error(parseTimecode('00:01:00;00', 30, true)), /does not exist in drop-frame timecode; the next frame is 00:01:00;02$/);
  assert.match(error(parseTimecode('00:01:00;01', 30, true)), /the next frame is 00:01:00;02$/);
  assert.match(error(parseTimecode('01:01:00;00', 30, true)), /"01:01:00;00".*the next frame is 01:01:00;02$/);
  assert.match(error(parseTimecode('00:01:00;03', 60, true)), /the next frame is 00:01:00;04$/);
  assert.equal(value(parseTimecode('00:10:00;00', 30, true)), 17982, 'minutes divisible by ten keep every label');
  assert.equal(value(parseTimecode('00:01:00;00', 30, false)), 1800, 'non-drop-frame keeps every label');
});

test('malformed and out-of-range labels are refused', () => {
  assert.equal(error(parseTimecode('01:00:00:30', 30, false)), 'timecode "01:00:00:30" has frame 30; this timeline counts frames 00-29');
  assert.match(error(parseTimecode('00:60:00:00', 30, false)), /has minute 60; minutes run 00-59/);
  assert.match(error(parseTimecode('00:00:60:00', 30, false)), /has second 60; seconds run 00-59/);
  for (const bad of ['1:00:00:00', '01:00:00', '01:00:00:0', '01-00-00-00', ' 01:00:00:00', '01:00:00:00\n', '01;00;00;00', '']) {
    assert.match(error(parseTimecode(bad, 30, false)), /is not HH:MM:SS:FF$/, JSON.stringify(bad));
  }
  assert.match(error(parseTimecode('01:00:00;00', 24, true)), /drop-frame timecode exists only at 30 and 60/);
  assert.match(error(formatTimecode(0, 0, false)), /not usable/);
});

test("the separator is read in the timeline's mode, and the canonical spelling is the mode's own", () => {
  assert.equal(value(parseTimecode('01:01:00:02', 30, true)), 109692, '":" on a drop-frame timeline reads drop-frame');
  assert.equal(value(parseTimecode('01:00:00;00', 30, false)), 108000, '";" on a non-drop-frame timeline reads non-drop-frame');
  assert.equal(value(formatTimecode(108000, 30, false)), '01:00:00:00');
  assert.equal(value(formatTimecode(107892, 30, true)), '01:00:00;00', 'only the last separator is ";"');
});

test('hours are not wrapped at 24, and 100 hours is refused', () => {
  assert.equal(value(formatTimecode(2_073_600, 24, false)), '24:00:00:00');
  assert.equal(value(parseTimecode('24:00:00:00', 24, false)), 2_073_600);
  assert.match(error(formatTimecode(100 * 3600 * 24, 24, false)), /100 hours or more/);
  const last = value(parseTimecode('99:59:59;29', 30, true));
  assert.equal(value(formatTimecode(last, 30, true)), '99:59:59;29');
  assert.match(error(formatTimecode(last + 1, 30, true)), /100 hours or more/);
  assert.match(error(formatTimecode(-1, 30, false)), /not a whole, non-negative number/);
  assert.match(error(formatTimecode(1.5, 30, false)), /not a whole, non-negative number/);
});

test('rates above 100 frames per second spell frames with three digits', () => {
  assert.equal(value(formatTimecode(119, 120, false)), '00:00:00:119');
  assert.equal(value(parseTimecode('00:00:00:119', 120, false)), 119);
  assert.equal(value(parseTimecode('00:00:00:99', 120, false)), 99);
  assert.match(error(parseTimecode('00:00:00:120', 120, false)), /counts frames 000-119/);
});

test('usesDropFrame needs base 30 or 60 and the flag or a ";"', () => {
  assert.equal(usesDropFrame(29.97, '1', '01:00:00;00'), true);
  assert.equal(usesDropFrame(29.97, '1', '01:00:00:00'), true);
  assert.equal(usesDropFrame(29.97, '0', '01:00:00;00'), true);
  assert.equal(usesDropFrame(59.94, 1, '00:00:00:00'), true);
  assert.equal(usesDropFrame(29.97, '0', '01:00:00:00'), false);
  assert.equal(usesDropFrame(29.97, undefined, '01:00:00:00'), false);
  assert.equal(usesDropFrame(23.976, '1', '01:00:00;00'), false);
  assert.equal(usesDropFrame(25, '1', '01:00:00;00'), false);
});

function anchor(input: { startFrame: unknown; startTimecode: unknown; fps: unknown; dropFlag: unknown }): Anchor {
  return value(makeAnchor(input));
}

test('anchors convert frames and labels as Resolve does (measured pairs)', () => {
  const ndf = anchor({ startFrame: 108000, startTimecode: '01:00:00:00', fps: 29.97, dropFlag: '0' });
  assert.deepEqual(ndf, { startFrame: 108000, startTimecode: '01:00:00:00', base: 30, dropFrame: false, startCount: 108000 });
  assert.equal(value(frameToTimecode(ndf, 108248)), '01:00:08:08');
  assert.deepEqual(value(timecodeToFrame(ndf, '01:00:08:08')), { frame: 108248, timecode: '01:00:08:08' });
  assert.deepEqual(value(timecodeToFrame(ndf, '01:00:08;08')), { frame: 108248, timecode: '01:00:08:08' }, 'canonical spelling');

  const df = anchor({ startFrame: 109662, startTimecode: '01:00:59;00', fps: 29.97, dropFlag: '1' });
  assert.equal(df.dropFrame, true);
  assert.equal(value(frameToTimecode(df, 109692)), '01:01:00;02');
  assert.deepEqual(value(timecodeToFrame(df, '01:01:00:02')), { frame: 109692, timecode: '01:01:00;02' });
  assert.match(error(timecodeToFrame(df, '01:01:00;00')), /the next frame is 01:01:00;02/);
});

test('anchors whose start frame is not the start count', () => {
  const odd = anchor({ startFrame: 5, startTimecode: '00:00:10:00', fps: 25, dropFlag: '0' });
  assert.equal(odd.startCount, 250);
  assert.equal(value(frameToTimecode(odd, 30)), '00:00:11:00');
  assert.equal(value(frameToTimecode(odd, 4)), '00:00:09:24');
  assert.deepEqual(value(timecodeToFrame(odd, '00:00:11:00')), { frame: 30, timecode: '00:00:11:00' });
  assert.match(error(frameToTimecode(odd, -246)), /frame -246 would come before timecode 00:00:00:00/);
  assert.equal(value(frameToTimecode(odd, -245)), '00:00:00:00');
});

test('makeAnchor reads the frame rate as a number or a string and refuses what it cannot read', () => {
  const base = { startFrame: 108000, startTimecode: '01:00:00:00', dropFlag: '0' };
  assert.deepEqual(anchor({ ...base, fps: '29.97' }), anchor({ ...base, fps: 29.97 }));
  const dfSuffix = anchor({ ...base, fps: '29.97 DF' });
  assert.equal(dfSuffix.dropFrame, true, 'the "29.97 DF" spelling Resolve takes on SetSettings');
  assert.equal(dfSuffix.startCount, 107892);
  assert.equal(error(makeAnchor({ ...base, fps: 'abc' })), 'the timeline frame rate "abc" is not a number');
  assert.match(error(makeAnchor({ ...base, fps: 0 })), /frame rate "0" is not a number/);
  assert.match(error(makeAnchor({ ...base, fps: undefined })), /frame rate "undefined" is not a number/);
  assert.match(error(makeAnchor({ ...base, fps: 29.97, startFrame: 1.5 })), /start frame "1.5" is not a whole number/);
  assert.match(error(makeAnchor({ ...base, fps: 29.97, startFrame: '108000' })), /start frame "108000" is not a whole number/);
  assert.match(error(makeAnchor({ ...base, fps: 29.97, startTimecode: null })), /start timecode "null" is not a string/);
  assert.equal(
    error(makeAnchor({ ...base, fps: 29.97, startTimecode: '1:00:00:00' })),
    'the timeline start timecode "1:00:00:00" cannot be read: timecode "1:00:00:00" is not HH:MM:SS:FF',
  );
});
