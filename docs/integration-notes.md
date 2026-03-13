# Integration Notes

This document explains how the **ReflectivAI Chat Widget** integrates a static GitHub Pages site with a Groq-backed Cloudflare Worker. It reflects the updated ReflectivAI brand and keeps the footprint small for a static deployment.

---

## Overview

The ReflectivAI site is hosted via **GitHub Pages** at
`https://tonyabdelmalak.github.io/`.

All chat functionality runs entirely on the **client side**, communicating with a Cloudflare Worker endpoint at
`https://my-chat-agent.tonyabdelmalak.workers.dev/chat`
(or another Worker URL you configure). The Worker proxies requests to Groq’s Chat Completions API.

---

## File Structure

The repository’s `reflectiv-ai` directory contains:

| Path | Purpose |
|------|---------|
| `index.html` | Entry point for the site and widget container. |
| `styles.css` / `script.js` | Define layout, theming, and base interactivity. |
| `assets/chat/` | Stores system prompt (`system.md`), configuration (`config.json`), scenarios, and supporting scripts/styles. |
| `cloudflare-worker/` | Houses the Worker source (`worker.js`) and `wrangler.toml`. Not served by Pages. |
| `docs/` | Includes this integration guide, changelog, and testing notes. |

---

## Cloudflare Worker Deployment

1. **Set up Cloudflare Workers**
   Ensure you have a Cloudflare account with Workers enabled and Wrangler installed (or use the dashboard editor).

2. **Configure the Worker**
   - Source lives in `cloudflare-worker/worker.js`; the Wrangler manifest is `cloudflare-worker/wrangler.toml`.
   - Environment variables (Workers → Settings → Variables):
     - `GROQ_API_KEY` — your Groq key (required).
     - `ALLOWED_ORIGINS` — comma-separated list of allowed Origins (e.g., `https://tonyabdelmalak.github.io`). Use `*` during testing if needed.

3. **Deploy the Worker**
   - Run `wrangler deploy` inside `cloudflare-worker/`, or paste `worker.js` into the Cloudflare dashboard and save.
   - Note the **public Worker URL**, e.g., `https://my-chat-agent.tonyabdelmalak.workers.dev/chat`.

4. **Update configuration**
   - In `assets/chat/config.json`, set `proxyUrl` to your Worker URL.

---

## GitHub Pages Setup

To publish the site:

1. In your GitHub repository, enable **GitHub Pages** under *Settings → Pages*.
2. Choose the `main` branch (or `gh-pages`) with the root directory.
3. After saving, Pages will deploy to `https://tonyabdelmalak.github.io` automatically.
