# Integration Notes

This document outlines how the ReflectivEI AI widget integrates the static GitHub Pages site with the Cloudflare Worker backend and other components.

## Overview

The ReflectivEI site is served via GitHub Pages at `https://reflectivei.github.io/reflectiv-ai/`. The AI chat functionality lives entirely on the client side and communicates with a Cloudflare Worker hosted at `https://my-chat-agent.tonyabdelmalak.workers.dev/chat` (or another endpoint you specify). The Worker acts as a proxy to your chosen LLM provider.

## File Structure

The `reflectiv-ai` folder contains:

- `index.html` – entry point for the website.
- `styles.css` and `script.js` – site appearance and basic behaviour.
- `assets/chat` – chat engine assets including system prompts, persona metadata, configuration, the Worker script, widget scripts and styles, and scenario data.
- `docs` – this directory with maintenance and integration notes.

## Cloudflare Worker Deployment

1. Ensure you have a Cloudflare account with Workers enabled.
2. Copy `assets/chat/worker.js` into a new Cloudflare Worker. When creating the Worker:
   - Set an environment variable `UPSTREAM_ENDPOINT` to point to your AI provider or aggregator. In our example the default is `https://my-chat-agent.tonyabdelmalak.workers.dev/chat`.
   - Deploy the Worker and note its public URL.
3. Update `assets/chat/config.json` with the Worker URL under the `workerEndpoint` key.

The Worker simply forwards chat requests to the upstream provider. You can customise it to include authentication headers or to assemble system and persona prompts.

## GitHub Pages Configuration

The static site is served from the `reflectiv-ai` folder. To expose it via GitHub Pages:

1. In your repository settings, enable GitHub Pages on the `main` or `gh-pages` branch and set the root to `/reflectiv-ai`.
2. Ensure the domain `https://reflectivei.github.io/reflectiv-ai/` is registered in your DNS if using a custom domain.
3. After pushing changes, GitHub Pages may take a few minutes to deploy the updated files.

## Cross-Origin Resource Sharing (CORS)

The chat widget fetches files like `config.json` and `system.md` from the same origin. It communicates with the Cloudflare Worker on a different domain. The Worker must include an `Access-Control-Allow-Origin: *` header in its responses to permit browser requests from GitHub Pages. Modify your Worker script if necessary to add CORS headers.

## Markdown Parsing and Knowledge Updates

The widget reads `system.md` and `about-ei.md` as plain text. When updating these files, be mindful that Markdown formatting is not automatically rendered within chat responses. If you wish to use Markdown features in system prompts, you may need to adjust the Worker or the front‑end to render them.

## Future Extensions

This architecture is modular. You can plug in different personas, knowledge bases or simulation data by editing the files in `assets/chat`. To integrate new AI providers or add more advanced feedback generation, update the Worker and the client‑side logic accordingly.
