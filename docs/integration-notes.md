# Integration Notes

This document explains how the **ReflectivAI Chat Widget** integrates a static GitHub Pages site with a Cloudflare Worker backend and modular AI components for pharma sales enablement. It reflects the updated ReflectivAI brand and minimises specific emotional intelligence messaging.

---

## Overview

The ReflectivAI site is hosted via **GitHub Pages** at  
`https://reflectivei.github.io/reflectiv-ai/`.

All chat functionality runs entirely on the **client side**, communicating with a Cloudflare Worker endpoint at  
`https://my-chat-agent.tonyabdelmalak.workers.dev/chat`  
(or another Worker URL you configure).

The Worker serves as a lightweight proxy to your chosen **LLM provider**  
(e.g., Groq, OpenRouter, or OpenAI), ensuring separation between presentation and inference layers.

---

## File Structure

The repository’s `reflectiv-ai` directory contains:

| Path | Purpose |
|------|---------|
| `index.html` | Entry point for the site and widget container. |
| `styles.css` / `script.js` | Define layout, theming, and base interactivity. |
| `assets/chat/` | Stores system prompts (`system.md`), persona data (`persona.json`), configuration (`config.json`), scenarios, and supporting scripts/styles. |
| `docs/` | Includes this integration guide and maintenance documentation. |

---

## Cloudflare Worker Deployment

1. **Set up Cloudflare Workers**  
   Ensure you have a Cloudflare account with Workers enabled.

2. **Deploy the Worker**  
   - Copy `assets/chat/worker.js` into a new Worker project.  
   - Set an environment variable:  
     ```
     UPSTREAM_ENDPOINT = https://my-chat-agent.tonyabdelmalak.workers.dev/chat
     ```  
     (or your own upstream LLM endpoint).  
   - Deploy and note the **public Worker URL**.

3. **Update configuration**  
   In `assets/chat/config.json`, set **one** of the following keys to your Worker URL:  
   - "apiBase": "https://<your-worker>/chat"  
   - or "workerEndpoint": "https://<your-worker>/chat"

The widget prefers `apiBase` when present; otherwise it uses `workerEndpoint`.

---

## GitHub Pages Setup

To publish the site:

1. In your GitHub repository, enable **GitHub Pages** under *Settings → Pages*.  
2. Choose the `main` branch (or `gh-pages`) and set the root directory to `/reflectiv-ai`.  
3. After saving, Pages will deploy to your configured GitHub Pages URL automatically.
