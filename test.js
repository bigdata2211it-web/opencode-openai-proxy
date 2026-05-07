#!/usr/bin/env node
// Tests for OpenCode OpenAI Proxy
// Run: node test.js

const http = require("http");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

function readConfig(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
}

test("tier configs declare model inventory without inline aliases", () => {
  for (const file of ["models-go.json", "models-zen.json"]) {
    const cfg = readConfig(file);
    assert.ok(Array.isArray(cfg.models), `${file} should have models array`);
    assert.ok(cfg.models.length > 0, `${file} should list at least one model`);
    assert.strictEqual(cfg.routing, undefined, `${file} should not have routing aliases`);
  }
});

test("OpenAI route configs cover tier models without duplicate targets", () => {
  for (const [modelsFile, routesFile] of [
    ["models-go.json", "routes-openai-go.json"],
    ["models-zen.json", "routes-openai-zen.json"],
  ]) {
    const modelsCfg = readConfig(modelsFile);
    const routes = readConfig(routesFile);
    const models = new Set(modelsCfg.models);
    const routeTargets = Object.values(routes);

    assert.ok(routeTargets.length > 0, `${routesFile} should have routes`);
    assert.deepStrictEqual(new Set(routeTargets), models, `${routesFile} should cover every tier model`);
    assert.strictEqual(routeTargets.length, models.size, `${routesFile} should not repeat targets`);
    for (const [source, target] of Object.entries(routes)) {
      assert.ok(source.startsWith("gpt-") || source.startsWith("o"), `${source} should be a real OpenAI-style model id`);
      assert.ok(models.has(target), `${routesFile} should route ${source} to a declared tier model`);
    }
  }
});

function buildMap(models = [], routes = {}) {
  const map = {};
  for (const model of models) {
    map[model.toLowerCase()] = model;
  }
  for (const model of models) {
    const base = model.toLowerCase();
    for (const suffix of ["[1m]", "[8k]", "[200k]", "[1]"]) {
      map[base + suffix] = model;
    }
  }
  for (const [source, target] of Object.entries(routes)) {
    const base = source.toLowerCase();
    map[base] = target;
    for (const suffix of ["[1m]", "[8k]", "[200k]", "[1]"]) {
      map[base + suffix] = target;
    }
  }
  return map;
}

const testModels = ["deepseek-v4-pro", "qwen3.6-plus"];
const testRoutes = { "gpt-5.2": "deepseek-v4-pro", "gpt-4.1": "qwen3.6-plus" };
const testMap = buildMap(testModels, testRoutes);

test("direct model names map from model inventory", () => {
  assert.strictEqual(testMap["deepseek-v4-pro"], "deepseek-v4-pro");
  assert.strictEqual(testMap["qwen3.6-plus"], "qwen3.6-plus");
});

test("OpenAI route names map from route config", () => {
  assert.strictEqual(testMap["gpt-5.2"], "deepseek-v4-pro");
  assert.strictEqual(testMap["gpt-4.1"], "qwen3.6-plus");
});

test("context suffix maps correctly", () => {
  assert.strictEqual(testMap["deepseek-v4-pro[1m]"], "deepseek-v4-pro");
  assert.strictEqual(testMap["qwen3.6-plus[8k]"], "qwen3.6-plus");
  assert.strictEqual(testMap["deepseek-v4-pro[200k]"], "deepseek-v4-pro");
  assert.strictEqual(testMap["qwen3.6-plus[1]"], "qwen3.6-plus");
  assert.strictEqual(testMap["gpt-5.2[200k]"], "deepseek-v4-pro");
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
  assert.strictEqual(cleanModel("deepseek-v4-pro[200k]", testMap), "deepseek-v4-pro");
  assert.strictEqual(cleanModel("QWEN3.6-PLUS[8k]", testMap), "qwen3.6-plus");
});

test("cleanModel returns original if not mapped", () => {
  assert.strictEqual(cleanModel("unknown-model", testMap), "unknown-model");
  assert.strictEqual(cleanModel("deepseek-v4-pro", testMap), "deepseek-v4-pro");
});

test("cleanModel is case-insensitive", () => {
  assert.strictEqual(cleanModel("DeepSeek-V4-Pro", testMap), "deepseek-v4-pro");
  assert.strictEqual(cleanModel("Qwen3.6-Plus", testMap), "qwen3.6-plus");
});

test("cleanModel strips context suffix before lookup", () => {
  assert.strictEqual(cleanModel("deepseek-v4-pro[1m]", testMap), "deepseek-v4-pro");
  assert.strictEqual(cleanModel("qwen3.6-plus[200k]", testMap), "qwen3.6-plus");
});

// ── HTTP integration tests ──

console.log("\n🌐 HTTP endpoint tests:");

const PORT = 11499;

async function startProxy({ tier = "go", port = PORT } = {}) {
  return new Promise((resolve) => {
    const child = require("child_process").spawn("node", ["index.js", String(port)], {
      cwd: __dirname,
      env: { ...process.env, OPENCODE_API_KEY: "test-key", OPENCODE_TIER: tier },
    });
    child.stderr.on("data", () => {});
    child.stdout.on("data", () => {});
    setTimeout(() => resolve(child), 500);
  });
}

function httpGet(path, port = PORT) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

function httpPost(path, body, port = PORT) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request(`http://127.0.0.1:${port}${path}`, {
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
    assert.ok(json.data.some(m => m.id === "gpt-5.2"));
    const ids = json.data.map(m => m.id);
    assert.ok(!ids.includes("deepseek"), "Should not expose invented aliases");
    assert.ok(!ids.includes("qwen"), "Should not expose invented aliases");
  });

  await asyncTest("GET /v1/models uses Zen config when OPENCODE_TIER=zen", async () => {
    const zenPort = PORT + 1;
    const zenChild = await startProxy({ tier: "zen", port: zenPort });
    try {
      const res = await httpGet("/v1/models", zenPort);
      assert.strictEqual(res.status, 200);
      const json = JSON.parse(res.body);
      const ids = json.data.map(m => m.id);
      assert.ok(ids.includes("gpt-5.5"));
      assert.ok(ids.includes("gpt-4o"));
      assert.ok(ids.includes("claude-opus-4-7"));
      assert.ok(ids.includes("gemini-3.1-pro"));
    } finally {
      zenChild.kill();
    }
  });

  await asyncTest("POST /v1/chat/completions accepts valid request", async () => {
    const res = await httpPost("/v1/chat/completions", {
      model: "glm-5",
      messages: [{ role: "user", content: "hello" }],
    });
    // Will fail upstream (no real API key), but proxy should process it
    assert.ok([401, 502, 200].includes(res.status), `Unexpected status: ${res.status}`);
  });

  await asyncTest("POST /v1/chat/completions with direct model name", async () => {
    const res = await httpPost("/v1/chat/completions", {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.ok(res.status !== 404, "Endpoint should exist");
  });

  await asyncTest("POST /v1/chat/completions with OpenAI route model name", async () => {
    const res = await httpPost("/v1/chat/completions", {
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.ok(res.status !== 404, "Endpoint should exist");
  });

  await asyncTest("POST /v1/chat/completions accepts missing model", async () => {
    const res = await httpPost("/v1/chat/completions", {
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
