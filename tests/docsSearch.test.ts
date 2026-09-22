import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { DocsIndex, indexPyi, indexReadme, tokenize } from '../src/docsSearch.js';
import { makeTempDirs } from './helpers/tmp.js';

// Excerpts in the exact shape of the shipped files (tab-indented methods, single-line docstrings).
const PYI = `''' Type stubs for DaVinciResolveScript, the DaVinci Resolve Python scripting API. '''

from typing import TypedDict, Literal, TypeAlias

MarkerColor = Literal['Blue', 'Cyan', 'Green']
TrackType = Literal['video', 'audio', 'subtitle']

KeyframeMode: TypeAlias = float
"""One of the resolve.* constants: KEYFRAME_MODE_ALL, KEYFRAME_MODE_COLOR"""

class MarkerInfo(TypedDict, total=False):
\tcolor: MarkerColor
\t"""Color name, e.g. 'Blue', 'Green'"""
\tduration: int
\t"""Duration in frames, e.g. 1"""

MarkInOutRange = TypedDict('MarkInOutRange', {
\t'in': int,  # Record frame relative to timeline start, e.g. 10
\t'out': int,  # Record frame relative to timeline start, e.g. 320
}, total=False)

class Project:
\t"""A project."""
\tdef GetName(self) -> str:
\t\t"""Returns project name"""
\t\t...
\tdef StopRendering(self):
\t\t"""Stops any current render processes"""
\t\t...

class Timeline:
\t"""A timeline: tracks, items, markers and export."""
\tdef GetName(self) -> str:
\t\t"""Returns the timeline name."""
\t\t...
\tdef AddMarker(self, frameId: int, color: MarkerColor, name: str, note: str, duration: int, customData: str | None = None) -> bool:
\t\t"""Creates a new marker at given frameId position."""
\t\t...
\tdef GetMarkers(self) -> dict[int, MarkerInfo]:
\t\t"""Returns a dict (frameId -> {information}) of all markers."""
\t\t...

def scriptapp(app: str) -> Resolve: ...
`;

const README = `# DaVinci Resolve Scripting API

## Overview

Some prose.

\`\`\`python
# Obtain a resolve instance if not already initialized in context.
resolve = app.GetResolve()
\`\`\`

## List and Dict Data Structures

Lists are denoted by \`[ ... ]\` and dicts are denoted by \`{ ... }\` above.

## Deprecated Resolve API Functions

\`\`\`text
Timeline
GetItemsInTrack(trackType, index)               --> {items...}         # Returns a dict of Timeline items.
\`\`\`

### Deprecated Calling Conventions

\`\`\`text
GetClipProperty(propertyName)                   --> string             # Returns the property value for the key 'propertyName'.
Project.GetSetting(settingName)                 --> string             # Returns value of project setting.
\`\`\`

## Unsupported Resolve API Functions

\`\`\`text
StartRendering(index1, index2, ...)             --> Bool               # Please use unique job ids (string) instead of indices.
\`\`\`
`;

const CHANGELOG = `# DaVinci Resolve Scripting API Changelog

## 21.1

Added:

- Transition API - TimelineItem.AddTransition.

## 21.0.4

Added:

- Timeline.GetSelectedClips
`;

