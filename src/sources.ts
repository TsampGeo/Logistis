export type SourceTier = "primary" | "secondary";

// Official, binding sources (legal basis).
export const PRIMARY_DOMAINS = [
  "aade.gr", // ΑΑΔΕ, eLib, myDATA
  "et.gr", // Εθνικό Τυπογραφείο / ΦΕΚ
  "efka.gov.gr", // e-ΕΦΚΑ
  "ypergasias.gov.gr", // Υπ. Εργασίας
  "eservices.yeka.gr", // ΕΡΓΑΝΗ
  "minfin.gov.gr", // Υπ. Οικονομικών
  "gsis.gr", // ΓΓΠΣΔΔ / TAXISnet
  "gov.gr", // gov.gr portal
];

// Interpretation and practical guidance only; never replaces the primary act.
export const SECONDARY_DOMAINS = [
  "taxheaven.gr",
  "forin.gr",
  "epsilonsmart.gr",
  "epsilonnet.gr",
  "pylonsupport.gr",
  "cluster.gr",
  "softone.gr",
  "entersoft.eu",
];

function matches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function classifyUrl(raw: string): SourceTier | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (PRIMARY_DOMAINS.some((d) => matches(host, d))) return "primary";
  if (SECONDARY_DOMAINS.some((d) => matches(host, d))) return "secondary";
  return null;
}

export function domainsFor(scope: "primary" | "secondary" | "all"): string[] {
  if (scope === "primary") return PRIMARY_DOMAINS;
  if (scope === "secondary") return SECONDARY_DOMAINS;
  return [...PRIMARY_DOMAINS, ...SECONDARY_DOMAINS];
}
