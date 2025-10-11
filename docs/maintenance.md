# Maintenance Guide

This document describes how to maintain and update the ReflectivAI site and chat widget. It reflects the updated ReflectivAI brand and minimises references to emotional intelligence.

---

## Overview

The site is hosted via **GitHub Pages** at `https://reflectivei.github.io/reflectiv-ai/` and uses a Cloudflare Worker to interface with your chosen LLM provider. All chat functionality runs on the client side.

---

## Updating the Widget

- **Add new scenarios or persona data**: modify files in `assets/chat/` such as `system.md`, `persona.json`, or the scenarios file.
- **Adjust configuration**: update keys in `assets/chat/config.json`.
- **Style tweaks**: modify `widget.css` for the chat container or `styles.css` for site-level themes.

---

## Updating the Worker

- Make changes to `assets/chat/worker.js` and redeploy your Cloudflare Worker.
- If the upstream LLM provider changes, update the `UPSTREAM_ENDPOINT` environment variable and redeploy.

---

## Redeploying GitHub Pages

After committing changes to the repository (on the branch configured for GitHub Pages), the site will automatically redeploy. To trigger a redeployment manually, you can rerun the build-and-deploy workflow under the **Actions** tab.

---

## Additional Resources

See `integration-notes.md` for full integration steps and environment configuration details.
