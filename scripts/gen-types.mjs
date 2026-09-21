#!/usr/bin/env node
// gen-types.mjs: regenerates the API classes in types/resolve_host.d.lua (a lua-language-server
// ---@meta file) from Blackmagic's DaVinciResolveScript.pyi and the README's Deprecated and
// Unsupported sections. Developer tool, plain Node 20, no dependencies.
//
//   node scripts/gen-types.mjs            rewrite the block between the BEGIN/END markers
//   node scripts/gen-types.mjs --check    exit 1 if the block on disk differs (make lint-lua)
//   --docs=<dir>                          override the Blackmagic Developer/Scripting directory
//
// The .pyi is the signature reference for the Lua API too (README: "Please refer to the included
// DaVinciResolveScript.pyi"). Its shape (verified on the 31 Aug 2026 file): hard-tab indent, one
// line per def, a one-line docstring, no *args. Mapping: str->string, int->integer, float->number,
// bool->boolean, dict->table, list[T]->T[], dict[K, V]->table<K, V>, Literal[...]->"a"|"b",
// X | None -> optional. Python lists are Resolve "lists" (1-indexed tables carrying __flags).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_DOCS = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting";
const BEGIN = "-- BEGIN GENERATED (scripts/gen-types.mjs; do not edit by hand, run `make gen-types`)";
const END = "-- END GENERATED";
const HAND_WRITTEN = new Set(["Fusion"]); // declared by hand in the types file
const LUA_KEYWORDS = new Set(("and break do else elseif end false for function goto if in local nil not " +
  "or repeat return then true until while").split(" "));

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const docsArg = args.find((a) => a.startsWith("--docs="));
const docsDir = docsArg ? docsArg.slice("--docs=".length) : DEFAULT_DOCS;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const typesPath = join(root, "types", "resolve_host.d.lua");

function fail(msg) {
  process.stderr.write(`gen-types: ${msg}\n`);
  process.exit(1);
}

const pyiPath = join(docsDir, "DaVinciResolveScript.pyi");
const readmePath = join(docsDir, "README.md");
if (!existsSync(pyiPath)) fail(`Blackmagic scripting docs not found at ${pyiPath}`);
const pyi = readFileSync(pyiPath, "utf8").split("\n");
const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
const readmeDate = (readme.match(/\*Last Updated: ([^*]+)\*/) || [, "unknown date"])[1].trim();

// --- small parsers -----------------------------------------------------------------------------

// Split on a separator at bracket depth 0, outside quotes.
function splitTop(s, sep) {
  const out = [];
  let depth = 0, cur = "", quote = null;
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== "");
}

const PRIMITIVES = { str: "string", int: "integer", float: "number", bool: "boolean", dict: "table", Any: "any", None: "nil" };

function luaType(py) {
  py = py.trim();
  if (/^'[^']*'$/.test(py)) py = py.slice(1, -1); // forward reference
  const union = splitTop(py, "|");
  if (union.length > 1) return union.map(luaType).join("|");
  let m;
  if ((m = py.match(/^Literal\[(.*)\]$/))) {
    return splitTop(m[1], ",").map((v) => (v === "''" ? "string" : `"${v.slice(1, -1)}"`)).join("|");
  }
  if ((m = py.match(/^list\[(.*)\]$/))) {
    const inner = luaType(m[1]);
    return (inner.includes("|") ? `(${inner})` : inner) + "[]";
  }
  if ((m = py.match(/^dict\[(.*)\]$/))) {
    const [k, v] = splitTop(m[1], ",");
    return `table<${luaType(k)}, ${luaType(v)}>`;
  }
  if (PRIMITIVES[py]) return PRIMITIVES[py];
  if (/^\w+$/.test(py)) return py; // TypedDict, alias or API class name
  fail(`unmapped type: ${py}`);
}

