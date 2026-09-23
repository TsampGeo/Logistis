import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { decodeText, fetchAllowed, htmlToText, isPdf } from "./fetch.js";
import { classifyUrl, domainsFor } from "./sources.js";

export const INSTRUCTIONS = readFileSync(new URL("../instructions/logistis.el.md", import.meta.url), "utf8");

const DEFAULT_TZ = process.env.LOGISTIS_TIMEZONE ?? "Europe/Tirane";
const MAX_TEXT_CHARS = 60_000;

const TIER_LABEL = { primary: "Πρωτογενής (δεσμευτική)", secondary: "Δευτερογενής (συμπληρωματική)" } as const;

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function toolError(err: unknown) {
  return { ...text(err instanceof Error ? err.message : String(err)), isError: true };
}

function formatInZone(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "long",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const weekdayEl = new Intl.DateTimeFormat("el-GR", { timeZone, weekday: "long" }).format(date);
  return {
    date: `${parts.day}/${parts.month}/${parts.year}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: weekdayEl,
    utcOffset: parts.timeZoneName,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "logistis", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "current_datetime",
    {
      title: "Τρέχουσα ημερομηνία",
      description:
        "Returns today's date and time in the office time zone, plus yesterday and tomorrow as absolute dates (DD/MM/YYYY). Call before answering anything about deadlines or what is in force today.",
      inputSchema: { timezone: z.string().optional().describe(`IANA time zone. Default: ${DEFAULT_TZ}`) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ timezone }) => {
      const tz = timezone ?? DEFAULT_TZ;
      try {
        const now = new Date();
        const day = 24 * 60 * 60 * 1000;
        const today = formatInZone(now, tz);
        return text(
          JSON.stringify(
            {
              timezone: tz,
              today,
              yesterday: formatInZone(new Date(now.getTime() - day), tz).date,
              tomorrow: formatInZone(new Date(now.getTime() + day), tz).date,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "search_official_sources",
    {
      title: "Αναζήτηση σε επίσημες πηγές",
      description:
        "Web search restricted to approved Greek accounting/tax sources. scope=primary searches only binding sources (ΑΑΔΕ, ΦΕΚ, e-ΕΦΚΑ, ΕΡΓΑΝΗ, ministries); scope=secondary searches Taxheaven, Forin and ERP knowledge bases.",
      inputSchema: {
        query: z.string().min(2).describe("Search query, preferably in Greek"),
        scope: z.enum(["primary", "secondary", "all"]).default("primary"),
        count: z.number().int().min(1).max(20).default(10),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, scope, count }) => {
      const key = process.env.BRAVE_API_KEY;
      if (!key) {
        return toolError(
          "Η αναζήτηση δεν είναι ρυθμισμένη (λείπει BRAVE_API_KEY). Χρησιμοποίησε την αναζήτηση web της πλατφόρμας και μετά το fetch_official_source για ανάγνωση.",
        );
      }
      const sites = domainsFor(scope)
        .map((d) => `site:${d}`)
        .join(" OR ");
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", `${query} (${sites})`);
      url.searchParams.set("count", String(count));
      url.searchParams.set("search_lang", "el");
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json", "x-subscription-token": key },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);
        const data = (await res.json()) as {
          web?: { results?: { title: string; url: string; description?: string; age?: string }[] };
        };
        const results = (data.web?.results ?? [])
          .map((r) => ({ ...r, tier: classifyUrl(r.url) }))
          .filter((r) => r.tier !== null)
          .map((r) => ({
            title: r.title,
            url: r.url,
            source: TIER_LABEL[r.tier!],
            snippet: htmlToText(r.description ?? ""),
            age: r.age ?? null,
          }));
        return text(JSON.stringify({ query, scope, results }, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "fetch_official_source",
    {
      title: "Ανάγνωση επίσημης πηγής",
      description:
        "Fetches a web page or PDF from an approved source and returns its text, source tier, Last-Modified header and retrieval time. For PDFs, returns text per page; use `pages` to pick pages, then render_pdf_page for screenshots of critical pages.",
      inputSchema: {
        url: z.string().url(),
        pages: z
          .array(z.number().int().min(1))
          .max(30)
          .optional()
          .describe("PDF only: 1-based page numbers to return. Default: as many pages as fit."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, pages }) => {
      try {
        const doc = await fetchAllowed(url);
        const header = {
          url: doc.url,
          source: TIER_LABEL[doc.tier],
          last_modified: doc.lastModified,
          fetched_at: doc.fetchedAt,
        };
        if (isPdf(doc)) {
          const pdf = await getDocumentProxy(doc.body.slice());
          const { totalPages, text: pageTexts } = await extractText(pdf, { mergePages: false });
          const wanted = pages ?? pageTexts.map((_, i) => i + 1);
          let out = "";
          let included: number[] = [];
          for (const p of wanted) {
            if (p > totalPages) continue;
            const chunk = `\n\n--- Σελίδα ${p}/${totalPages} ---\n${pageTexts[p - 1]}`;
            if (out.length + chunk.length > MAX_TEXT_CHARS && included.length > 0) break;
            out += chunk;
            included.push(p);
          }
          const truncated = included.length < wanted.filter((p) => p <= totalPages).length;
          return text(
            JSON.stringify({ ...header, type: "pdf", total_pages: totalPages, pages_included: included, truncated }, null, 2) +
              out,
          );
        }
        const body = decodeText(doc);
        const content = doc.contentType.includes("html") || /^\s*</.test(body) ? htmlToText(body) : body;
        const truncated = content.length > MAX_TEXT_CHARS;
        return text(
          JSON.stringify({ ...header, type: "html", truncated }, null, 2) + "\n\n" + content.slice(0, MAX_TEXT_CHARS),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "render_pdf_page",
    {
      title: "Screenshot σελίδας PDF",
      description:
        "Renders pages of a PDF from an approved source as PNG images, so articles, tables and deadlines can be checked visually. Required before relying on a PDF.",
      inputSchema: {
        url: z.string().url(),
        pages: z.array(z.number().int().min(1)).min(1).max(5),
        scale: z.number().min(0.5).max(3).default(1.5),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, pages, scale }) => {
      try {
        const doc = await fetchAllowed(url);
        if (!isPdf(doc)) throw new Error(`Το ${doc.url} δεν είναι PDF.`);
        const pdf = await getDocumentProxy(doc.body.slice());
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
          {
            type: "text",
            text: JSON.stringify(
              { url: doc.url, source: TIER_LABEL[doc.tier], total_pages: pdf.numPages, fetched_at: doc.fetchedAt },
              null,
              2,
            ),
          },
        ];
        for (const p of pages) {
          if (p > pdf.numPages) {
            content.push({ type: "text", text: `Η σελίδα ${p} δεν υπάρχει (σύνολο ${pdf.numPages}).` });
            continue;
          }
          const png = await renderPageAsImage(pdf, p, { canvasImport: () => import("@napi-rs/canvas"), scale });
          content.push({ type: "text", text: `Σελίδα ${p}:` });
          content.push({ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" });
        }
        return { content };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerPrompt(
    "logistis",
    {
      title: "Λογιστής: οδηγίες λειτουργίας",
      description: "Loads the Logistis operating rules (sources, dates, answer structure) into the conversation.",
    },
    () => ({ messages: [{ role: "user", content: { type: "text", text: INSTRUCTIONS } }] }),
  );

  return server;
}
