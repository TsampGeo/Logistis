import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST || "127.0.0.1";
const allowedHosts = process.env.ALLOWED_HOSTS?.split(",")
  .map((h) => h.trim())
  .filter(Boolean);
// ChatGPT and Claude custom connectors accept either OAuth or no auth, so a secret URL path
// (/mcp/<key>) is the simplest way to keep a public deployment to the office.
const accessKey = process.env.LOGISTIS_ACCESS_KEY || "";
const mcpPath = accessKey ? "/mcp/:key" : "/mcp";

if (host !== "127.0.0.1" && host !== "localhost" && !accessKey) {
  console.warn("WARNING: listening publicly without LOGISTIS_ACCESS_KEY; anyone can use this server.");
}

const app = createMcpExpressApp({ host, allowedHosts: allowedHosts?.length ? allowedHosts : undefined });

// Cloud hosts sit behind one reverse proxy; trust it so rate limiting sees the real client IP.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function keyMatches(req: Request): boolean {
  if (!accessKey) return true;
  const given = Buffer.from(String(req.params.key ?? ""));
  const expected = Buffer.from(accessKey);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function jsonRpcError(res: Response, status: number, message: string) {
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

app.use(
  mcpPath,
  rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

// Stateless: a fresh server and transport per request, so it scales horizontally without sticky sessions.
app.post(mcpPath, async (req, res) => {
  if (!keyMatches(req)) return jsonRpcError(res, 404, "Not found.");
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.all(mcpPath, (req, res) => {
  if (!keyMatches(req)) return jsonRpcError(res, 404, "Not found.");
  jsonRpcError(res, 405, "Method not allowed.");
});

app.listen(port, host, () => {
  console.log(`Logistis MCP server on http://${host}:${port}${accessKey ? "/mcp/<access key>" : "/mcp"}`);
});