// "X | None" -> { type: "X", optional: true }
function stripNone(py) {
  const parts = splitTop(py, "|");
  const optional = parts.includes("None");
  const rest = parts.filter((p) => p !== "None").join(" | ");
  return { type: rest === "" ? "nil" : rest, optional };
}

function luaName(name) {
  if (name === "CDL") return "cdl";
  return LUA_KEYWORDS.has(name) ? name + "_" : name;
}

function parseParams(sig) {
  const out = [];
  for (const raw of splitTop(sig, ",")) {
    if (raw === "self") continue;
    let m;
    if ((m = raw.match(/^(\w+)\s*:\s*(.+?)\s*=\s*(.+)$/))) {
      const { type } = stripNone(m[2]);
      out.push({ name: luaName(m[1]), type: luaType(type), optional: true });
    } else if ((m = raw.match(/^(\w+)\s*=\s*(.+)$/))) {
      const d = m[2];
      const type = d === "True" || d === "False" ? "boolean" : /^-?\d/.test(d) ? "number" : "any";
      out.push({ name: luaName(m[1]), type, optional: true });
    } else if ((m = raw.match(/^(\w+)\s*:\s*(.+)$/))) {
      const { type, optional } = stripNone(m[2]);
      out.push({ name: luaName(m[1]), type: luaType(type), optional });
    } else {
      fail(`unparsed parameter: ${raw}`);
    }
  }
  return out;
}

function luaReturn(py) {
  if (py === undefined) return null;
  const { type, optional } = stripNone(py);
  if (type === "nil") return null;
  const t = luaType(type);
  if (!optional) return t;
  return t.includes("|") ? `(${t})?` : `${t}?`;
}

function docLine(doc) {
  if (!doc) return [];
  const text = doc.replace(/\s+/g, " ").trim();
  return [`--- ${text.startsWith("@") ? " " + text : text}`];
}

function fieldKey(name) {
  if (/^[A-Za-z_]\w*$/.test(name) && !LUA_KEYWORDS.has(name)) return { key: name, bracket: false };
  return { key: `["${name.replace(/"/g, '\\"')}"]`, bracket: true };
}

// --- parse the .pyi --------------------------------------------------------------------------

const literals = [];   // { name, values }
const floatAliases = []; // { name, doc }
const typedDicts = []; // { name, fields: [{ name, type, doc }] }
const classes = [];    // { name, doc, constants: [{ name, type }], methods: [{ name, params, ret, doc }] }
let state = null, current = null;