test('indexPyi tags methods with class, line, signature and docstring', () => {
  const entries = indexPyi(PYI, 'DaVinciResolveScript.pyi');
  const add = entries.find((e) => e.kind === 'method' && e.name === 'AddMarker');
  assert.ok(add);
  assert.equal(add.class, 'Timeline');
  assert.equal(add.line, 36);
  assert.equal(add.signature, 'Timeline.AddMarker(frameId: int, color: MarkerColor, name: str, note: str, duration: int, customData: str | None = None) -> bool');
  assert.equal(add.text, 'Creates a new marker at given frameId position.');
  const stop = entries.find((e) => e.name === 'StopRendering');
  assert.equal(stop?.signature, 'Project.StopRendering()');
  assert.equal(entries.filter((e) => e.kind === 'method' && e.name === 'GetName').length, 2);
  const dict = entries.find((e) => e.kind === 'typeddict' && e.name === 'MarkerInfo');
  assert.match(dict?.text ?? '', /color: MarkerColor \(Color name/);
  const fdict = entries.find((e) => e.kind === 'typeddict' && e.name === 'MarkInOutRange');
  assert.match(fdict?.text ?? '', /'in': int \(Record frame/);
  const alias = entries.find((e) => e.kind === 'alias' && e.name === 'MarkerColor');
  assert.equal(alias?.text, "Literal['Blue', 'Cyan', 'Green']");
  const kf = entries.find((e) => e.kind === 'alias' && e.name === 'KeyframeMode');
  assert.match(kf?.text ?? '', /KEYFRAME_MODE_ALL/);
  assert.equal(entries.find((e) => e.name === 'scriptapp'), undefined, 'module-level functions are not methods');
});

test('indexReadme splits deprecated and unsupported sections per function and ignores fenced headings', () => {
  const entries = indexReadme(README, 'README.md');
  assert.equal(entries.find((e) => e.name.startsWith('Obtain a resolve')), undefined);
  const items = entries.find((e) => e.kind === 'deprecated' && e.name === 'GetItemsInTrack');
  assert.ok(items);
  assert.equal(items.class, 'Timeline');
  assert.equal(items.tag, 'deprecated');
  assert.equal(items.line, 20);
  const setting = entries.find((e) => e.kind === 'deprecated' && e.name === 'GetSetting');
  assert.equal(setting?.class, 'Project');
  const start = entries.find((e) => e.kind === 'unsupported' && e.name === 'StartRendering');
  assert.equal(start?.tag, 'unsupported');
  const listDict = entries.find((e) => e.kind === 'section' && e.name === 'List and Dict Data Structures');
  assert.match(listDict?.text ?? '', /Lists are denoted/);
});

test('tokenize splits camelCase and punctuation', () => {
  assert.deepEqual(tokenize('AddMarker'), ['add', 'marker', 'addmarker']);
  assert.deepEqual(tokenize('render job status'), ['render', 'job', 'status']);
});

test('DocsIndex.search ranks exact method names first, tags deprecated hits and respects limit', async () => {
  const dirs = await makeTempDirs();
  try {
    await fsp.writeFile(path.join(dirs.docsDir, 'DaVinciResolveScript.pyi'), PYI);
    await fsp.writeFile(path.join(dirs.docsDir, 'README.md'), README);
    await fsp.writeFile(path.join(dirs.docsDir, 'CHANGELOG.md'), CHANGELOG);
    const index = new DocsIndex(dirs.docsDir);
    const r = await index.search('AddMarker', 5);
    assert.ok(r.ok);
    assert.equal(r.results[0]?.name, 'AddMarker');
    assert.equal(r.results[0]?.class, 'Timeline');
    assert.equal(r.results[0]?.line, 36);
    assert.ok(r.total_matches >= 2);

    const dep = await index.search('GetItemsInTrack', 3);
    assert.ok(dep.ok);
    assert.equal(dep.results[0]?.tag, 'deprecated');
    assert.equal(dep.results[0]?.file, 'README.md');

    const two = await index.search('name', 2);
    assert.ok(two.ok);
    assert.equal(two.results.length, 2);
    assert.ok(two.total_matches > 2);

    const change = await index.search('AddTransition', 3);
    assert.ok(change.ok);
    assert.equal(change.results[0]?.kind, 'changelog');
    assert.equal(change.results[0]?.name, 'Changelog 21.1');

    const none = await index.search('zzzz-nothing', 3);
    assert.ok(none.ok);
    assert.equal(none.total_matches, 0);
  } finally {
    await dirs.cleanup();
  }
});

test('a missing docs folder is a message, not a crash', async () => {
  const index = new DocsIndex('/nonexistent/Scripting');
  const r = await index.search('AddMarker', 5);
  assert.ok(!r.ok);
  assert.match(r.error, /Blackmagic scripting docs not found at \/nonexistent\/Scripting/);
  assert.match(r.error, /RLB_DOCS_DIR/);
});

test('CRLF copies of the shipped files index exactly like LF ones', () => {
  const crlf = (s: string): string => s.replace(/\n/g, '\r\n');
  assert.deepEqual(indexPyi(crlf(PYI), 'f.pyi'), indexPyi(PYI, 'f.pyi'));
  assert.deepEqual(indexReadme(crlf(README), 'README.md'), indexReadme(README, 'README.md'));
});
