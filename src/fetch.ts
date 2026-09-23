import { classifyUrl, type SourceTier } from "./sources.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

export interface FetchedDocument {
  url: string;
  tier: SourceTier;
  contentType: string;
  lastModified: string | null;
  fetchedAt: string;
  body: Uint8Array;
}

// Follows redirects by hand so every hop is checked against the allowlist.
export async function fetchAllowed(rawUrl: string): Promise<FetchedDocument> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const tier = classifyUrl(current);
    if (!tier) {
      throw new Error(`Ο ιστότοπος δεν είναι στις εγκεκριμένες πηγές: ${current}`);
    }
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "Logistis/0.1 (+https://github.com/TsampGeo/Logistis)" },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Ανακατεύθυνση χωρίς προορισμό από ${current}`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} από ${current}`);

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error(`Το αρχείο είναι πολύ μεγάλο (${declared} bytes)`);
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.byteLength > MAX_BYTES) throw new Error(`Το αρχείο είναι πολύ μεγάλο (${body.byteLength} bytes)`);

    return {
      url: current,
      tier,
      contentType: res.headers.get("content-type") ?? "",
      lastModified: res.headers.get("last-modified"),
      fetchedAt: new Date().toISOString(),
      body,
    };
  }
  throw new Error(`Πάρα πολλές ανακατευθύνσεις για ${rawUrl}`);
}

export function isPdf(doc: FetchedDocument): boolean {
  if (doc.contentType.includes("application/pdf")) return true;
  // Some government servers send PDFs as octet-stream; check the magic bytes.
  return doc.body[0] === 0x25 && doc.body[1] === 0x50 && doc.body[2] === 0x44 && doc.body[3] === 0x46;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeText(doc: FetchedDocument): string {
  // Older Greek government pages still use windows-1253 / iso-8859-7, often declared only in a <meta> tag.
  const head = new TextDecoder("latin1").decode(doc.body.subarray(0, 4096));
  const declared =
    /charset=["']?([\w-]+)/i.exec(doc.contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  try {
    return new TextDecoder(declared?.toLowerCase() ?? "utf-8").decode(doc.body);
  } catch {
    return new TextDecoder("utf-8").decode(doc.body);
  }
}