for (let i = 0; i < pyi.length; i++) {
  const line = pyi[i];
  let m;
  if ((m = line.match(/^(\w+) = Literal\[(.*)\]$/))) {
    literals.push({ name: m[1], values: splitTop(m[2], ",").map((v) => v.slice(1, -1)) });
    state = null; continue;
  }
  if ((m = line.match(/^(\w+): TypeAlias = float$/))) {
    const doc = (pyi[i + 1] || "").match(/^"""(.*)"""$/);
    floatAliases.push({ name: m[1], doc: doc ? doc[1] : "" });
    state = null; continue;
  }
  if ((m = line.match(/^class (\w+)\(TypedDict(?:, total=(?:False|True))?\):$/))) {
    current = { name: m[1], fields: [] }; typedDicts.push(current); state = "typeddict"; continue;
  }
  if ((m = line.match(/^(\w+) = TypedDict\('(\w+)', \{$/))) {
    current = { name: m[1], fields: [] }; typedDicts.push(current); state = "typeddict-fn"; continue;
  }
  if ((m = line.match(/^class (\w+):(?: \.\.\.)?$/))) {
    current = { name: m[1], doc: "", constants: [], methods: [] }; classes.push(current); state = "class"; continue;
  }
  if (/^def scriptapp\(/.test(line)) { state = null; continue; }
  if (state === "typeddict") {
    if ((m = line.match(/^\t(\w+): (.+)$/))) {
      const doc = (pyi[i + 1] || "").match(/^\t"""(.*)"""$/);
      current.fields.push({ name: m[1], type: luaType(stripNone(m[2]).type), doc: doc ? doc[1] : "" });
    }
  } else if (state === "typeddict-fn") {
    if ((m = line.match(/^\t'([^']+)': (.+?),(?:\s+#\s*(.*))?$/))) {
      current.fields.push({ name: m[1], type: luaType(stripNone(m[2]).type), doc: m[3] || "" });
    } else if (/^\}/.test(line)) state = null;
  } else if (state === "class") {
    if ((m = line.match(/^\t"""(.*)"""$/)) && current.methods.length === 0 && current.constants.length === 0) {
      current.doc = m[1];
    } else if ((m = line.match(/^\t(\w+): (\w+)$/))) {
      current.constants.push({ name: m[1], type: luaType(m[2]) });
    } else if ((m = line.match(/^\tdef (\w+)\((.*)\)(?: -> (.+))?:$/))) {
      const doc = (pyi[i + 1] || "").match(/^\t\t"""(.*)"""$/);
      current.methods.push({ name: m[1], params: parseParams(m[2]), ret: luaReturn(m[3]), doc: doc ? doc[1] : "" });
    }
  }
}

// --- README: deprecated and unsupported names ------------------------------------------------

function parseReadmeLists(text) {
  const out = [];
  let section = null, cls = null, inCode = false;
  for (const line of text.split("\n")) {
    if (/^## Deprecated Resolve API Functions/.test(line)) { section = "Deprecated Resolve API Functions"; continue; }
    if (/^## Unsupported Resolve API Functions/.test(line)) { section = "Unsupported Resolve API Functions"; continue; }
    if (/^#{2,3} /.test(line)) { section = null; continue; }
    if (!section) continue;
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (!inCode) { const m = line.match(/^(\w+)\s*$/); if (m) cls = m[1]; continue; }
    const m = line.match(/^(\w+)\(([^)]*)\)\s+-->\s+\S+\s+#\s*(.*)$/);
    if (m && cls) out.push({ cls, name: m[1], doc: m[3].trim(), section });
  }
  return out;
}

const deprecated = parseReadmeLists(readme);
// Renamed calling conventions whose README entries are prose, not table rows (README
// "Deprecated Calling Conventions"): the canonical forms take a table.
for (const cls of ["Project", "Timeline"]) {
  deprecated.push({ cls, name: "GetSetting", doc: "Use GetSettings(), which returns a dict of all settings, and index into the result.", section: "Deprecated Calling Conventions" });
  deprecated.push({ cls, name: "SetSetting", doc: "Use SetSettings({settings}); for single keys SetSettings({timelineFrameRate = \"24\"}). Only the 4-argument superScale form is not deprecated.", section: "Deprecated Calling Conventions" });
}
deprecated.push({ cls: "TimelineItem", name: "GetProperty", doc: "Use GetProperties(), which returns a dict of all supported item properties, and index into the result.", section: "Deprecated Calling Conventions" });
deprecated.push({ cls: "TimelineItem", name: "SetProperty", doc: "Use SetProperties({properties}); for single keys SetProperties({ZoomX = 2.0}).", section: "Deprecated Calling Conventions" });

// --- emit --------------------------------------------------------------------------------------

const out = [];
const emit = (s = "") => out.push(s);
const apiClasses = classes.filter((c) => !HAND_WRITTEN.has(c.name));
const methodCount = apiClasses.reduce((n, c) => n + c.methods.length, 0);
emit(BEGIN);
emit(`-- Source: DaVinciResolveScript.pyi next to the README dated ${readmeDate}: ${literals.length} string enums,`);
emit(`-- ${floatAliases.length} constant groups, ${typedDicts.length} TypedDicts, ${apiClasses.length} API classes with ${methodCount} methods,`);
emit(`-- plus ${deprecated.length} deprecated or unsupported names from the README (marked @deprecated so a call warns).`);
emit();
emit("-- String enums (Literal[...] in the .pyi).");
for (const l of literals) emit(`---@alias ${l.name} ${l.values.map((v) => `"${v}"`).join("|")}`);
emit();
emit("-- Constant groups: each alias is a float; the resolve.* fields below carry the alias name.");
for (const a of floatAliases) {
  for (const d of docLine(a.doc)) emit(d);
  emit(`---@alias ${a.name} number`);
}
emit();
emit("-- TypedDicts (all total=False in the .pyi, so every field is optional).");
for (const td of typedDicts) {
  emit(`---@class ${td.name}`);
  for (const f of td.fields) {
    const { key, bracket } = fieldKey(f.name);
    const desc = f.doc ? ` # ${f.doc.replace(/\s+/g, " ").trim()}` : "";
    emit(bracket ? `---@field ${key} ${f.type}?${desc}` : `---@field ${key}? ${f.type}${desc}`);
  }
  emit();
}
emit("-- API classes. Methods are colon-called (obj:Method()); constants are dot-read (resolve.EXPORT_AAF).");
for (const c of apiClasses) {
  const local = c.name === "Resolve" ? "ResolveClass" : c.name; // Resolve() is also a global function
  const known = new Set(c.methods.map((mth) => mth.name));
  const seen = new Set();
  const deps = deprecated.filter((d) => d.cls === c.name && !known.has(d.name) && !seen.has(d.name) && seen.add(d.name));
  for (const d of docLine(c.doc)) emit(d);
  emit(`---@class ${c.name}`);
  for (const k of c.constants) emit(`---@field ${k.name} ${k.type}`);
  if (c.methods.length === 0) emit("---@field [string] fun(...): any  -- opaque in the .pyi (no methods declared)");
  if (c.methods.length === 0 && deps.length === 0) { emit(); continue; }
  emit(`local ${local} = {}`);
  emit();
  for (const mth of c.methods) {
    for (const d of docLine(mth.doc)) emit(d);
    for (const p of mth.params) emit(`---@param ${p.name}${p.optional ? "?" : ""} ${p.type}`);
    if (mth.ret) emit(`---@return ${mth.ret}`);
    emit(`function ${local}:${mth.name}(${mth.params.map((p) => p.name).join(", ")}) end`);
    emit();
  }
  for (const d of deps) {
    emit(`---@deprecated ${d.doc.replace(/\s+/g, " ").trim()} (README "${d.section}")`);
    emit("---@param ... any");
    emit("---@return any");
    emit(`function ${local}:${d.name}(...) end`);
    emit();
  }
}
emit("-- Globals: `resolve` is injected by the host; `Resolve()` is the shipped examples' form and");
emit("-- returns a proxy that is not == the global (measured).");
emit("---@type Resolve");
emit("resolve = ResolveClass");
emit();
emit("---@return Resolve?");
emit("function Resolve() end");
emit(END);
const block = out.join("\n");

// --- write or check ----------------------------------------------------------------------------

const file = readFileSync(typesPath, "utf8");
const b = file.indexOf(BEGIN);
const e = file.indexOf(END);
if (b < 0 || e < 0 || e < b) fail(`markers not found in ${typesPath} (expected a BEGIN GENERATED ... END GENERATED block)`);
const before = file.slice(0, b);
const after = file.slice(e + END.length);
const existing = file.slice(b, e + END.length);
if (checkOnly) {
  if (existing === block) { process.stdout.write("gen-types: types/resolve_host.d.lua is up to date\n"); process.exit(0); }
  fail("types/resolve_host.d.lua is stale; run `make gen-types`");
}
writeFileSync(typesPath, before + block + after);
process.stdout.write(`gen-types: wrote ${block.split("\n").length} generated lines (${apiClasses.length} API classes, ${methodCount} methods, ${typedDicts.length} TypedDicts, ${deprecated.length} deprecated names)\n`);
