# OpenCode OpenAI Proxy

OpenCode OpenAI Proxy is a small local bridge that lets OpenAI-compatible clients talk to **OpenCode Go** or **OpenCode Zen**.

It accepts OpenAI chat completion requests on `POST /v1/chat/completions` and forwards them to OpenCode Go or Zen.

## What It Does

- Serves a local OpenAI-compatible API on `127.0.0.1:11435`.
- Accepts `POST /v1/chat/completions` in OpenAI format.
- Supports streaming and non-streaming responses.
- Exposes `/health` for quick checks.
- Exposes `/v1/models` with direct OpenCode models and optional OpenAI route model names.
- Reads model inventory from `models-go.json` or `models-zen.json`.
- Reads OpenAI model routing from `routes-openai-go.json` or `routes-openai-zen.json`.
- Keeps the real OpenCode API key in `OPENCODE_API_KEY`, outside the repo.

## Why

OpenCode Go and Zen use the OpenAI chat completions format. Some coding clients expect a local OpenAI-compatible endpoint. This proxy sits between them:

```text
Cursor / VS Code / Any OpenAI client -> localhost:11435 -> OpenCode OpenAI Proxy -> OpenCode Go / Zen
```

## How Models Work

Clients can send either direct OpenCode model IDs or real OpenAI model IDs from the route file:

- Cursor can send `deepseek-v4-pro`, `qwen3.6-plus`, `gpt-5.5`, or any model exposed by `/v1/models`.
- Cursor can also send routed OpenAI names such as `gpt-5.2`, `gpt-4.1`, or `o3`.
- VS Code extensions send whatever model ID they're configured for.
- Any OpenAI-compatible client works.

Direct OpenCode model IDs are forwarded as-is. OpenAI route model IDs are mapped through the selected `routes-openai-*.json` file.

In short:

- Clients talk OpenAI format to localhost.
- The proxy accepts direct Go/Zen model IDs and routed OpenAI model IDs.
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

The proxy starts on `http://127.0.0.1:11435` by default.

To use another port:

```bash
node index.js 11436
```

## Health Check

```bash
curl http://127.0.0.1:11435/health
```

## Client Setup

Point OpenAI-compatible clients at the local proxy:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:11435
export OPENAI_API_KEY=sk-dummy
```

Use one of the model IDs returned by `/v1/models`.

## Model Config

Edit `models-go.json` for `OPENCODE_TIER=go` or `models-zen.json` for `OPENCODE_TIER=zen`.
These files contain direct OpenCode model IDs:

```json
{
  "models": ["deepseek-v4-pro", "qwen3.6-plus"]
}
```

Edit `routes-openai-go.json` or `routes-openai-zen.json` to map real OpenAI model IDs to the active tier's models:

```json
{
  "gpt-5.2": "deepseek-v4-pro",
  "gpt-4.1": "qwen3.6-plus"
}
```

Route targets must exist in the matching `models-*.json`. The shipped route files cover every tier model once, without duplicate targets. Common context suffixes are accepted for both direct model IDs and routed OpenAI IDs, for example `deepseek-v4-pro[200k]` or `gpt-5.2[200k]`.

The shipped configs are based on the current OpenCode `/v1/models` endpoints:

- `models-go.json` covers OpenCode Go models.
- `models-zen.json` covers OpenCode Zen models.
- `routes-openai-go.json` maps real OpenAI model IDs to Go models.
- `routes-openai-zen.json` maps real OpenAI model IDs to Zen models.

## Endpoints

- `HEAD /` and `HEAD /v1` - connection checks.
- `GET /health` - proxy status.
- `GET /v1/models` - available direct models and OpenAI route names.
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

Both tiers use the same API key. Go and Zen model lists are kept separately in their JSON files, because OpenCode can change each tier independently.

To switch tiers, change `OPENCODE_TIER` and restart the proxy.

## Updates and Contact

For free AI tools, news, and project updates, subscribe to the Telegram channel:

- https://t.me/gigaitools

For direct questions or feedback, message:

- https://t.me/xoskaz

## Notes

This project is intentionally small: one Node.js entrypoint, tier-specific model config files, and no external runtime dependencies.
Supports both OpenCode Go (flat subscription) and OpenCode Zen (pay-as-you-go) via `OPENCODE_TIER`.

## License

No public license has been selected yet. The repository is public, but reuse rights are not granted automatically.
