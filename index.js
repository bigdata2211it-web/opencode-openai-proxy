#!/usr/bin/env node
// ── OpenCode Go/Zen → OpenAI Format Proxy ──
// OpenAI-compatible client → OpenCode Go/Zen (OpenAI format)
// Usage: node index.js [port]
//
// Subscription: set OPENCODE_TIER=go (default) or OPENCODE_TIER=zen
// Models: edit models-go.json or models-zen.json, then restart the proxy.

const PORT = process.argv[2] || 11435;
const TIER = (process.env.OPENCODE_TIER || "go").toLowerCase();
const BASE_URL = TIER === "zen" ? "https://opencode.ai/zen/v1" : "https://opencode.ai/zen/go/v1";
const CHAT_URL = BASE_URL + "/chat/completions";
const API_KEY = process.env.OPENCODE_API_KEY || (() => { console.error("ERROR: Set OPENCODE_API_KEY env var"); process.exit(1); })();
const CONFIG_PATH = TIER === "zen" ? __dirname + "/models-zen.json" : __dirname + "/models-go.json";
const ROUTES_PATH = TIER === "zen" ? __dirname + "/routes-openai-zen.json" : __dirname + "/routes-openai-go.json";

const http = require("http");
const url = require("url");
const fs = require("fs");

// Build direct model name -> model map from the tier config.
function buildMap(models = [], routes = {}) {
  const map = {};
  for (const model of models) {
    const base = model.toLowerCase();
    map[base] = model;

    // Common context suffixes used by local OpenAI-compatible clients.
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

let MAP = {};
let MODELS = [];
let ROUTES = {};

function readTierConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!Array.isArray(cfg.models) || cfg.models.length === 0) {
    throw new Error("missing non-empty models array");
  }
  if (Object.prototype.hasOwnProperty.call(cfg, "routing")) {
    throw new Error("inline routing is not supported; use routes-openai-*.json");
  }
  return cfg;
}

function readRouteConfig(models) {
  const routes = JSON.parse(fs.readFileSync(ROUTES_PATH, "utf8"));
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) {
    throw new Error("routes file must be an object");
  }
  const modelSet = new Set(models);
  const targets = Object.values(routes);
  for (const [source, target] of Object.entries(routes)) {
    if (!source.startsWith("gpt-") && !source.startsWith("o")) {
      throw new Error(`route ${source} is not an OpenAI-style model id`);
    }
    if (!modelSet.has(target)) {
      throw new Error(`route ${source} points to unknown model ${target}`);
    }
  }
  if (new Set(targets).size !== targets.length) {
    throw new Error("routes file has duplicate targets");
  }
  return routes;
}

function loadConfig({ exitOnError = false } = {}) {
  try {
    const cfg = readTierConfig();
    MODELS = [...new Set(cfg.models)];
    ROUTES = readRouteConfig(MODELS);
    MAP = buildMap(MODELS, ROUTES);
    console.log(`📋 Models loaded from ${CONFIG_PATH.split("/").pop()} + ${ROUTES_PATH.split("/").pop()}:`, JSON.stringify({ models: MODELS, routes: ROUTES }));
  } catch (e) {
    console.error(`⚠️  Can't read model config:`, e.message);
    if (exitOnError) process.exit(1);
  }
}
loadConfig({ exitOnError: true });

function cleanModel(name) {
  name = name.replace(/\[.*?\]$/, "");
  const m = MAP[name.toLowerCase()];
  return m || name;
}

// Watch config file for changes
fs.watchFile(CONFIG_PATH, () => {
  console.log(`🔄 ${CONFIG_PATH.split("/").pop()} changed — reloading...`);
  loadConfig();
});
fs.watchFile(ROUTES_PATH, () => {
  console.log(`🔄 ${ROUTES_PATH.split("/").pop()} changed — reloading...`);
  loadConfig();
});

function handleRequest(req, res) {
  const { pathname } = url.parse(req.url);

  // HEAD check
  if ((pathname === "/v1" || pathname === "/v1/" || pathname === "/") && req.method === "HEAD") {
    res.writeHead(200); res.end(); return;
  }

  // Health
  if (pathname === "/health" || pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", tier: TIER, base: BASE_URL, chat: CHAT_URL, port: PORT }));
    return;
  }

  // Models endpoint
  if (pathname === "/v1/models" && req.method === "GET") {
    const all = [];
    for (const id of MODELS) {
      all.push(id);
      // Only add context suffixes for Go tier (fewer models)
      if (TIER !== "zen") {
        all.push(id + "[1m]", id + "[8k]", id + "[200k]");
      }
    }
    for (const id of Object.keys(MAP)) all.push(id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [...new Set(all)].map(id => ({ id, object: "model", owned_by: TIER === "zen" ? "opencode-zen" : "opencode-go" })) }));
    return;
  }

  // Chat completions endpoint (handle double-prefix /v1/v1/chat/completions too)
  const cleanPath = pathname.replace(/^\/v1\/v1\//, "/v1/");
  if (cleanPath !== "/v1/chat/completions" || req.method !== "POST") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found. Use POST /v1/chat/completions");
    return;
  }

  let rawBody = "";
  req.on("data", c => rawBody += c);
  req.on("end", () => {
    try {
      const body = JSON.parse(rawBody);
      // Map model name
      body.model = cleanModel(body.model || MODELS[0]);
      const isStream = !!body.stream;

      fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
      }).then(async upstreamRes => {
        if (!upstreamRes.ok) {
          const errText = await upstreamRes.text();
          res.writeHead(upstreamRes.status, { "Content-Type": "application/json" });
          res.end(errText);
          return;
        }

        // Non-streaming: pass through JSON as-is
        if (!isStream) {
          const data = await upstreamRes.json();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
          return;
        }

        // Streaming: pipe SSE directly (both sides use OpenAI SSE format)
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });

        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        async function readStream() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              res.write(line + "\n");
            }
          }
        }
        readStream().catch(err => {
          console.error("[proxy] stream error:", err.message);
          res.end();
        });

      }).catch(err => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: err.message, type: "upstream_error" } }));
      });
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message, type: "invalid_request" } }));
    }
  });
}

const server = http.createServer(handleRequest);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`🚀 OpenAI → OpenCode ${TIER.toUpperCase()} proxy on http://127.0.0.1:${PORT}`);
  console.log(`   Upstream: ${CHAT_URL}`);
  console.log(`   Available: ${MODELS.join(", ")}`);
});
