-- run_tests.lua: tests for bridge/resolve_lua_bridge.lua under Resolve's bundled LuaJIT:
--   "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript" \
--     -l lua <abs>/tests/lua/run_tests.lua
-- Env: RLB_TEST_DIR (scratch dir; default a fresh os.tmpname() .. ".d"), RLB_BRIDGE (bridge
-- path; default derived from arg[0]). Never touches Resolve: stub resolve/fusion/bmd objects are
-- installed into _G with rawset (loadfile'd chunks run in _G, while this main script runs in
-- fuscript's sandbox env). fuscript is unsandboxed, but .luarc.json mirrors the menu host, so io
-- and require are fetched with rawget. fuscript swallows exit codes, so the last line printed is
-- "RLB_TESTS_RESULT: PASS|FAIL ..." and the Makefile greps it.

local io_lib = rawget(_G, "io")
local require_fn = rawget(_G, "require")
local dkjson = require_fn("dkjson")
local real_print = print

local SCRIPT = (arg and arg[0]) or ""
local ROOT = SCRIPT:match("^(.*)/tests/lua/[^/]+$") or "."
local BRIDGE = os.getenv("RLB_BRIDGE") or (ROOT .. "/bridge/resolve_lua_bridge.lua")
local DIR = os.getenv("RLB_TEST_DIR")
if not DIR or #DIR == 0 then DIR = os.tmpname() .. ".d" end
local STATE = DIR .. "/state"
local mk = os.execute("mkdir -p '" .. STATE .. "'")   -- true (5.2 style) or 0 (5.1 style)
assert(mk == true or mk == 0, "cannot create " .. STATE)
local PREFS_FILE = DIR .. "/Fusion.prefs"
local RQ = STATE .. "/next.lua"
local PREFIX = "Global.ResolveLuaBridge."

---------------------------------------------------------------------------
-- Harness helpers
---------------------------------------------------------------------------

local pass, fail, failures, group_name = 0, 0, {}, ""

local function group(name) group_name = name; real_print("== " .. name) end

local function check(name, cond, detail)
  if cond then pass = pass + 1; return end
  fail = fail + 1
  local msg = group_name .. " / " .. name .. (detail ~= nil and (": " .. tostring(detail)) or "")
  failures[#failures + 1] = msg
  real_print("  FAIL " .. msg)
end

local function eq(name, got, want)
  check(name, got == want, "got " .. tostring(got) .. " want " .. tostring(want))
end

local function write_file(path, s)
  local f = assert(io_lib.open(path, "wb"))
  f:write(s)
  f:close()
end

local function read_file(path)
  local f = io_lib.open(path, "rb")
  if not f then return nil end
  local s = f:read("*a")
  f:close()
  return s
end

local function remove_file(path) os.remove(path) end

local function unhex(h)
  if type(h) ~= "string" then return "" end
  return (h:gsub("%x%x", function(b) return string.char(tonumber(b, 16)) end))
end

local function lit(v)
  if type(v) == "string" then return string.format("%q", v) end
  return tostring(v)
end

-- Writes <state>/next.lua the way the server does (tmp + rename). Defaults: v = 1, ts = now.
local function write_request(t)
  local r = { v = 1, ts = os.time() }
  for k, v in pairs(t) do r[k] = v end
  local lines = { "return {" }
  for _, k in ipairs({ "v", "id", "session", "op", "ts", "max_kb" }) do
    if r[k] ~= nil then lines[#lines + 1] = string.format("  %s = %s,", k, lit(r[k])) end
  end
  if r.code then lines[#lines + 1] = "  code = [==[" .. r.code .. "]==]," end
  lines[#lines + 1] = "}"
  write_file(RQ .. ".tmp", table.concat(lines, "\n") .. "\n")
  assert(os.rename(RQ .. ".tmp", RQ))
end

---------------------------------------------------------------------------
-- Stubs: bmd, fusion (with a prefs store that serialises like Fusion.prefs), resolve
---------------------------------------------------------------------------

local function obj(name, methods)
  local o = {}
  for k, f in pairs(methods) do o[k] = f end
  return setmetatable(o, { __tostring = function() return "<stub " .. name .. ">" end })
end

local function list(t) t.__flags = 4194304; return t end

local B = { clock = 0, uuid_n = 0, waited = 0 }
local bmd_stub = {
  fileexists = function(p)
    local f = io_lib.open(p, "rb")
    if f then f:close(); return true end
    return false
  end,
  wait = function(s) B.waited = B.waited + (s or 0) end,
  gettime = function() return B.clock end,
  createuuid = function() B.uuid_n = B.uuid_n + 1; return "{0000-UUID-" .. B.uuid_n .. "}" end,
  getpid = function() return 4242 end,
}

local prefs = { Global = { Script = { AllowAutomaticScripts = 0 } } }
local function split(path)
  local parts = {}
  for p in path:gmatch("[^.]+") do parts[#parts + 1] = p end
  return parts
end
local function pget(path)
  local t = prefs
  for _, p in ipairs(split(path)) do
    if type(t) ~= "table" then return nil end
    t = t[p]
  end
  return t
end
local function pset(path, v)
  local parts = split(path)
  local t = prefs
  for i = 1, #parts - 1 do
    if type(t[parts[i]]) ~= "table" then t[parts[i]] = {} end
    t = t[parts[i]]
  end
  t[parts[#parts]] = v
end
local function rlb(key) return pget(PREFIX .. key) end

-- Fusion writes strings with \" \\ \n escaped and everything else raw (measured, Step 1).
local function lua_str(s)
  return '"' .. (s:gsub('[\\"\n]', { ["\\"] = "\\\\", ['"'] = '\\"', ["\n"] = "\\n" })) .. '"'
end
local function serialize(t, indent)
  local keys = {}
  for k in pairs(t) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local out = { "{\n" }
  for _, k in ipairs(keys) do
    local v = t[k]
    local ks = (type(k) == "string" and k:match("^[%a_][%w_]*$")) and k or ("[" .. lua_str(tostring(k)) .. "]")
    local vs
    if type(v) == "table" then vs = serialize(v, indent .. "\t")
    elseif type(v) == "string" then vs = lua_str(v)
    else vs = tostring(v) end
    out[#out + 1] = indent .. "\t" .. ks .. " = " .. vs .. ",\n"
  end
  out[#out + 1] = indent .. "}"
  return table.concat(out)
end

local FU = { saves = 0, sets = 0, fail_saves = 0, throw_set = 0,
             profile = DIR .. "/Library/Application Support/BMD/Fusion/Profiles/Default/" }
local fusion_stub = obj("Fusion", {
  GetPrefs = function(_, path) return pget(path) end,
  SetPrefs = function(_, path, v)
    if FU.throw_set > 0 then FU.throw_set = FU.throw_set - 1; error("SetPrefs exploded") end
    FU.sets = FU.sets + 1
    pset(path, v)
    return true
  end,
  SavePrefs = function()
    FU.saves = FU.saves + 1
    if FU.fail_saves > 0 then FU.fail_saves = FU.fail_saves - 1; return false end
    write_file(PREFS_FILE, serialize(prefs, "") .. "\n")
    return nil
  end,
  MapPath = function(_, p)
    if p == "Profile:" then return FU.profile end
    return p
  end,
})

local RS = { version_throws = false }
local resolve_stub = obj("Resolve", {
  GetProductName = function() return "DaVinci Resolve" end,
  GetVersionString = function()
    if RS.version_throws then error("resolve gone") end
    return "21.1.0.17"
  end,
  GetVersion = function() return list({ 21, 1, 0, 17, "" }) end,
  Fusion = function() return fusion_stub end,
  IsStudio = function() return false end,
})

rawset(_G, "bmd", bmd_stub)
rawset(_G, "resolve", resolve_stub)
rawset(_G, "fusion", fusion_stub)
rawset(_G, "Resolve", nil)

local M = assert(loadfile(BRIDGE))("RLB_BRIDGE_TESTING")
check("bridge exported its internals", type(M) == "table" and type(M.json) == "function")

-- Always returns an id string and a table (with .error set when the response is unusable).
local function decode_resp(s)
  if type(s) ~= "string" then return "", { error = "no RLBResp" } end
  local id, hx = s:match("^([^:]*):(.*)$")
  if not id then return "", { error = "no id prefix" } end
  local t, _, err = dkjson.decode(unhex(hx))
  if type(t) ~= "table" then return id, { error = "decode failed: " .. tostring(err) } end
  return id, t
end

local function session_table()
  local t = dkjson.decode(unhex(rlb("RLBSession")))
  if type(t) ~= "table" then return { error = "undecodable RLBSession" } end
  return t
end

local function fresh_start()
  remove_file(RQ)
  local st = M.start({ resolve = resolve_stub, fusion = fusion_stub, state_dir = STATE })
  FU.saves = 0
  return st
end

---------------------------------------------------------------------------
-- 1. hex
---------------------------------------------------------------------------
group("hex")
eq("empty", M.hex(""), "")
eq("00ff", M.hex("\0\255"), "00ff")
local all = {}
for i = 0, 255 do all[#all + 1] = string.char(i) end
local allhex = M.hex(table.concat(all))
eq("256 bytes length", #allhex, 512)
eq("256 bytes round trip", unhex(allhex), table.concat(all))

---------------------------------------------------------------------------
-- 2. json numbers
---------------------------------------------------------------------------
group("json numbers")
eq("0", M.json(0), "0")
eq("-0", M.json(-0.0), "0")
eq("1", M.json(1), "1")
eq("-1", M.json(-1), "-1")
eq("3.5", M.json(3.5), "3.5")
eq("23.976", M.json(23.976), "23.976")
eq("0.1", M.json(0.1), "0.1")
eq("1/3", M.json(1 / 3), "0.33333333333333331")
eq("2^53-1", M.json(2 ^ 53 - 1), "9007199254740991")
eq("2^53", M.json(2 ^ 53), "9007199254740992")
eq("2^63", M.json(2 ^ 63), "9.2233720368547758e+18")
eq("1e21", M.json(1e21), "1e+21")
eq("nan", M.json(0 / 0), "null")
eq("inf", M.json(1 / 0), "null")
eq("-inf", M.json(-1 / 0), "null")

---------------------------------------------------------------------------
-- 3. json strings
---------------------------------------------------------------------------
group("json strings")
eq("quote", M.json('a"b'), '"a\\"b"')
eq("backslash", M.json("a\\b"), '"a\\\\b"')
eq("newline cr tab", M.json("a\nb\rc\td"), '"a\\nb\\rc\\td"')
eq("control", M.json("\1"), '"\\u0001"')
eq("nul", M.json("\0"), '"\\u0000"')
eq("del", M.json("\127"), '"\\u007f"')
eq("utf8 raw", M.json("é日本"), '"é日本"')
eq("]]", M.json("]]"), '"]]"')
eq("empty", M.json(""), '""')

---------------------------------------------------------------------------
-- 4. arrays
---------------------------------------------------------------------------
group("json arrays")
eq("array", M.json({ 1, 2, 3 }), "[1,2,3]")
eq("nested", M.json({ { 1 }, { a = { b = {} } } }), '[[1],{"a":{"b":{}}}]')
eq("holes", M.json({ 1, nil, 3 }), '{"1":1,"3":3}')
eq("booleans", M.json({ true, false }), "[true,false]")
eq("null top level", M.json(nil), "null")

---------------------------------------------------------------------------
-- 5. __flags
---------------------------------------------------------------------------
group("__flags")
eq("flagged list", M.json(list({ "a" })), '["a"]')
eq("flagged empty", M.json(list({})), "[]")
eq("plain empty", M.json({}), "{}")
eq("flagged dict", M.json({ __flags = 4194304, x = 1 }), '{"x":1}')
local shape_ok, shape_n, shape_flag = M.array_shape(list({ "a", "b" }))
check("array_shape", shape_ok and shape_n == 2 and shape_flag)

---------------------------------------------------------------------------
-- 6. dicts and key order
---------------------------------------------------------------------------
group("json dicts")
eq("markers", M.json({ [108000] = { color = "Blue", duration = 1 } }), '{"108000":{"color":"Blue","duration":1}}')
eq("mixed", M.json({ 1, a = 2 }), '{"1":1,"a":2}')
eq("sorted", M.json({ b = 1, a = 2, c = 3 }), '{"a":2,"b":1,"c":3}')
eq("float key", M.json({ [1.5] = true }), '{"1.5":true}')
eq("numeric keys sort numerically", M.json({ [10] = 1, [9] = 2, [1] = 3, [3] = 4 }), '{"1":3,"3":4,"9":2,"10":1}')
local det = { z = 1, y = { 2, 3 }, x = "s", [4] = false }
eq("deterministic", M.json(det), M.json(det))

---------------------------------------------------------------------------
-- 7. placeholders
---------------------------------------------------------------------------
group("placeholders")
check("userdata", M.json(io_lib.stdout):match('^"<userdata ') ~= nil, M.json(io_lib.stdout))
check("function", M.json(real_print):match('^"<function ') ~= nil)
check("thread", M.json(coroutine.create(function() end)):match('^"<thread ') ~= nil)
check("metatabled table", M.json(setmetatable({ a = 1 }, {})):match('^"<object ') ~= nil)
check("userdata inside table", M.json({ u = io_lib.stdout }):match('^{"u":"<userdata ') ~= nil)

---------------------------------------------------------------------------
-- 8. cycles and depth
---------------------------------------------------------------------------
group("cycles and depth")
local cyc = {}
cyc.self = cyc
eq("cycle", M.json(cyc), '{"self":"<cycle>"}')
local shared = { 1 }
eq("shared sub-table twice", M.json({ shared, shared }), "[[1],[1]]")
local deep, cur = {}, nil
cur = deep
for _ = 1, 18 do cur.n = {}; cur = cur.n end
check("depth limit", M.json(deep):find("<depth>", 1, true) ~= nil)
local shallow = {}
cur = shallow
for _ = 1, 10 do cur.n = {}; cur = cur.n end
check("depth ok", M.json(shallow):find("<depth>", 1, true) == nil)

---------------------------------------------------------------------------
-- 9. validate_request
---------------------------------------------------------------------------
group("validate_request")
local function req(over)
  local r = { v = 1, id = "abc123", session = "*", op = "ping", ts = os.time() }
  for k, v in pairs(over or {}) do r[k] = v end
  return r
end
check("valid ping", M.validate_request(req()))
check("valid run", M.validate_request(req({ op = "run", code = "return 1" })))
check("valid stop", M.validate_request(req({ op = "stop" })))
local r = req(); r.id = nil
check("missing id", not M.validate_request(r))
check("non-string id", not M.validate_request(req({ id = 42 })))
check("quoted id", not M.validate_request(req({ id = 'a"b' })))
check("long id", not M.validate_request(req({ id = string.rep("a", 65) })))
check("64-byte id", M.validate_request(req({ id = string.rep("a", 64) })))
check("v=2", not M.validate_request(req({ v = 2 })))
check("bad op", not M.validate_request(req({ op = "dance" })))
r = req(); r.ts = "now"
check("ts string", not M.validate_request(r))
check("run without code", not M.validate_request(req({ op = "run" })))
r = req(); r.session = nil
check("missing session", not M.validate_request(r))
check("not a table", not M.validate_request("x"))
eq("max_kb 0", M.request_max_kb({ max_kb = 0 }), 1)
eq("max_kb 1000", M.request_max_kb({ max_kb = 1000 }), 192)
eq("max_kb x", M.request_max_kb({ max_kb = "x" }), 64)
eq("max_kb nil", M.request_max_kb({}), 64)
eq("max_kb nan", M.request_max_kb({ max_kb = 0 / 0 }), 1)
eq("max_kb 16", M.request_max_kb({ max_kb = 16 }), 16)

---------------------------------------------------------------------------
-- 10. load_request
---------------------------------------------------------------------------
group("load_request")
write_request({ id = "r1", op = "ping", session = "*" })
local q, qerr = M.load_request(RQ)
check("valid", type(q) == "table" and q.id == "r1", qerr)
write_file(RQ, "return { id = ")
q, qerr = M.load_request(RQ)
check("syntax error", q == nil and qerr:match("^loadfile:") ~= nil, qerr)
write_file(RQ, "error('boom')")
q, qerr = M.load_request(RQ)
check("runtime error", q == nil and qerr:match("^request chunk error:") ~= nil, qerr)
write_file(RQ, "return 42")
q, qerr = M.load_request(RQ)
check("returns number", q == nil and qerr:match("not return a table") ~= nil, qerr)
q, qerr = M.load_request(STATE .. "/nope.lua")
check("nonexistent", q == nil and qerr ~= nil)
write_file(RQ, "leak = 1; return { id = 'x', o = os }")
q, qerr = M.load_request(RQ)
check("empty env: no global leak", rawget(_G, "leak") == nil)
check("empty env: no os", q ~= nil and q.o == nil, qerr)
remove_file(RQ)

---------------------------------------------------------------------------
-- 11. run_chunk and make_env
---------------------------------------------------------------------------
group("run_chunk")
local st0 = { resolve = resolve_stub, fusion = fusion_stub, session = "s" }
local rr = M.run_chunk(st0, 'print("a", 1, nil); return {a=1}')
check("ok", rr.ok, rr.error)
eq("print line", rr.prints[1], "a\t1\tnil")
eq("result", rr.result and rr.result.a, 1)
check("ms", type(rr.ms) == "number" and rr.ms >= 0)
rr = M.run_chunk(st0, "return resolve:GetVersionString()")
eq("resolve visible", rr.result, "21.1.0.17")
rr = M.run_chunk(st0, "return fusion == fu and fu == app")
eq("fusion aliases visible", rr.result, true)
rr = M.run_chunk(st0, "leaky = 1; return leaky")
eq("global stays in env", rr.result, 1)
check("no leak into _G", rawget(_G, "leaky") == nil)
rr = M.run_chunk(st0, 'return rawget(_G, "print") == print')
check("_G.print swapped during", rr.result == true)
check("_G.print restored", rawget(_G, "print") == real_print)
rr = M.run_chunk(st0, 'error("x")')
check("_G.print restored after error", rawget(_G, "print") == real_print)
rr = M.run_chunk(st0, "return nil")
check("nil result", rr.ok and rr.result == nil)
check("nil result encodes null", M.envelope_json({ id = "n", session = "s", op = "run", ok = true }, nil):find('"result":null', 1, true) ~= nil)
rr = M.run_chunk(st0, "return 1, 2")
eq("first value", rr.result, 1)
eq("extra_returns", rr.extra_returns, 1)
rr = M.run_chunk(st0, "return 1")
eq("no extra_returns", rr.extra_returns, nil)
rr = M.run_chunk(st0, "return 1 +")
check("syntax error", not rr.ok and rr.error:match("^loadstring:") ~= nil, rr.error)
rr = M.run_chunk(st0, "local x = nil; return x.y")
check("runtime error names request:1", not rr.ok and rr.error:find("request:1:", 1, true) ~= nil, rr.error)
rr = M.run_chunk(st0, "error({ code = 1 })")
check("table error", not rr.ok and type(rr.error) == "table" and rr.error.code == 1)
local dbg_saved = rawget(_G, "debug")
rawset(_G, "debug", nil)
rr = M.run_chunk(st0, 'error("plain")')
eq("no debug: message only", rr.error, "request:1: plain")
rr = M.run_chunk(st0, "error({ code = 7 })")
check("no debug: table error kept", not rr.ok and type(rr.error) == "table" and rr.error.code == 7, rr.error)
rawset(_G, "debug", dbg_saved)
rr = M.run_chunk(st0, "for i = 1, 500 do print(i) end")
eq("print cap lines", #rr.prints, M.PRINT_MAX_LINES)
eq("prints_dropped", rr.prints_dropped, 300)
rr = M.run_chunk(st0, 'print(string.rep("x", 5000))')
eq("long line cut", #rr.prints[1], M.PRINT_LINE_MAX + 3)
rr = M.run_chunk(st0, 'for i = 1, 100 do print(string.rep("y", 1000)) end')
check("print byte cap", rr.prints_dropped ~= nil and rr.prints_dropped > 0 and #rr.prints < 100, rr.prints_dropped)
rr = M.run_chunk(st0, "return io_lib_stub")
check("unknown global is nil", rr.ok and rr.result == nil)

---------------------------------------------------------------------------
-- 12. fit_response
---------------------------------------------------------------------------
group("fit_response")
local function fields() return { id = "f1", session = "s", op = "run", ok = true, ms = 1, prints = {} } end
local s = M.fit_response(fields(), { a = 1 }, 64)
eq("small, fixed key order", s,
  '{"v":1,"id":"f1","session":"s","op":"run","ok":true,"ms":1,"prints":[],"result":{"a":1},"bridge":"' .. M.BRIDGE .. '"}')
local big = string.rep("abcdefghij", 30000)
local f = fields()
s = M.fit_response(f, big, 64)
check("truncated flag", f.truncated == true)
eq("result_bytes", f.result_bytes, #M.json(big))
check("fits 64 KB", #s <= 65536, #s)
local d = dkjson.decode(s)
check("decodes", type(d) == "table" and d.truncated == true)
check("preview is a prefix of the result JSON", d and type(d.result) == "string" and M.json(big):sub(1, #d.result) == d.result)
check("preview is long", d and #d.result > 60000, d and #d.result)
local quoty = string.rep('"\\', 40000)
f = fields()
s = M.fit_response(f, quoty, 64)
check("quote-heavy fits", #s <= 65536, #s)
check("quote-heavy fills the budget", #s >= 60000, #s)
d = dkjson.decode(s)
check("quote-heavy decodes", d ~= nil)
check("quote-heavy preview is long", d and type(d.result) == "string" and #d.result >= 30000, d and #d.result)
local halfq = string.rep('a"', 40000)
f = fields()
s = M.fit_response(f, halfq, 64)
check("half-quoted fills the budget", #s <= 65536 and #s >= 60000, #s)
check("half-quoted decodes", dkjson.decode(s) ~= nil)
local utf = string.rep("日本語", 30000)
f = fields()
s = M.fit_response(f, utf, 64)
d = dkjson.decode(s)
check("utf8 boundary", d and type(d.result) == "string" and (#d.result - 1) % 3 == 0, d and #d.result)
f = fields()
for i = 1, 16 do f.prints[i] = string.rep("p", 1000) end
s = M.fit_response(f, "x", 1)
check("prints dropped", f.prints_dropped == 16 and #f.prints == 0, f.prints_dropped)
check("fits 1 KB", #s <= 1024, #s)
f = fields(); f.ok = false; f.error = string.rep("e", 4000)
s = M.fit_response(f, nil, 1)
check("error cut", #s <= 1024 and #f.error == 256, #s)
f = fields()
s = M.fit_response(f, { 1, 2 }, "1000")
check("string max_kb accepted", #s > 0 and not f.truncated)
f = fields()
s = M.fit_response(f, setmetatable({}, { __index = function() error("no") end }), 64)
check("encode error survives", dkjson.decode(s) ~= nil)

---------------------------------------------------------------------------
-- 13. save_prefs and set_response
---------------------------------------------------------------------------
group("prefs")
local st1 = { fusion = fusion_stub, session = "s" }
FU.fail_saves, FU.saves = 2, 0
local sok, attempts = M.save_prefs(st1)
check("retry succeeds on attempt 3", sok and attempts == 3, attempts)
eq("saves counted", FU.saves, 3)
FU.fail_saves, FU.saves = 5, 0
sok, attempts = M.save_prefs(st1)
check("five failures give up", not sok and attempts == 5, attempts)
FU.fail_saves = 0
FU.throw_set = 2
local rok, rerr = M.set_response(st1, "id1", "{}")
check("SetPrefs throwing twice fails", rok == false, rerr)
FU.throw_set = 1
rok, rerr = M.set_response(st1, "id1", "{}")
check("SetPrefs throwing once falls back to minimal", rok == true and rerr == "minimal", rerr)
local mid, mresp = decode_resp(rlb("RLBResp"))
check("minimal envelope", mid == "id1" and mresp.ok == false and tostring(mresp.error):match("^SetPrefs:") ~= nil, mresp.error)
FU.throw_set = 0
rok = M.set_response(st1, "id2", '{"x":1}')
check("set ok", rok == true)
eq("stored", rlb("RLBResp"), "id2:" .. M.hex('{"x":1}'))

---------------------------------------------------------------------------
-- 14. resolve_state_dir
---------------------------------------------------------------------------
group("resolve_state_dir")
local function genv(t) return function(k) return t[k] end end
local function mp() return "/Users/x/Library/Application Support/BMD/Profiles/Default/" end
local dir, src = M.resolve_state_dir("/tmp/stamped/", genv({ HOME = "/h" }), mp)
eq("stamp", dir, "/tmp/stamped"); eq("stamp source", src, "stamp")
dir, src = M.resolve_state_dir("@@RLB_STATE_DIR@@", genv({ RLB_STATE_DIR = "/e/dir", HOME = "/h" }), mp)
eq("env", dir, "/e/dir"); eq("env source", src, "env")
dir, src = M.resolve_state_dir("", genv({ HOME = "/h/" }), mp)
eq("home", dir, "/h/.resolve-lua-bridge"); eq("home source", src, "HOME")
dir, src = M.resolve_state_dir("@@RLB_STATE_DIR@@", genv({}), mp)
eq("profile", dir, "/Users/x/.resolve-lua-bridge"); eq("profile source", src, "profile")
dir, src = M.resolve_state_dir("@@RLB_STATE_DIR@@", genv({}), nil)
check("none", dir == nil and src:match("no state directory") ~= nil, src)
eq("stamp placeholder", M.STATE_DIR_STAMP, "@@RLB_STATE_DIR@@")
local bridge_src = read_file(BRIDGE) or ""
check("stamp is a long-bracket literal", bridge_src:find("[==[@@RLB_STATE_DIR@@]==]", 1, true) ~= nil)
check("stamp is not a quoted literal", bridge_src:find('"@@RLB_STATE_DIR@@"', 1, true) == nil)

---------------------------------------------------------------------------
-- 15. acquisition
---------------------------------------------------------------------------
group("acquisition")
local ar, asrc = M.acquire_resolve()
check("global resolve", ar == resolve_stub and asrc == "global", asrc)
rawset(_G, "resolve", nil)
rawset(_G, "Resolve", function() return resolve_stub end)
ar, asrc = M.acquire_resolve()
check("Resolve()", ar == resolve_stub and asrc == "Resolve()", asrc)
rawset(_G, "Resolve", nil)
bmd_stub.scriptapp = function(name) if name == "Resolve" then return resolve_stub end end
ar, asrc = M.acquire_resolve()
check("bmd.scriptapp", ar == resolve_stub and asrc == "bmd.scriptapp", asrc)
bmd_stub.scriptapp = nil
ar, asrc = M.acquire_resolve()
check("nothing", ar == nil, asrc)
rawset(_G, "resolve", obj("NoName", { Fusion = function() return fusion_stub end }))
ar, asrc = M.acquire_resolve()
check("rejected without GetProductName", ar == nil, asrc)
rawset(_G, "resolve", resolve_stub)
local af, afsrc = M.acquire_fusion(resolve_stub)
check("global fusion", af == fusion_stub and afsrc == "fusion", afsrc)
rawset(_G, "fusion", nil); rawset(_G, "fu", fusion_stub)
af, afsrc = M.acquire_fusion(resolve_stub)
check("fu", af == fusion_stub and afsrc == "fu", afsrc)
rawset(_G, "fu", nil); rawset(_G, "app", fusion_stub)
af, afsrc = M.acquire_fusion(resolve_stub)
check("app", af == fusion_stub and afsrc == "app", afsrc)
rawset(_G, "app", nil)
af, afsrc = M.acquire_fusion(resolve_stub)
check("resolve:Fusion()", af == fusion_stub and afsrc == "resolve:Fusion()", afsrc)
af, afsrc = M.acquire_fusion(nil)
check("none", af == nil, afsrc)
FU.saves = 0
local lonely = obj("Resolve", { GetProductName = function() return "DaVinci Resolve" end, Fusion = function() return nil end })
local st_nf, err_nf = M.start({ resolve = lonely, state_dir = STATE })
check("start without fusion returns nil, no save", st_nf == nil and FU.saves == 0, err_nf)
rawset(_G, "fusion", fusion_stub)

---------------------------------------------------------------------------
-- 16. start
---------------------------------------------------------------------------
group("start")
remove_file(RQ)
FU.saves = 0
prefs.Global.ResolveLuaBridge = { RLBDiag = "old", RLBProbe64K = "zzz", RLBResp = "old:00", RLBMem = "m" }
local st = M.start({ resolve = resolve_stub, fusion = fusion_stub, state_dir = STATE })
check("started", st ~= nil)
eq("one save", FU.saves, 1)
local sess = session_table()
check("state running", sess and sess.state == "running", rlb("RLBSession"))
eq("session", sess.session, st.session)
eq("pid", sess.pid, 4242)
eq("state_dir", sess.state_dir, STATE)
eq("state_dir_source", sess.state_dir_source, "opts")
eq("bridge", sess.bridge, M.BRIDGE)
eq("product", sess.product, "DaVinci Resolve")
eq("version", sess.version, "21.1.0.17")
eq("profile", sess.profile, FU.profile)
check("started epoch", type(sess.started) == "number" and sess.started > 1700000000)
check("v", sess.v == 1)
for _, k in ipairs(M.DIAG_KEYS) do eq("cleared " .. k, rlb(k), "") end
eq("RLBResp cleared", rlb("RLBResp"), "")
check("session token sanitised", st.session:match("^[%w%-]+$") ~= nil, st.session)
write_request({ id = "pre1", op = "ping", session = "*" })
FU.saves = 0
local st2 = M.start({ resolve = resolve_stub, fusion = fusion_stub, state_dir = STATE })
eq("pre-existing request recorded", st2.last_id, "pre1")
eq("start save", FU.saves, 1)
eq("loop ignores pre-existing", M.run_loop(st2, 5, 0), "ticks")
eq("no response for it", FU.saves, 1)
eq("RLBResp still empty", rlb("RLBResp"), "")
check("second session differs", st2.session ~= st.session)
write_file(RQ, "return {")
local st3 = M.start({ resolve = resolve_stub, fusion = fusion_stub, state_dir = STATE })
check("unreadable pre-existing gets a backoff", st3 and st3.last_id == nil and st3.bad_until > 0)
remove_file(RQ)
rawset(_G, "resolve", nil)
FU.saves = 0
local st4, err4 = M.start({ fusion = fusion_stub, state_dir = STATE })
check("no resolve returns nil", st4 == nil and err4 ~= nil, err4)
sess = session_table()
check("session state error", sess and sess.state == "error" and sess.error ~= nil, rlb("RLBSession"))
eq("error written with one save", FU.saves, 1)
rawset(_G, "resolve", resolve_stub)
local saved_profile = FU.profile
FU.profile = "nope"
FU.saves = 0
local st5, err5 = M.start({ resolve = resolve_stub, fusion = fusion_stub, getenv = function() return nil end })
check("no state dir returns nil", st5 == nil and err5 ~= nil and err5:match("no state directory") ~= nil, err5)
sess = session_table()
check("no state dir: session error", sess and sess.state == "error")
FU.profile = saved_profile
local st6 = M.start({ resolve = resolve_stub, fusion = fusion_stub, getenv = genv({ HOME = DIR .. "/home" }) })
check("HOME state dir", st6 and st6.state_dir == DIR .. "/home/.resolve-lua-bridge" and st6.state_dir_source == "HOME", st6 and st6.state_dir)
eq("missing state dir is not an error", M.run_loop(st6, 3, 0), "ticks")
remove_file(RQ)
FU.fail_saves, FU.saves = 5, 0
local st7 = M.start({ resolve = resolve_stub, fusion = fusion_stub, state_dir = STATE })
check("failed start save recorded", st7 and st7.session_saved == false and st7.start_save.ok == false, st7 and st7.start_save.error)
eq("failed start save: five attempts", FU.saves, 5)
B.clock = 400
FU.fail_saves, FU.saves = 5, 0
M.run_loop(st7, 10, 0)
eq("start save retried once per second", FU.saves, 5)
B.clock = 401.5
FU.fail_saves, FU.saves = 0, 0
M.run_loop(st7, 3, 0)
check("start save lands on retry", st7.session_saved == true and FU.saves == 1, FU.saves)
check("retried session on disk", (read_file(PREFS_FILE) or ""):find(M.hex('"session":"' .. st7.session .. '"'), 1, true) ~= nil)
write_request({ id = "ps", op = "ping", session = "*" })
M.run_loop(st7, 3, 0)
local prid, presp = decode_resp(rlb("RLBResp"))
check("ping reports the start save", prid == "ps" and presp.result and presp.result.session_saved == true
  and type(presp.result.start_save) == "table" and presp.result.start_save.ok == false and presp.result.start_save.retries == 2,
  presp.result and presp.result.start_save and presp.result.start_save.retries)

---------------------------------------------------------------------------
-- 17. run_loop
---------------------------------------------------------------------------
group("run_loop")
st = fresh_start()
write_request({ id = "p1", op = "ping", session = "*" })
eq("ping ticks", M.run_loop(st, 5, 0), "ticks")
eq("ping one save", FU.saves, 1)
local rid, resp = decode_resp(rlb("RLBResp"))
eq("ping id", rid, "p1")
check("ping ok", resp.ok == true, resp.error)
eq("ping op", resp.op, "ping")
eq("ping pid", resp.result.pid, 4242)
eq("ping version", resp.result.version, "21.1.0.17")
eq("ping session", resp.session, st.session)
eq("ping state_dir", resp.result.state_dir, STATE)
check("ping uptime", type(resp.result.uptime_s) == "number")
eq("lingering file: no rerun", M.run_loop(st, 5, 0), "ticks")
eq("saves unchanged", FU.saves, 1)
check("waited per tick", B.waited >= 0)
write_request({ id = "r1", op = "run", session = st.session,
                code = 'print("hi"); return { n = 1, l = resolve:GetVersion(), e = {} }' })
M.run_loop(st, 5, 0)
eq("run save", FU.saves, 2)
rid, resp = decode_resp(rlb("RLBResp"))
eq("run id", rid, "r1")
check("run ok", resp.ok == true, resp.error)
eq("run print", resp.prints[1], "hi")
eq("run result", resp.result.n, 1)
check("list encoded as array", resp.result.l[1] == 21 and #resp.result.l == 5)
check("ms present", type(resp.ms) == "number")
write_request({ id = "t1", op = "ping", session = "someone-else" })
eq("takeover", M.run_loop(st, 5, 0), "takeover")
eq("takeover writes nothing", FU.saves, 2)
st = M.start({ resolve = resolve_stub, fusion = fusion_stub, state_dir = STATE })
FU.saves = 0
eq("takeover request is pre-existing for the new loop", st.last_id, "t1")
write_request({ id = "s1", op = "ping", session = "*", ts = os.time() - 200 })
M.run_loop(st, 5, 0)
eq("stale: one save", FU.saves, 1)
rid, resp = decode_resp(rlb("RLBResp"))
check("stale error", rid == "s1" and resp.ok == false and resp.error:match("^stale request") ~= nil, resp.error)
write_request({ id = "v2", op = "ping", session = "*", v = 2 })
M.run_loop(st, 5, 0)
rid, resp = decode_resp(rlb("RLBResp"))
check("v=2 error", rid == "v2" and resp.ok == false and resp.error:match("protocol version") ~= nil, resp.error)
write_request({ id = "nocode", op = "run", session = st.session })
M.run_loop(st, 5, 0)
rid, resp = decode_resp(rlb("RLBResp"))
check("run without code error", rid == "nocode" and resp.ok == false and resp.error == "run without code", resp.error)
write_request({ id = "wild", op = "run", session = "*", code = "return 1" })
FU.saves = 0
M.run_loop(st, 5, 0)
rid, resp = decode_resp(rlb("RLBResp"))
check("wildcard run rejected", rid == "wild" and resp.ok == false and tostring(resp.error):match("^run needs") ~= nil, resp.error)
eq("wildcard run: error saved", FU.saves, 1)
write_file(RQ, "return { id = 'bad id', v = 1, session = '*', op = 'ping', ts = " .. os.time() .. " }")
FU.saves = 0
B.clock = 100
M.run_loop(st, 5, 0)
eq("invalid id: no response", FU.saves, 0)
write_file(RQ, "return {")
local real_loadfile = rawget(_G, "loadfile")
local parses = 0
rawset(_G, "loadfile", function(...) parses = parses + 1; return real_loadfile(...) end)
B.clock = 200
eq("malformed: loop continues", M.run_loop(st, 10, 0), "ticks")
eq("malformed: no save", FU.saves, 0)
eq("malformed: parsed once within the backoff", parses, 1)
B.clock = 201.5
M.run_loop(st, 10, 0)
eq("malformed: parsed again after 1 s", parses, 2)
rawset(_G, "loadfile", real_loadfile)
write_request({ id = "after-bad", op = "ping", session = "*" })
B.clock = 203
M.run_loop(st, 5, 0)
rid = decode_resp(rlb("RLBResp"))
eq("valid replacement handled", rid, "after-bad")
remove_file(RQ)
eq("deleted file: ticks", M.run_loop(st, 3, 0), "ticks")
st = fresh_start()
write_request({ id = "van1", op = "ping", session = "*" })
local lf_real = rawget(_G, "loadfile")
rawset(_G, "loadfile", function(path, ...) remove_file(path); return lf_real(path, ...) end)
B.clock = 300
eq("vanish race: loop continues", M.run_loop(st, 3, 0), "ticks")
eq("vanish race: no backoff", st.bad_until, 0)
eq("vanish race: no save", FU.saves, 0)
rawset(_G, "loadfile", lf_real)
write_request({ id = "van2", op = "ping", session = "*" })
M.run_loop(st, 3, 0)
rid = decode_resp(rlb("RLBResp"))
eq("vanish race: next request answered at once", rid, "van2")
FU.saves = 0
write_request({ id = "e1", op = "run", session = st.session, code = 'error("bad")' })
eq("erroring chunk: loop continues", M.run_loop(st, 5, 0), "ticks")
rid, resp = decode_resp(rlb("RLBResp"))
check("erroring chunk: error envelope", rid == "e1" and resp.ok == false and resp.error:find("bad", 1, true) ~= nil, resp.error)
eq("erroring chunk: saved", FU.saves, 1)
write_request({ id = "mk", op = "run", session = st.session, max_kb = 2, code = 'return string.rep("z", 10000)' })
M.run_loop(st, 5, 0)
rid, resp = decode_resp(rlb("RLBResp"))
check("max_kb honoured", rid == "mk" and resp.truncated == true and resp.result_bytes == 10002, resp.result_bytes)
check("max_kb size", #unhex(tostring(rlb("RLBResp")):match("^[^:]*:(.*)$")) <= 2048)
RS.version_throws = true
FU.saves = 0
for i = 1, 3 do
  write_request({ id = "u" .. i, op = "run", session = st.session, code = 'error("x")' })
  local action = M.run_loop(st, 5, 0)
  if i < 3 then eq("strike " .. i, action, "ticks") else eq("strike 3: unreachable", action, "unreachable") end
end
eq("unreachable: only the three responses saved", FU.saves, 3)
RS.version_throws = false
st = fresh_start()
write_request({ id = "ok1", op = "run", session = st.session, code = "return 1" })
M.run_loop(st, 5, 0)
eq("strikes reset on success", st.strikes, 0)
write_request({ id = "st1", op = "stop", session = st.session })
eq("stop returns", M.run_loop(st, 5, 0), "stopped")
eq("stop: one save", FU.saves, 2)
rid, resp = decode_resp(rlb("RLBResp"))
check("stop response", rid == "st1" and resp.ok == true and resp.op == "stop", resp.error)
sess = session_table()
check("session stopped", sess.state == "stopped" and sess.session == st.session and type(sess.stopped) == "number")
st = fresh_start()
local other_hex = M.hex('{"session":"other","state":"running"}')
pset(PREFIX .. "RLBSession", other_hex)
write_request({ id = "st2", op = "stop", session = "*" })
eq("guarded stop returns", M.run_loop(st, 5, 0), "stopped")
eq("guarded stop: RLBSession untouched", rlb("RLBSession"), other_hex)
rid = decode_resp(rlb("RLBResp"))
eq("guarded stop: still answered", rid, "st2")
eq("guarded stop: one save", FU.saves, 1)

---------------------------------------------------------------------------
-- 18. the fake Fusion.prefs on disk
---------------------------------------------------------------------------
group("on-disk prefs")
st = fresh_start()
write_request({ id = "disk1", op = "run", session = st.session, code = 'return { s = "q\\"\\\\\\n\\té", n = { 1, 2 } }' })
M.run_loop(st, 5, 0)
local content = read_file(PREFS_FILE) or ""
local on_disk = content:match('%f[%w]RLBResp = "([^"]*)"')
check("RLBResp line found", on_disk ~= nil)
local did, dresp = decode_resp(on_disk or "")
eq("on-disk id", did, "disk1")
check("on-disk decodes", dresp and dresp.ok == true and dresp.result.s == 'q"\\\n\té' and dresp.result.n[2] == 2, dresp and dresp.result and dresp.result.s)
check("session line found", content:match('%f[%w]RLBSession = "%x+"') ~= nil)

---------------------------------------------------------------------------
-- Summary
---------------------------------------------------------------------------
real_print("")
for _, msg in ipairs(failures) do real_print("FAILED: " .. msg) end
real_print(string.format("RLB_TESTS_RESULT: %s (%d passed, %d failed) scratch=%s",
  fail == 0 and "PASS" or "FAIL", pass, fail, DIR))
os.exit(fail == 0 and 0 or 1)
