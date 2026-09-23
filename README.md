# Logistis (Λογιστής)

Greek accounting & tax assistant for Claude and ChatGPT. Answers are grounded in current primary sources (ΑΑΔΕ, ΦΕΚ, e-ΕΦΚΑ, ΕΡΓΑΝΗ) with exact dates, following the office's operating rules.

One MCP server powers both platforms:

```
instructions/logistis.el.md   ← operating rules (single source of truth)
src/                           ← MCP server (TypeScript)
plugin/                        ← Claude plugin: skill + MCP connection
.claude-plugin/marketplace.json
```

## Tools

| Tool | What it does |
| --- | --- |
| `current_datetime` | Today / yesterday / tomorrow as absolute dates in the office time zone |
| `search_official_sources` | Web search limited to approved sources (needs `BRAVE_API_KEY`) |
| `fetch_official_source` | Reads a page or PDF from an approved source, labelled primary or secondary |
| `render_pdf_page` | Screenshots of PDF pages (articles, tables, deadlines) |

Only allowlisted domains can be fetched (see `src/sources.ts`), and every redirect is re-checked.

## Develop

```bash
npm install
cp .env.example .env
npm run dev        # http://127.0.0.1:3000/mcp
npm test
npm run build      # compiles to dist/ and regenerates the Claude skill
```

Edit the rules in `instructions/logistis.el.md` only; `npm run sync-skill` copies them into `plugin/skills/logistis/SKILL.md`, and the server sends them as its MCP instructions and the `logistis` prompt.

## Deploy (Render)

The repo is a Render Blueprint (`render.yaml`): Docker, Starter plan, Frankfurt, redeployed after CI passes on `main`.

1. Generate an access key (keep it private; it becomes part of the URL):
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
2. Render dashboard → **New → Blueprint** → connect `TsampGeo/Logistis`.
3. When asked, paste the key into `LOGISTIS_ACCESS_KEY` and optionally a Brave key into `BRAVE_API_KEY`.
4. After the first deploy, the connector URL is:
   ```
   https://<service>.onrender.com/mcp/<LOGISTIS_ACCESS_KEY>
   ```
   Check `https://<service>.onrender.com/health` returns `{"ok":true}`.

Anyone with the full URL can use the server, so share it only inside the office. To revoke access, change `LOGISTIS_ACCESS_KEY` in Render and update the connectors.

## Use with Claude Code

```bash
claude plugin marketplace add TsampGeo/Logistis
claude plugin install logistis@logistis
```

The plugin connects to `LOGISTIS_MCP_URL` (default `http://127.0.0.1:3000/mcp`), so run the server locally or set the variable to the deployed URL including the key.

## Use with Claude.ai / Claude Desktop

Settings → Connectors → Add custom connector → the deployed URL `https://<service>.onrender.com/mcp/<key>`.

## Use with ChatGPT

ChatGPT needs a public HTTPS URL. Settings → Apps & Connectors → Advanced → Developer mode, then create an app with the deployed URL `https://<service>.onrender.com/mcp/<key>` (no authentication).
