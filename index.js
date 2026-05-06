#!/usr/bin/env node
// ── OpenCode Go/Zen → OpenAI Format Proxy ──
// OpenAI-compatible client → OpenCode Go/Zen (OpenAI format)
// Usage: node index.js [port]
//
// Subscription: set OPENCODE_TIER=go (default) or OPENCODE_TIER=zen
// Models: edit models.json, then restart the proxy.

const PORT = process.argv[2] || 11435;
const TIER = (process.env.OPENCODE_TIER || "go").toLowerCase();
const BASE_URL = TIER === "zen" ? "https://opencode.ai/zen/v1" : "https://opencode.ai/zen/go/v1";
const CHAT_URL = BASE_URL + "/chat/completions";
const API_KEY = process.env.OPENCODE_API_KEY || (() => { console.error("ERROR: Set OPENCODE_API_KEY env var"); process.exit(1); })();
const CONFIG_PATH = __dirname + "/models.json";

const http = require("http");
const url = require("url");
const fs = require("fs");

// All available opencode-go models
const MODELS = [
  "glm-5", "glm-5.1",
  "kimi-k2.5", "kimi-k2.6",
  "minimax-m2.5", "minimax-m2.7",
  "deepseek-v4-flash", "deepseek-v4-pro",
  "qwen3.5-plus", "qwen3.6-plus",
  "mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5", "mimo-v2.5-pro",
];

// Build client model name -> target model map from models.json.
// Keys are explicit client model names, for example "gpt-4o" or "o3-mini".
function buildMap(cfg) {
  const map = {};
  for (const [alias, target] of Object.entries(cfg)) {
    const base = alias.toLowerCase();

    map[base] = target;

    // Common context suffixes used by local OpenAI-compatible clients.
    for (const suffix of ["[1m]", "[8k]", "[200k]", "[1]"]) {
      map[base + suffix] = target;
    }
  }
  return map;
}

let MAP = {};
function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    MAP = buildMap(cfg);
    console.log("📋 Models loaded from models.json:", JSON.stringify(cfg));
  } catch (e) {
    console.error("⚠️  Can't read models.json:", e.message, "— using defaults");
    MAP = { "gpt-4o": "glm-5", "gpt-4": "glm-5", "o3-mini": "glm-5" };
  }
}
loadConfig();

function cleanModel(name) {
  name = name.replace(/\[.*?\]$/, "");
  const m = MAP[name.toLowerCase()];
  return m || name;
}

// Watch config file for changes
fs.watchFile(CONFIG_PATH, () => {
  console.log("🔄 models.json changed — reloading...");
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
      all.push(id, id + "[1m]", id + "[8k]", id + "[200k]");
    }
    for (const alias of Object.keys(MAP)) {
      all.push(alias);
      // Only add context suffixes to bare aliases (not ones that already contain brackets)
      if (!alias.includes("[")) {
        all.push(alias + "[1m]", alias + "[8k]");
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [...new Set(all)].map(id => ({ id, object: "model", owned_by: "opencode-go" })) }));
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
      body.model = cleanModel(body.model || "deepseek-v4-pro");
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
