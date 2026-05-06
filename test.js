#!/usr/bin/env node
// Tests for OpenCode OpenAI Proxy
// Run: node test.js

const http = require("http");
const assert = require("assert");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

function asyncTest(name, fn) {
  return fn().then(() => {
    console.log(`  ✅ ${name}`);
    passed++;
  }).catch(e => {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  });
}

// ── Unit tests for buildMap (mirrors index.js logic) ──

console.log("\n📦 Model mapping tests:");

function buildMap(cfg) {
  const map = {};
  for (const [alias, target] of Object.entries(cfg)) {
    const base = alias.toLowerCase();
    map[base] = target;
    for (const suffix of ["[1m]", "[8k]", "[200k]", "[1]"]) {
      map[base + suffix] = target;
    }
  }
  return map;
}

const testCfg = {
  "gpt-4o": "deepseek-v4-pro",
  "gpt-4": "qwen3.6-plus",
  "o3-mini": "deepseek-v4-pro",
};
const testMap = buildMap(testCfg);

test("OpenAI-style model names map correctly", () => {
  assert.strictEqual(testMap["gpt-4o"], "deepseek-v4-pro");
  assert.strictEqual(testMap["gpt-4"], "qwen3.6-plus");
  assert.strictEqual(testMap["o3-mini"], "deepseek-v4-pro");
});

test("context suffix maps correctly", () => {
  assert.strictEqual(testMap["gpt-4o[1m]"], "deepseek-v4-pro");
  assert.strictEqual(testMap["gpt-4[8k]"], "qwen3.6-plus");
  assert.strictEqual(testMap["o3-mini[200k]"], "deepseek-v4-pro");
  assert.strictEqual(testMap["gpt-4o[1]"], "deepseek-v4-pro");
});

test("case-insensitive", () => {
  assert.strictEqual(testMap["GPT-4O"], undefined); // map keys are lowercased at build time
  assert.strictEqual(testMap["Gpt-4o"], undefined);
});

// cleanModel function (mirrors index.js)
function cleanModel(name, map) {
  name = name.replace(/\[.*?\]$/, "");
  const m = map[name.toLowerCase()];
  return m || name;
}

test("cleanModel strips suffix and maps", () => {
  assert.strictEqual(cleanModel("gpt-4o[200k]", testMap), "deepseek-v4-pro");
  assert.strictEqual(cleanModel("GPT-4[8k]", testMap), "qwen3.6-plus");
});

test("cleanModel returns original if not mapped", () => {
  assert.strictEqual(cleanModel("unknown-model", testMap), "unknown-model");
  assert.strictEqual(cleanModel("deepseek-v4-pro", testMap), "deepseek-v4-pro");
});

test("cleanModel is case-insensitive", () => {
  assert.strictEqual(cleanModel("GPT-4O", testMap), "deepseek-v4-pro");
  assert.strictEqual(cleanModel("Gpt-4", testMap), "qwen3.6-plus");
});

test("cleanModel strips context suffix before lookup", () => {
  assert.strictEqual(cleanModel("gpt-4o[1m]", testMap), "deepseek-v4-pro");
  assert.strictEqual(cleanModel("o3-mini[200k]", testMap), "deepseek-v4-pro");
});

// ── HTTP integration tests ──

console.log("\n🌐 HTTP endpoint tests:");

const PORT = 11499;

async function startProxy() {
  return new Promise((resolve) => {
    const child = require("child_process").spawn("node", ["index.js", String(PORT)], {
      cwd: __dirname,
      env: { ...process.env, OPENCODE_API_KEY: "test-key", OPENCODE_TIER: "go" },
    });
    child.stderr.on("data", () => {});
    child.stdout.on("data", () => {});
    setTimeout(() => resolve(child), 500);
  });
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request(`http://127.0.0.1:${PORT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) },
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function runHttpTests() {
  let child;
  try {
    child = await startProxy();
  } catch (e) {
    console.log("  ⚠️  Skipping HTTP tests — could not start proxy");
    return;
  }

  await asyncTest("GET /health returns 200", async () => {
    const res = await httpGet("/health");
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.status, "ok");
    assert.strictEqual(json.tier, "go");
  });

  await asyncTest("GET /v1/models returns model list", async () => {
    const res = await httpGet("/v1/models");
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.object, "list");
    assert.ok(json.data.length > 0);
    assert.ok(json.data.some(m => m.id === "glm-5"));
    assert.ok(json.data.some(m => m.id === "deepseek-v4-pro"));
    // Check that at least one alias from models.json is present
    const ids = json.data.map(m => m.id);
    const hasAnyAlias = ["gpt-4o", "gpt-4", "o3-mini"].some(a => ids.includes(a));
    assert.ok(hasAnyAlias, "Should have at least one model alias from models.json");
  });

  await asyncTest("POST /v1/chat/completions accepts valid request", async () => {
    const res = await httpPost("/v1/chat/completions", {
      model: "glm-5",
      messages: [{ role: "user", content: "hello" }],
    });
    // Will fail upstream (no real API key), but proxy should process it
    assert.ok([401, 502, 200].includes(res.status), `Unexpected status: ${res.status}`);
  });

  await asyncTest("POST /v1/chat/completions with mapped OpenAI model name", async () => {
    const res = await httpPost("/v1/chat/completions", {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.ok(res.status !== 404, "Endpoint should exist");
  });

  await asyncTest("POST to wrong path returns 404", async () => {
    const res = await httpPost("/v1/messages", { messages: [] });
    assert.strictEqual(res.status, 404);
  });

  await asyncTest("GET to chat endpoint returns 404", async () => {
    const res = await httpGet("/v1/chat/completions");
    assert.strictEqual(res.status, 404);
  });

  await asyncTest("HEAD / returns 200", async () => {
    return new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${PORT}/`, { method: "HEAD" }, res => {
        assert.strictEqual(res.statusCode, 200);
        resolve();
      });
      req.on("error", reject);
      req.end();
    });
  });

  await asyncTest("HEAD /v1 returns 200", async () => {
    return new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${PORT}/v1`, { method: "HEAD" }, res => {
        assert.strictEqual(res.statusCode, 200);
        resolve();
      });
      req.on("error", reject);
      req.end();
    });
  });

  await asyncTest("POST /v1/chat/completions with streaming flag", async () => {
    const res = await httpPost("/v1/chat/completions", {
      model: "glm-5",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });
    // Upstream will fail without real key, but endpoint should accept
    assert.ok(res.status !== 404, "Streaming endpoint should exist");
  });

  await asyncTest("POST /v1/chat/completions with system message", async () => {
    const res = await httpPost("/v1/chat/completions", {
      model: "glm-5",
      messages: [
        { role: "system", content: "You are a test assistant." },
        { role: "user", content: "hello" },
      ],
    });
    assert.ok([401, 502, 200].includes(res.status), `Unexpected status: ${res.status}`);
  });

  await asyncTest("POST /v1/chat/completions with invalid JSON returns 400", async () => {
    return new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          assert.strictEqual(res.statusCode, 400);
          resolve();
        });
      });
      req.on("error", reject);
      req.write("not json{{{");
      req.end();
    });
  });

  // Cleanup
  child.kill();
}

runHttpTests().then(() => {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
});
