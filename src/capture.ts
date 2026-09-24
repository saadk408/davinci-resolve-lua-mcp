// capture_frame's Node side: the target schema, the check of chunk A's reply, the expansion of
// targets into frames, the capture file names and their cleanup, and the BMP-to-JPEG step. The
// Lua lives in lua.ts, the timecode arithmetic in timecode.ts, the pixels in image.ts; server.ts
// wires them into the tool.
//
// Frames here are absolute timeline frames (GetStartFrame() + offset), the scale get_timeline_items
// reports; marker keys and add_marker count from the timeline start (the offset).
import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as z from 'zod/v4';
import { fitJpeg, ImageError, parseBmp, type FitResult, type Rgba } from './image.js';
import { MARKER_COLORS, type MarkerQuery } from './lua.js';
import { retryTransient } from './protocol.js';
import { frameToTimecode, TIMECODE_RE, timecodeToFrame, type Anchor } from './timecode.js';

export const MAX_FRAMES = 8;
export const MAX_SKIPPED_LISTED = 32;
/** Marker entries chunk A returns across all sets: no more can appear in a result (8 + 32). */
export const MARKER_BUDGET = MAX_FRAMES + MAX_SKIPPED_LISTED;
export const BMP_MAX_BYTES = 256 * 1024 * 1024;
export const STALE_CAPTURE_MS = 10 * 60 * 1000;
/** JPEG bytes across all frames: about 800 K base64 characters, under Claude Desktop's ~1 MB result limit. */
export const TOTAL_JPEG_BUDGET = 600_000;
/** Per frame: under the 512,000 bytes above which Claude Code recompresses an image. */
export const PER_FRAME_JPEG_MAX = 500_000;

const itemId = z.string().min(1).max(200).describe('unique_id of a video item, from get_timeline_items.');

export const targetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('playhead') }).describe('The frame under the playhead when the call starts.'),
  z
    .object({
      type: z.literal('frame'),
      frame: z
        .int()
        .min(0)
        .max(1_000_000_000)
        .describe('Absolute timeline frame, as get_timeline_items and get_project_info report it (not the frame relative to the timeline start that add_marker takes).'),
    })
    .describe('One frame by number.'),
  z
    .object({
      type: z.literal('timecode'),
      timecode: z
        .string()
        .regex(TIMECODE_RE)
        .describe("HH:MM:SS:FF, or HH:MM:SS;FF for drop-frame; read in the timeline's own drop-frame mode whatever the separator. A label that drop-frame skips is refused."),
    })
    .describe('One frame by timecode.'),
  z
    .object({
      type: z.literal('markers'),
      color: z.enum(MARKER_COLORS).optional().describe('Only markers of this colour.'),
      contains: z.string().min(1).max(200).optional().describe('Only markers whose name contains this text (ASCII letters in any case; other characters exactly).'),
    })
    .describe('The first frame of every timeline marker that matches both filters (every marker when both are omitted), in frame order, labelled with the marker name.'),
  z
    .object({
      type: z.literal('item'),
      item_id: itemId,
      at: z.enum(['first', 'middle', 'last']).default('middle').describe('Which frame of the item: first, middle (default) or last.'),
    })
    .describe('One frame of a timeline item.'),
  z
    .object({
      type: z.literal('cut'),
      item_id: itemId,
      edge: z.enum(['in', 'out']).default('in').describe("in (default): the frame before the item and its first frame; out: the item's last frame and the frame after it."),
    })
    .describe('The two frames either side of one edit point of a timeline item.'),
]);
export type CaptureTarget = z.infer<typeof targetSchema>;

export interface CaptureMarker {
  /** The GetMarkers() key: frames from the timeline start. */
  offset: number;
  color: string;
  name: string;
}
export interface MarkerSet {
  markers: CaptureMarker[];
  /** Every marker the query matched, including those the shared budget left out. */
  total: number;
}
export interface CaptureItem {
  id: string;
  name: string;
  start: number;
  end: number;
  track: number;
}
/** Chunk A's reply, checked, with every list read as a list. */
export interface CaptureInfo {
  timeline: { name: string; unique_id: string; start_frame: number; end_frame: number; start_timecode: string };
  frame_rate: unknown;
  drop_frame: unknown;
  marker_sets: MarkerSet[];
  items: CaptureItem[];
  missing_items: string[];
}

