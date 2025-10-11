
# Maintenance Guide

This document provides guidance for administrators maintaining the ReflectivEI AI Sales Enablement platform. It covers updating data sets, configuring the chat engine, changing brand settings and deploying changes via GitHub Pages.

## Updating Scenario Data

The sales simulation uses pre‑defined healthcare provider scenarios stored in `assets/chat/data/hcp_scenarios.txt`. Each scenario begins with a line like `# Scenario: KeyName` followed by key–value pairs for `HCP_Type`, `Background` and `Goal for Today`.

To add or edit scenarios:

1. Open `reflectiv-ai/assets/chat/data/hcp_scenarios.txt` in a text editor.
2. Follow the existing format, ensuring each scenario starts with `# Scenario:` followed by unique identifier.
3. Save the file and commit your changes. The widget will automatically parse new scenarios on page load.

## Refreshing the Worker Endpoint

The chat widget forwards user messages to a backend AI through a Cloudflare Worker. The worker endpoint is defined in `assets/chat/config.json` under the `workerEndpoint` key. To update it:

1. Open `reflectiv-ai/assets/chat/config.json`.
2. Modify the `workerEndpoint` value to the new URL.
3. If you run your own Cloudflare Worker, set the `UPSTREAM_ENDPOINT` environment variable there to forward to your preferred model provider.

## Editing Brand or Model Settings

Brand colours, button styles and radius values are set in `assets/chat/config.json` and referenced in CSS variables. To adjust the appearance of the widget:

1. Update the values in the `brand` section of `config.json`.
2. Adjust global styles in `styles.css` and the widget styles in `assets/chat/widget.css` if necessary.

Model routing is specified under the `model` key. The `primary` field selects the default provider (e.g., `groq`), and `fallback` defines the backup. Changing these values may require updates to your Cloudflare Worker and account credentials.

## Deploying Changes via GitHub Pages

1. Commit your changes to the `reflectiv-ai` folder in the repository.
2. Ensure the `index.html` file remains at the root of the `reflectiv-ai` directory, as GitHub Pages serves from this location.
3. Push your changes to the `main` branch (or a branch configured for GitHub Pages) of the `reflectivei` repository. If you have configured a separate `gh-pages` branch, ensure that branch contains the contents of `reflectiv-ai`.
4. After pushing, visit `https://reflectivei.github.io/reflectiv-ai/` to verify your updates. It may take a few minutes for GitHub Pages to rebuild.

## Troubleshooting

- **Widget fails to load:** Check the browser console for network errors. Ensure that `config.json`, `system.md` and other assets are being served correctly and that the `workerEndpoint` is reachable.
- **AI responses not returned:** Verify that the Cloudflare Worker is operational and that any model API keys or environment variables are correct. Use the fallback provider if the primary fails.
- **Styling issues:** Clear your browser cache or perform a hard refresh (Ctrl/Cmd+Shift+R) to load the latest CSS files.
