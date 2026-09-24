// Timecode arithmetic for capture_frame: SMPTE labels to frame counts and back, non-drop-frame and
// drop-frame (29.97 and 59.94). Pure functions with no Resolve and no I/O; bad input comes back as
// `{ ok: false, error }` so capture.ts can report one bad target without failing the whole call.
//
// Terms: a label is `HH:MM:SS:FF` (non-drop-frame) or `HH:MM:SS;FF` (drop-frame); a count is the
// number of frames from label 00:00:00:00 to a label in that system; the base is the nominal
// frames per second (Math.round of the rate: 29.97 -> 30); drop-frame skips `base / 15` labels
// (FF 00-01 at 30, 00-03 at 60) at the start of every minute except minutes divisible by ten.
//
// Measured on Resolve 21.1 free (2026-09-24): GetStartFrame counts in the timeline's own system
// (NDF 01:00:00:00 = 108000, DF 01:00:00;00 = 107892); SetCurrentTimecode reads `:` and `;` alike
// in the timeline's mode and silently snaps a skipped drop-frame label forward, so refusing those
// labels is this module's job. Frames are never assumed equal to counts: conversions anchor on the
// timeline's start frame and start timecode.

export type TcResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Anchor {
  /** Timeline:GetStartFrame(). */
  startFrame: number;
  /** Timeline:GetStartTimecode(), as Resolve spells it. */
  startTimecode: string;
  base: number;
  dropFrame: boolean;
  /** The count of startTimecode. */
  startCount: number;
}

export const TIMECODE_RE = /^(\d{2}):(\d{2}):(\d{2})[:;](\d{2,3})$/;

function ok<T>(value: T): TcResult<T> {
  return { ok: true, value };
}

function err<T>(error: string): TcResult<T> {
  return { ok: false, error };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function padFrames(n: number, base: number): string {
  return String(n).padStart(base > 100 ? 3 : 2, '0');
}

/** Why `base` and `dropFrame` cannot describe a timecode, or undefined when they can. */
function modeProblem(base: number, dropFrame: boolean): string | undefined {
  if (!Number.isInteger(base) || base < 1) return `a timecode base of ${base} frames per second is not usable`;
  if (dropFrame && base !== 30 && base !== 60) return `drop-frame timecode exists only at 30 and 60 frames per second, not ${base}`;
  return undefined;
}

/** Nominal frames per second of the timecode: 23.976 -> 24, 29.97 -> 30, 59.94 -> 60. */
export function timecodeBase(fps: number): number {
  return Math.round(fps);
}

/**
 * Whether the timeline counts in drop-frame: only at base 30 or 60, and when either the
 * `timelineDropFrameTimecode` setting is "1" or the start timecode uses `;` (measured: the one
 * drop-frame timeline had "1" and 01:00:00;00; non-drop-frame ones had "0" and colons).
 */
export function usesDropFrame(fps: number, flag: unknown, startTimecode: string): boolean {
  const base = timecodeBase(fps);
  if (base !== 30 && base !== 60) return false;
  return String(flag) === '1' || startTimecode.includes(';');
}

/** The count of label `tc`, read in the given mode whatever its last separator. */
export function parseTimecode(tc: string, base: number, dropFrame: boolean): TcResult<number> {
  const bad = modeProblem(base, dropFrame);
  if (bad) return err(bad);
  const m = TIMECODE_RE.exec(tc);
  if (!m) return err(`timecode ${JSON.stringify(tc)} is not HH:MM:SS:FF`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ff = Number(m[4]);
  if (mm > 59) return err(`timecode ${JSON.stringify(tc)} has minute ${mm}; minutes run 00-59`);
  if (ss > 59) return err(`timecode ${JSON.stringify(tc)} has second ${ss}; seconds run 00-59`);
  if (ff >= base) {
    return err(`timecode ${JSON.stringify(tc)} has frame ${ff}; this timeline counts frames ${padFrames(0, base)}-${padFrames(base - 1, base)}`);
  }
  const nominal = ((hh * 60 + mm) * 60 + ss) * base + ff;
  if (!dropFrame) return ok(nominal);
  const drop = base / 15;
  if (ss === 0 && ff < drop && mm % 10 !== 0) {
    const next = `${pad2(hh)}:${pad2(mm)}:00;${padFrames(drop, base)}`;
    return err(`timecode ${JSON.stringify(tc)} does not exist in drop-frame timecode; the next frame is ${next}`);
  }
  const minutes = hh * 60 + mm;
  return ok(nominal - drop * (minutes - Math.floor(minutes / 10)));
}

/**
 * The label of `count`, spelt as Resolve spells it: `HH:MM:SS:FF`, or `HH:MM:SS;FF` in drop-frame.
 * Hours are not wrapped at 24 (Resolve's behaviour there is unmeasured); 100 hours is an error.
 */
export function formatTimecode(count: number, base: number, dropFrame: boolean): TcResult<string> {
  const bad = modeProblem(base, dropFrame);
  if (bad) return err(bad);
  if (!Number.isInteger(count) || count < 0) return err(`${count} is not a whole, non-negative number of frames`);
  let label = count;
  if (dropFrame) {
    const drop = base / 15;
    const per10 = base * 600 - drop * 9; // frames in ten drop-frame minutes
    const perMin = base * 60 - drop; // frames in a minute that drops
    const tens = Math.floor(count / per10);
    const rest = count % per10;
    label = count + drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMin) : 0);
  }
  const hh = Math.floor(label / (base * 3600));
  if (hh >= 100) return err(`${count} frames is 100 hours or more, past the last timecode`);
  const mm = Math.floor(label / (base * 60)) % 60;
  const ss = Math.floor(label / base) % 60;
  const ff = label % base;
  return ok(`${pad2(hh)}:${pad2(mm)}:${pad2(ss)}${dropFrame ? ';' : ':'}${padFrames(ff, base)}`);
}

