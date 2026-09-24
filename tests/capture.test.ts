import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  captureFileName,
  encodeShots,
  expandTargets,
  itemIdsOf,
  markerQueriesOf,
  newCallId,
  parseCaptureInfo,
  parseCaptureRun,
  removeStaleCaptures,
  STALE_CAPTURE_MS,
  targetSchema,
  type CaptureInfo,
  type CaptureTarget,
} from '../src/capture.js';
import type { FitResult, Rgba } from '../src/image.js';
import { makeAnchor, type Anchor } from '../src/timecode.js';
import { solid, writeBmp } from './helpers/bmp.js';
import { makeTempDirs } from './helpers/tmp.js';

/** Targets as the tool receives them: parsed, so the defaults (at, edge) are filled in. */
function targets(...raw: unknown[]): CaptureTarget[] {
  return raw.map((t) => targetSchema.parse(t));
}

function info(over: Partial<CaptureInfo> = {}): CaptureInfo {
  return {
    timeline: { name: 'Timeline 1', unique_id: 'tl-1', start_frame: 108000, end_frame: 108497, start_timecode: '01:00:00:00' },
    frame_rate: 29.97,
    drop_frame: '0',
    marker_sets: [],
    items: [],
    missing_items: [],
    ...over,
  };
}

function anchorOf(i: CaptureInfo): Anchor {
  const a = makeAnchor({ startFrame: i.timeline.start_frame, startTimecode: i.timeline.start_timecode, fps: i.frame_rate, dropFlag: i.drop_frame });
  assert.ok(a.ok);
  return a.value;
}

function expand(i: CaptureInfo, ...raw: unknown[]) {
  return expandTargets(targets(...raw), i, anchorOf(i));
}

test('markerQueriesOf and itemIdsOf follow target order; ids once each', () => {
  const t = targets(
    { type: 'item', item_id: 'b' },
    { type: 'markers', color: 'Red' },
    { type: 'cut', item_id: 'a' },
    { type: 'markers', contains: 'x' },
    { type: 'item', item_id: 'b', at: 'last' },
  );
  assert.deepEqual(markerQueriesOf(t), [
    { color: 'Red', contains: undefined },
    { color: undefined, contains: 'x' },
  ]);
  assert.deepEqual(itemIdsOf(t), ['b', 'a']);
});