export interface Shot {
  /** Absolute timeline frame; null for the playhead, known only after chunk B. */
  frame: number | null;
  /** Canonical spelling; "" for the playhead. */
  timecode: string;
  /** One per target that landed here, merged when several did. */
  labels: string[];
  targets: CaptureTarget[];
}
export interface Failure {
  label: string;
  targets: CaptureTarget[];
  frame?: number;
  timecode?: string;
  error: string;
}
export interface Skipped {
  label: string;
  /** null for a playhead shot. */
  frame: number | null;
  timecode: string | null;
}
export interface Expansion {
  shots: Shot[];
  failed: Failure[];
  skipped: Skipped[];
  skippedTotal: number;
}

// Local copies of server.ts's helpers: importing server.ts from here would make a cycle.
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function asList(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

/** One query per `markers` target, in target order: chunk A returns one set for each. */
export function markerQueriesOf(targets: readonly CaptureTarget[]): MarkerQuery[] {
  const out: MarkerQuery[] = [];
  for (const t of targets) if (t.type === 'markers') out.push({ color: t.color, contains: t.contains });
  return out;
}

/** The item ids the `item` and `cut` targets name, once each, in order. */
export function itemIdsOf(targets: readonly CaptureTarget[]): string[] {
  const ids: string[] = [];
  for (const t of targets) if ((t.type === 'item' || t.type === 'cut') && !ids.includes(t.item_id)) ids.push(t.item_id);
  return ids;
}

/** Chunk A's reply as CaptureInfo, or what is wrong with it. */
export function parseCaptureInfo(data: Record<string, unknown>, queryCount: number): CaptureInfo | string {
  const tl = data['timeline'];
  if (!isRecord(tl)) return 'no timeline record';
  const { name, unique_id, start_frame, end_frame, start_timecode } = tl;
  if (typeof name !== 'string' || typeof unique_id !== 'string' || typeof start_timecode !== 'string') {
    return 'the timeline name, unique id or start timecode is not a string';
  }
  if (typeof start_frame !== 'number' || !Number.isInteger(start_frame) || typeof end_frame !== 'number' || !Number.isInteger(end_frame)) {
    return 'the timeline start or end frame is not a whole number';
  }
  const sets = asList(data['marker_sets']);
  if (sets.length !== queryCount) return `${sets.length} marker sets for ${queryCount} markers targets`;
  const markerSets: MarkerSet[] = [];
  for (const s of sets) {
    if (!isRecord(s) || typeof s['total'] !== 'number') return 'a marker set has no total';
    const markers: CaptureMarker[] = [];
    for (const m of asList(s['markers'])) {
      if (!isRecord(m) || typeof m['offset'] !== 'number' || !Number.isInteger(m['offset'])) return 'a marker has no whole-number offset';
      markers.push({ offset: m['offset'], color: typeof m['color'] === 'string' ? m['color'] : '', name: typeof m['name'] === 'string' ? m['name'] : '' });
    }
    markerSets.push({ markers, total: s['total'] });
  }
  const items: CaptureItem[] = [];
  for (const it of asList(data['items'])) {
    if (!isRecord(it) || typeof it['id'] !== 'string' || typeof it['start'] !== 'number' || typeof it['end'] !== 'number') {
      return 'an item has no id, start or end';
    }
    items.push({ id: it['id'], name: typeof it['name'] === 'string' ? it['name'] : '', start: it['start'], end: it['end'], track: typeof it['track'] === 'number' ? it['track'] : 0 });
  }
  const missing = asList(data['missing_items']);
  if (!missing.every((id): id is string => typeof id === 'string')) return 'a missing item id is not a string';
  return {
    timeline: { name, unique_id, start_frame, end_frame, start_timecode },
    frame_rate: data['frame_rate'],
    drop_frame: data['drop_frame'],
    marker_sets: markerSets,
    items,
    missing_items: missing,
  };
}

export interface RunShot {
  ok: boolean;
  timecode?: string;
  readback?: string;
  error?: string;
}
/** Chunk B's reply, checked. */
export interface CaptureRun {
  page: { was: string | null; switched: boolean; restored: boolean };
  /**
   * was: the position to restore (read on the original page), null when unreadable; now: where
   * the playhead is when it was not restored (Resolve cannot seek to the end of the timeline).
   */
  playhead: { was: string | null; restored: boolean; now: string | null };
  /** One record per shot, in shot order. */
  shots: RunShot[];
}

/** Chunk B's reply as CaptureRun, or what is wrong with it. */
export function parseCaptureRun(data: Record<string, unknown>, shotCount: number): CaptureRun | string {
  const page = data['page'];
  const playhead = data['playhead'];
  if (!isRecord(page) || !isRecord(playhead)) return 'no page or playhead record';
  const shots = asList(data['shots']);
  if (shots.length !== shotCount) return `${shots.length} shot records for ${shotCount} shots`;
  const out: RunShot[] = [];
  for (const s of shots) {
    if (!isRecord(s) || typeof s['ok'] !== 'boolean') return 'a shot record has no ok flag';
    const { ok, timecode, readback, error } = s;
    out.push({
      ok,
      ...(typeof timecode === 'string' ? { timecode } : {}),
      ...(typeof readback === 'string' ? { readback } : {}),
      ...(typeof error === 'string' ? { error } : {}),
    });
  }
  return {
    page: { was: typeof page['was'] === 'string' ? page['was'] : null, switched: page['switched'] === true, restored: page['restored'] === true },
    playhead: {
      was: typeof playhead['was'] === 'string' ? playhead['was'] : null,
      restored: playhead['restored'] === true,
      now: typeof playhead['now'] === 'string' ? playhead['now'] : null,
    },
    shots: out,
  };
}

function markersLabel(t: { color?: string | undefined; contains?: string | undefined }): string {
  const parts = [t.color, t.contains === undefined ? undefined : JSON.stringify(t.contains)].filter((p) => p !== undefined);
  return `markers (${parts.length ? parts.join(', ') : 'all'})`;
}

/**
 * The shots to capture, in target order: numbered frames range-checked against the timeline and
 * de-duplicated (the first position wins, labels and targets merge), one playhead shot at most,
 * the first MAX_FRAMES kept and the rest counted in skipped (MAX_SKIPPED_LISTED listed).
 */
export function expandTargets(targets: readonly CaptureTarget[], info: CaptureInfo, anchor: Anchor): Expansion {
  const { start_frame: first, end_frame: end } = info.timeline;
  const failed: Failure[] = [];
  const ordered: Shot[] = [];
  const byFrame = new Map<number, Shot>();
  let playhead: Shot | undefined;
  let unlisted = 0;
  let markersSeen = 0;

  const merge = (shot: Shot, label: string, target: CaptureTarget): void => {
    if (!shot.labels.includes(label)) shot.labels.push(label);
    if (!shot.targets.includes(target)) shot.targets.push(target);
  };
  const addFrame = (frame: number, label: string, target: CaptureTarget): void => {
    if (frame < first || frame >= end) {
      failed.push({ label, targets: [target], frame, error: `frame ${frame} is outside the timeline (${first}-${end - 1})` });
      return;
    }
    const existing = byFrame.get(frame);
    if (existing) return merge(existing, label, target);
    const tc = frameToTimecode(anchor, frame);
    if (!tc.ok) {
      failed.push({ label, targets: [target], frame, error: tc.error });
      return;
    }
    const shot: Shot = { frame, timecode: tc.value, labels: [label], targets: [target] };
    byFrame.set(frame, shot);
    ordered.push(shot);
  };

  for (const target of targets) {
    switch (target.type) {
      case 'playhead':
        if (playhead) merge(playhead, 'playhead', target);
        else {
          playhead = { frame: null, timecode: '', labels: ['playhead'], targets: [target] };
          ordered.push(playhead);
        }
        break;
      case 'frame':
        addFrame(target.frame, `frame ${target.frame}`, target);
        break;
      case 'timecode': {
        const r = timecodeToFrame(anchor, target.timecode);
        if (r.ok) addFrame(r.value.frame, `timecode ${r.value.timecode}`, target);
        else failed.push({ label: `timecode ${target.timecode}`, targets: [target], error: r.error });
        break;
      }
      case 'markers': {
        const set = info.marker_sets[markersSeen++];
        if (!set || set.total === 0) {
          failed.push({ label: markersLabel(target), targets: [target], error: 'no marker matches' });
          break;
        }
        for (const m of set.markers) {
          addFrame(first + m.offset, m.name ? `marker "${m.name}" (${m.color})` : `marker at offset ${m.offset} (${m.color})`, target);
        }
        unlisted += set.total - set.markers.length;
        break;
      }
      case 'item':
      case 'cut': {
        const it = info.items.find((i) => i.id === target.item_id);
        if (!it) {
          failed.push({ label: `item ${JSON.stringify(target.item_id)}`, targets: [target], error: 'no video item with this id on the current timeline' });
          break;
        }
        const start = Math.ceil(it.start);
        const stop = Math.ceil(it.end); // exclusive, like GetEnd()
        if (target.type === 'cut') {
          if (target.edge === 'in') {
            addFrame(start - 1, `before the cut into "${it.name}"`, target);
            addFrame(start, `after the cut into "${it.name}"`, target);
          } else {
            addFrame(stop - 1, `before the cut out of "${it.name}"`, target);
            addFrame(stop, `after the cut out of "${it.name}"`, target);
          }
          break;
        }
        const last = stop - 1;
        if (last < start) {
          failed.push({ label: `${target.at} frame of item "${it.name}"`, targets: [target], error: `item "${it.name}" has no whole frame (${it.start}-${it.end})` });
          break;
        }
        const frame = target.at === 'first' ? start : target.at === 'last' ? last : Math.floor((start + last) / 2);
        addFrame(frame, `${target.at} frame of item "${it.name}"`, target);
        break;
      }
    }
  }

  const rest = ordered.slice(MAX_FRAMES);
  return {
    shots: ordered.slice(0, MAX_FRAMES),
    failed,
    skipped: rest.slice(0, MAX_SKIPPED_LISTED).map((s) => ({ label: s.labels.join('; '), frame: s.frame, timecode: s.frame === null ? null : s.timecode })),
    skippedTotal: rest.length + unlisted,
  };
}

/** A fresh id for one call's capture files. */
export function newCallId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Where Resolve writes shot `index` of a call: the state dir, joined with "/" (it is already
 * forward-slashed on Windows, src/config.ts) because the path goes to Lua as it is.
 */
export function captureFileName(stateDir: string, pid: number, callId: string, index: number): string {
  return `${stateDir}/capture-${pid}-${callId}-${index}.bmp`;
}

const CAPTURE_FILE_RE = /^capture-(\d+)-[0-9a-f]{8}-\d+\.bmp$/;

/**
 * Deletes capture files a call left behind: those of a server that is gone, and any older than
 * STALE_CAPTURE_MS. Files of a live server (the Claude Desktop extension and a Claude Code entry
 * share the state dir), this one's included, are left alone while fresh; nothing else is touched.
 */
export async function removeStaleCaptures(
  stateDir: string,
  opts: { now: number; ownPid: number; isPidAlive: (pid: number) => boolean },
): Promise<number> {
  let names: string[];
  try {
    names = await fsp.readdir(stateDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const m = CAPTURE_FILE_RE.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    const file = `${stateDir}/${name}`;
    try {
      const st = await fsp.stat(file);
      const stale = opts.now - st.mtimeMs > STALE_CAPTURE_MS || (pid !== opts.ownPid && !opts.isPidAlive(pid));
      if (!stale) continue;
      await retryTransient(() => fsp.unlink(file));
      removed++;
    } catch {
      // Another server may have removed it first.
    }
  }
  return removed;
}

/** Deletes a capture file, retrying Windows sharing violations; a file already gone is fine. */
export async function removeCapture(file: string): Promise<void> {
  try {
    await retryTransient(() => fsp.unlink(file));
  } catch {
    // ENOENT, or a file the stale sweep of a later call will remove.
  }
}

/**
 * The JPEG of each captured BMP, one frame at a time with a yield in between (the encoder is
 * synchronous), within a per-frame byte cap that shares TOTAL_JPEG_BUDGET among the frames. A null
 * path (a shot chunk B did not capture) gives a placeholder. Every BMP is deleted once read.
 */
export async function encodeShots(
  paths: ReadonlyArray<string | null>,
  maxEdge: number,
  encode?: (img: Rgba, quality: number) => Buffer,
): Promise<Array<FitResult | { error: string }>> {
  const n = paths.filter((p) => p !== null).length;
  const capBytes = Math.min(PER_FRAME_JPEG_MAX, Math.floor(TOTAL_JPEG_BUDGET / Math.max(1, n)));
  const minEdge = Math.min(320, maxEdge);
  const out: Array<FitResult | { error: string }> = [];
  for (const file of paths) {
    if (file === null) {
      out.push({ error: 'not captured' });
      continue;
    }
    try {
      const st = await fsp.stat(file);
      if (st.size > BMP_MAX_BYTES) throw new ImageError(`the exported BMP is ${st.size} bytes, over the ${BMP_MAX_BYTES}-byte limit`);
      const bmp = parseBmp(await fsp.readFile(file));
      out.push(fitJpeg(bmp, { maxEdge, capBytes, minEdge }, encode));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      out.push({
        error:
          err instanceof ImageError
            ? err.message
            : code === 'ENOENT'
              ? 'Resolve reported the export, but the file is not there'
              : `the exported frame could not be read: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      await removeCapture(file);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return out;
}
