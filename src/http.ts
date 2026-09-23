import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim());

const app = createMcpExpressApp({ host, allowedHosts });

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Stateless: a fresh server and transport per request, so it scales horizontally without sticky sessions.
app.post("/mcp", async (req, res) => {
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

app.all("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

app.listen(port, host, () => {
  console.log(`Logistis MCP server on http://${host}:${port}/mcp`);
});
