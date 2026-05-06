# OpenCode OpenAI Proxy

OpenCode OpenAI Proxy is a small local bridge that lets OpenAI-compatible clients talk to **OpenCode Go** or **OpenCode Zen**.

It accepts OpenAI chat completion requests on `POST /v1/chat/completions`, maps model names, and forwards them to OpenCode Go's OpenAI-compatible API.

## What It Does

- Serves a local OpenAI-compatible API on `127.0.0.1:11434`.
- Accepts `POST /v1/chat/completions` in OpenAI format.
- Supports streaming and non-streaming responses.
- Maps client model names such as `gpt-4o`, `gpt-4`, and `o3-mini` to OpenCode models via `models.json`.
- Exposes `/health` for quick checks.
- Exposes `/v1/models` with OpenCode Go models and client aliases.
- Reads model aliases from `models.json` and reloads them when the file changes.
- Keeps the real OpenCode API key in `OPENCODE_API_KEY`, outside the repo.

## Why

OpenCode Go uses the OpenAI chat completions format. Some coding clients expect a local OpenAI-compatible endpoint with their own model names. This proxy sits between them:

```text
Cursor / VS Code / Any OpenAI client -> localhost:11434 -> OpenCode OpenAI Proxy -> OpenCode Go / Zen
```

## How Model Mapping Works

Clients send their normal model names:

- Cursor may send `gpt-4o` or `gpt-4`.
- VS Code extensions send whatever model they're configured for.
- Any OpenAI-compatible client works.

The proxy maps these to OpenCode Go models:

```text
gpt-4o -> models.json -> deepseek-v4-pro
gpt-4  -> models.json -> qwen3.6-plus
```

OpenCode Go never sees the original client model name. It receives a normal OpenAI-format request with the mapped model.

In short:

- Clients talk OpenAI format to localhost.
- The proxy maps model names and forwards as OpenAI.
- No format conversion needed — both sides speak OpenAI.

## Requirements

- Node.js 18 or newer.
- An OpenCode API key in `OPENCODE_API_KEY`.
- Subscription tier in `OPENCODE_TIER`: `go` (default) or `zen`.

## Quick Start

```bash
git clone https://github.com/bigdata2211it-web/opencode-openai-proxy.git
cd opencode-openai-proxy

cp .env.example .env
# Edit .env and set OPENCODE_API_KEY.

export OPENCODE_API_KEY=<your-opencode-key>
# Optional: switch from Go to Zen subscription (default: go)
export OPENCODE_TIER=zen
node index.js
```

The proxy starts on `http://127.0.0.1:11434` by default.

To use another port:

```bash
node index.js 11435
```

## Health Check

```bash
curl http://127.0.0.1:11434/health
```

## Client Setup

Point OpenAI-compatible clients at the local proxy:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:11434
export OPENAI_API_KEY=sk-dummy
```

Any model name the client sends will be mapped via `models.json`.

## Model Mapping

Edit `models.json` to choose which OpenCode model each OpenAI-style client model name should use:

```json
{
  "gpt-4o": "deepseek-v4-pro",
  "gpt-4": "qwen3.6-plus",
  "o3-mini": "deepseek-v4-pro"
}
```

The left side is what the local client sends. The right side is the OpenCode model sent upstream.

If a client sends an OpenCode model directly, and that name is not listed in `models.json`, the proxy forwards it as-is.

Common context suffixes are also accepted, for example `gpt-4o[200k]` or `o3-mini[8k]`.

Available OpenCode Go models:

```text
glm-5, glm-5.1, kimi-k2.5, kimi-k2.6, minimax-m2.5, minimax-m2.7,
deepseek-v4-flash, deepseek-v4-pro, qwen3.5-plus, qwen3.6-plus,
mimo-v2-pro, mimo-v2-omni, mimo-v2.5, mimo-v2.5-pro
```

## Endpoints

- `HEAD /` and `HEAD /v1` - connection checks.
- `GET /health` - proxy status.
- `GET /v1/models` - available models and aliases.
- `POST /v1/chat/completions` - OpenAI-compatible chat endpoint.

## Environment

Create a local `.env` from `.env.example`, or provide the variables another way:

```bash
OPENCODE_API_KEY=<your-opencode-key>
OPENCODE_TIER=go          # or: zen
```

Do not commit `.env`; it is ignored by git.

### Subscription Tiers

| Tier | `OPENCODE_TIER` | Endpoint | Pricing |
|------|-----------------|----------|----------|
| **Go** | `go` (default) | `https://opencode.ai/zen/go/v1/chat/completions` | $5 first month, then $10/month (flat) |
| **Zen** | `zen` | `https://opencode.ai/zen/v1/chat/completions` | Pay-as-you-go, no limits |

Both tiers use the same API key and the same set of open models (Qwen, GLM, Kimi, MiniMax, DeepSeek, MiMo).
Zen additionally provides Claude, GPT, Gemini, and several free models.

To switch tiers, change `OPENCODE_TIER` and restart the proxy.

## Updates and Contact

For free AI tools, news, and project updates, subscribe to the Telegram channel:

- https://t.me/gigaitools

For direct questions or feedback, message:

- https://t.me/xoskaz

## Notes

This project is intentionally small: one Node.js entrypoint, one model mapping file, and no external runtime dependencies.
Supports both OpenCode Go (flat subscription) and OpenCode Zen (pay-as-you-go) via `OPENCODE_TIER`.

## License

No public license has been selected yet. The repository is public, but reuse rights are not granted automatically.