test('the target schema fills defaults and refuses what cannot be captured', () => {
  assert.deepEqual(targetSchema.parse({ type: 'item', item_id: 'i' }), { type: 'item', item_id: 'i', at: 'middle' });
  assert.deepEqual(targetSchema.parse({ type: 'cut', item_id: 'i' }), { type: 'cut', item_id: 'i', edge: 'in' });
  for (const bad of [
    { type: 'timecode', timecode: '1:00:00:00' },
    { type: 'timecode', timecode: '01:00:00:00\n' },
    { type: 'frame', frame: -1 },
    { type: 'frame', frame: 1.5 },
    { type: 'markers', color: 'Magenta' },
    { type: 'markers', contains: '' },
    { type: 'item', item_id: '' },
    { type: 'item', item_id: 'x'.repeat(201) },
    { type: 'cut', item_id: 'i', edge: 'middle' },
    { type: 'everything' },
  ]) {
    assert.equal(targetSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test('parseCaptureInfo reads chunk A, empty Lua tables included, and names what is malformed', () => {
  const data = {
    timeline: { name: 'TL', unique_id: 'u', start_frame: 108000, end_frame: 108497, start_timecode: '01:00:00:00' },
    frame_rate: 29.97,
    drop_frame: '0',
    marker_sets: [{ markers: [{ offset: 10, frame: 108010, color: 'Blue', name: 'm' }], total: 1 }, { markers: {}, total: 0 }],
    items: [{ id: 'i1', name: 'Shot', start: 108000.5, end: 108100, track: 2 }],
    missing_items: {},
  };
  const parsed = parseCaptureInfo(data, 2);
  assert.ok(typeof parsed !== 'string', String(parsed));
  assert.deepEqual(parsed.marker_sets, [{ markers: [{ offset: 10, color: 'Blue', name: 'm' }], total: 1 }, { markers: [], total: 0 }]);
  assert.deepEqual(parsed.items, [{ id: 'i1', name: 'Shot', start: 108000.5, end: 108100, track: 2 }]);
  assert.deepEqual(parsed.missing_items, []);
  assert.deepEqual(parseCaptureInfo({ ...data, marker_sets: {} }, 0), { ...parsed, marker_sets: [] });

  const cases: Array<[Record<string, unknown>, number, RegExp]> = [
    [{}, 0, /no timeline record/],
    [{ ...data, timeline: { ...data.timeline, start_frame: 1.5 } }, 2, /not a whole number/],
    [{ ...data, timeline: { ...data.timeline, unique_id: 7 } }, 2, /not a string/],
    [data, 3, /2 marker sets for 3 markers targets/],
    [{ ...data, marker_sets: [{ markers: [{ name: 'x' }], total: 1 }, { markers: {}, total: 0 }] }, 2, /whole-number offset/],
    [{ ...data, marker_sets: [{ markers: [] }, { markers: [], total: 0 }] }, 2, /no total/],
    [{ ...data, items: [{ name: 'no id', start: 1, end: 2 }] }, 2, /no id, start or end/],
    [{ ...data, missing_items: [5] }, 2, /missing item id is not a string/],
  ];
  for (const [d, n, want] of cases) assert.match(String(parseCaptureInfo(d, n)), want);
});

test('parseCaptureRun reads chunk B and checks one record per shot', () => {
  const data = {
    page: { was: 'edit', switched: true, restored: true },
    playhead: { was: '01:00:02:00', restored: true },
    shots: [{ ok: true, timecode: '01:00:02:00' }, { ok: false, timecode: '01:00:03:00', readback: 'x', error: 'e' }],
  };
  assert.deepEqual(parseCaptureRun(data, 2), {
    page: { was: 'edit', switched: true, restored: true },
    playhead: { was: '01:00:02:00', restored: true },
    shots: [{ ok: true, timecode: '01:00:02:00' }, { ok: false, timecode: '01:00:03:00', readback: 'x', error: 'e' }],
  });
  const unread = parseCaptureRun({ ...data, playhead: { restored: false } }, 2);
  assert.ok(typeof unread !== 'string');
  assert.equal(unread.playhead.was, null, 'a nil playhead arrives absent and reads as null');
  assert.match(String(parseCaptureRun(data, 3)), /2 shot records for 3 shots/);
  assert.match(String(parseCaptureRun({ ...data, page: 'x' }, 2)), /no page or playhead/);
  assert.match(String(parseCaptureRun({ ...data, shots: [{ timecode: 'x' }, { ok: true }] }, 2)), /no ok flag/);
});

test('item and cut targets: first, middle and last frames, both sides of a cut, fractional edges rounded up', () => {
  const i = info({
    items: [
      { id: 'a', name: 'Shot A', start: 108000, end: 108100, track: 1 },
      { id: 'b', name: 'Shot B', start: 108100.4, end: 108200.2, track: 1 },
      { id: 'z', name: 'Empty', start: 108300.2, end: 108300.6, track: 2 },
    ],
  });
  const e = expand(
    i,
    { type: 'item', item_id: 'b', at: 'first' },
    { type: 'item', item_id: 'b' },
    { type: 'item', item_id: 'b', at: 'last' },
    { type: 'cut', item_id: 'b', edge: 'out' },
    { type: 'cut', item_id: 'a' },
    { type: 'item', item_id: 'z' },
  );
  // b covers 108101..108200 once rounded up (GetEnd is exclusive): middle = floor(108150.5).
  // The cut out of b lands on b's last frame, so the two merge; the cut into a starts the timeline.
  assert.deepEqual(
    e.shots.map((s) => [s.frame, s.timecode, s.labels]),
    [
      [108101, '01:00:03:11', ['first frame of item "Shot B"']],
      [108150, '01:00:05:00', ['middle frame of item "Shot B"']],
      [108200, '01:00:06:20', ['last frame of item "Shot B"', 'before the cut out of "Shot B"']],
      [108201, '01:00:06:21', ['after the cut out of "Shot B"']],
      [108000, '01:00:00:00', ['after the cut into "Shot A"']],
    ],
  );
  assert.equal(e.shots[2]!.targets.length, 2, 'the merged shot keeps both targets');
  assert.deepEqual(
    e.failed.map((f) => [f.label, f.frame, f.error]),
    [
      ['before the cut into "Shot A"', 107999, 'frame 107999 is outside the timeline (108000-108496)'],
      ['middle frame of item "Empty"', undefined, 'item "Empty" has no whole frame (108300.2-108300.6)'],
    ],
  );
  assert.deepEqual([e.skipped, e.skippedTotal], [[], 0]);
});

test('frames several targets land on are captured once; one playhead shot, never merged with a numbered frame', () => {
  const i = info({ items: [{ id: 'a', name: 'Shot A', start: 108000, end: 108100, track: 1 }] });
  const e = expand(
    i,
    { type: 'frame', frame: 108000 },
    { type: 'playhead' },
    { type: 'item', item_id: 'a', at: 'first' },
    { type: 'timecode', timecode: '01:00:00;00' },
    { type: 'playhead' },
  );
  assert.deepEqual(
    e.shots.map((s) => [s.frame, s.timecode, s.labels, s.targets.length]),
    [
      [108000, '01:00:00:00', ['frame 108000', 'first frame of item "Shot A"', 'timecode 01:00:00:00'], 3],
      [null, '', ['playhead'], 2],
    ],
  );
});

test('markers targets read their own sets in order; empty names and empty sets are labelled', () => {
  const i = info({
    marker_sets: [
      { markers: [{ offset: 20, color: 'Blue', name: 'Intro' }, { offset: 5, color: 'Blue', name: '' }], total: 2 },
      { markers: [], total: 0 },
      { markers: [{ offset: 20, color: 'Red', name: 'Also here' }], total: 4 },
    ],
  });
  const e = expand(i, { type: 'markers', color: 'Blue' }, { type: 'markers', color: 'Green', contains: 'x "y"' }, { type: 'markers' });
  assert.deepEqual(
    e.shots.map((s) => [s.frame, s.labels]),
    [
      [108020, ['marker "Intro" (Blue)', 'marker "Also here" (Red)']],
      [108005, ['marker at offset 5 (Blue)']],
    ],
  );
  assert.deepEqual(e.failed.map((f) => [f.label, f.error]), [['markers (Green, "x \\"y\\"")', 'no marker matches']]);
  assert.equal(e.skippedTotal, 3, 'the third set matched 4 and listed 1: 3 left out by the budget');
  assert.deepEqual(e.skipped, []);
});

test('past MAX_FRAMES the shots are skipped: 32 listed at most, all counted, a playhead with no frame', () => {
  const markers = Array.from({ length: 40 }, (_, k) => ({ offset: k * 10, color: 'Blue', name: `m${k}` }));
  const many = expand(info({ marker_sets: [{ markers, total: 60 }] }), { type: 'markers' });
  assert.equal(many.shots.length, 8);
  assert.equal(many.skipped.length, 32);
  assert.equal(many.skippedTotal, 32 + 20);
  assert.deepEqual(many.skipped[0], { label: 'marker "m8" (Blue)', frame: 108080, timecode: '01:00:02:20' });

  const eight = markers.slice(0, 8);
  const late = expand(info({ marker_sets: [{ markers: eight, total: 8 }] }), { type: 'markers' }, { type: 'playhead' });
  assert.equal(late.shots.length, 8);
  assert.deepEqual(late.skipped, [{ label: 'playhead', frame: null, timecode: null }]);
  assert.equal(late.skippedTotal, 1);
});

test('timecodes are read in the timeline mode: drop-frame labels, skipped labels refused, range checked', () => {
  const df = info({
    timeline: { name: 'DF', unique_id: 'df', start_frame: 107892, end_frame: 108392, start_timecode: '01:00:00;00' },
    drop_frame: '1',
  });
  const e = expand(
    df,
    { type: 'timecode', timecode: '01:00:10:00' },
    { type: 'timecode', timecode: '01:01:00;00' },
    { type: 'timecode', timecode: '02:00:00;00' },
    { type: 'frame', frame: 108391 },
    { type: 'frame', frame: 108392 },
  );
  assert.deepEqual(
    e.shots.map((s) => [s.frame, s.timecode, s.labels]),
    [
      [108192, '01:00:10;00', ['timecode 01:00:10;00']],
      [108391, '01:00:16;19', ['frame 108391']],
    ],
  );
  assert.deepEqual(
    e.failed.map((f) => f.error),
    [
      'timecode "01:01:00;00" does not exist in drop-frame timecode; the next frame is 01:01:00;02',
      'frame 215784 is outside the timeline (107892-108391)',
      'frame 108392 is outside the timeline (107892-108391)',
    ],
  );
});

test('capture file names: the state dir joined with "/", a pid, an 8-hex call id and an index', () => {
  const id = newCallId();
  assert.match(id, /^[0-9a-f]{8}$/);
  assert.notEqual(newCallId(), id);
  assert.equal(captureFileName('C:/Users/x/.davinci-resolve-lua-mcp', 4242, '0a1b2c3d', 3), 'C:/Users/x/.davinci-resolve-lua-mcp/capture-4242-0a1b2c3d-3.bmp');
});

test('removeStaleCaptures: a gone server and old files go; fresh files of live servers and this one, and other files, stay', async () => {
  const dirs = await makeTempDirs();
  try {
    const dir = dirs.stateDir;
    const now = Date.now();
    const names = {
      dead: 'capture-111-0a1b2c3d-1.bmp',
      live: 'capture-222-0a1b2c3d-1.bmp',
      liveOld: 'capture-222-0a1b2c3d-2.bmp',
      own: 'capture-333-0a1b2c3d-1.bmp',
      badId: 'capture-111-ZZZZZZZZ-1.bmp',
      jpg: 'capture-111-0a1b2c3d-1.jpg',
      other: 'server.log',
    };
    for (const n of Object.values(names)) await fsp.writeFile(path.join(dir, n), 'x');
    const old = (now - STALE_CAPTURE_MS - 60_000) / 1000;
    await fsp.utimes(path.join(dir, names.liveOld), old, old);
    const removed = await removeStaleCaptures(dir, { now, ownPid: 333, isPidAlive: (pid) => pid === 222 });
    assert.equal(removed, 2);
    const left = (await fsp.readdir(dir)).sort();
    assert.deepEqual(left, [names.badId, names.jpg, names.live, names.own, names.other].sort());
    assert.equal(await removeStaleCaptures(path.join(dir, 'missing'), { now, ownPid: 1, isPidAlive: () => false }), 0);
  } finally {
    await dirs.cleanup();
  }
});

test('encodeShots: shares the byte budget, reports each unusable file, and deletes every BMP', async () => {
  const dirs = await makeTempDirs();
  try {
    const dir = dirs.stateDir;
    const bmp = writeBmp(solid(800, 450, [9, 9, 9]));
    const file = (n: string) => path.join(dir, n);
    await fsp.writeFile(file('a.bmp'), bmp);
    await fsp.writeFile(file('b.bmp'), bmp);
    await fsp.writeFile(file('c.bmp'), bmp);
    await fsp.writeFile(file('bad.bmp'), Buffer.from('PNG, not BMP, and long enough to pass the length check of fifty-four bytes'));
    // One byte per pixel: 800x450 is 360,000 bytes.
    const encode = (img: Rgba) => Buffer.alloc(img.width * img.height);
    const r = await encodeShots([file('a.bmp'), null, file('bad.bmp'), file('missing.bmp'), file('b.bmp'), file('c.bmp')], 960, encode);
    // Five non-null paths: 600,000 / 5 = 120,000 bytes each, so each good frame is shrunk once.
    const good = [r[0], r[4], r[5]] as FitResult[];
    for (const g of good) {
      assert.equal(g.encodes, 2);
      assert.ok(g.jpeg.length <= 120_000, String(g.jpeg.length));
      assert.equal(g.overBudget, false);
    }
    assert.deepEqual(r[1], { error: 'not captured' });
    assert.deepEqual(r[2], { error: 'not a BMP file (magic "PN")' });
    assert.deepEqual(r[3], { error: 'Resolve reported the export, but the file is not there' });
    assert.deepEqual(await fsp.readdir(dir), [], 'every BMP deleted, the bad one included');

    await fsp.writeFile(file('one.bmp'), bmp);
    const [single] = await encodeShots([file('one.bmp')], 960, encode);
    assert.equal((single as FitResult).encodes, 1, 'one frame gets the per-frame maximum, 500,000 bytes');
  } finally {
    await dirs.cleanup();
  }
});