/** The anchor for a timeline, from what Resolve reports (types unchecked: they come from Lua). */
export function makeAnchor(input: { startFrame: unknown; startTimecode: unknown; fps: unknown; dropFlag: unknown }): TcResult<Anchor> {
  // timelineFrameRate is returned as a number but set as a string such as "29.97 DF" (README).
  const fps = parseFloat(String(input.fps));
  if (!Number.isFinite(fps) || fps <= 0) return err(`the timeline frame rate ${JSON.stringify(String(input.fps))} is not a number`);
  const { startFrame, startTimecode } = input;
  if (typeof startFrame !== 'number' || !Number.isInteger(startFrame)) {
    return err(`the timeline start frame ${JSON.stringify(String(startFrame))} is not a whole number`);
  }
  if (typeof startTimecode !== 'string') return err(`the timeline start timecode ${JSON.stringify(String(startTimecode))} is not a string`);
  const base = timecodeBase(fps);
  const dfFlag = /DF/i.test(String(input.fps)) ? '1' : input.dropFlag;
  const dropFrame = usesDropFrame(fps, dfFlag, startTimecode);
  const start = parseTimecode(startTimecode, base, dropFrame);
  if (!start.ok) return err(`the timeline start timecode ${JSON.stringify(startTimecode)} cannot be read: ${start.error}`);
  return ok({ startFrame, startTimecode, base, dropFrame, startCount: start.value });
}

/** The label of absolute timeline frame `frame`. */
export function frameToTimecode(anchor: Anchor, frame: number): TcResult<string> {
  const count = anchor.startCount + (frame - anchor.startFrame);
  if (count < 0) return err(`frame ${frame} would come before timecode 00:00:00:00`);
  const r = formatTimecode(count, anchor.base, anchor.dropFrame);
  return r.ok ? r : err(`frame ${frame} has no timecode: ${r.error}`);
}

/**
 * The absolute timeline frame of label `tc`, with the label's canonical spelling: the one chunk B
 * sends to SetCurrentTimecode and compares with GetCurrentTimecode.
 */
export function timecodeToFrame(anchor: Anchor, tc: string): TcResult<{ frame: number; timecode: string }> {
  const count = parseTimecode(tc, anchor.base, anchor.dropFrame);
  if (!count.ok) return count;
  const canonical = formatTimecode(count.value, anchor.base, anchor.dropFrame);
  if (!canonical.ok) return canonical;
  return ok({ frame: anchor.startFrame + (count.value - anchor.startCount), timecode: canonical.value });
}
