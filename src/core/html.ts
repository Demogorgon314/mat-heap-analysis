function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ParsedCell {
  html: string;
  text: string;
  lines: string[];
  firstLinkText: string | null;
  firstLinkHref: string | null;
  objectId: string | null;
  firstStrongText: string | null;
}

export interface ParsedTable {
  headers: string[];
  rows: ParsedCell[][];
}

export interface ParsedSection {
  heading: string;
  level: number;
  html: string;
  text: string;
  table: ParsedTable | null;
  preformatted: string | null;
}

export interface ParsedLink {
  href: string;
  text: string;
}

export function extractHtmlTitle(html: string): string | null {
  const match = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return match ? normalizeHtmlText(match[1]) : null;
}

export function extractHtmlLinks(html: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const pattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    links.push({
      href: match[1],
      text: normalizeHtmlText(match[2])
    });
  }
  return links;
}

export function extractSections(html: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const matches = Array.from(html.matchAll(pattern));

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const sectionStart = start + match[0].length;
    const sectionEnd = index + 1 < matches.length ? matches[index + 1].index ?? html.length : html.length;
    const sectionHtml = html.slice(sectionStart, sectionEnd);
    sections.push({
      heading: normalizeHtmlText(match[2]),
      level: Number.parseInt(match[1], 10),
      html: sectionHtml,
      text: normalizeHtmlText(sectionHtml),
      table: parseFirstTable(sectionHtml),
      preformatted: extractFirstPre(sectionHtml)
    });
  }

  return sections;
}

export function findSection(sections: ParsedSection[], heading: string): ParsedSection | null {
  const normalized = heading.trim().toLowerCase();
  return sections.find((section) => section.heading.trim().toLowerCase() === normalized) ?? null;
}

export function findSectionMatching(sections: ParsedSection[], pattern: RegExp): ParsedSection | null {
  return sections.find((section) => pattern.test(section.heading)) ?? null;
}

export function normalizeHtmlText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export function parseNumericValue(value: string): number | null {
  const normalized = value.replace(/[>,=%]/g, "").replace(/\s+/g, "").replace(/^\+/, "").replace(/,/g, "");
  if (normalized.length === 0 || normalized === "-" || normalized === "n/a") {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractObjectId(html: string): string | null {
  const match = /mat:\/\/object\/(0x[0-9a-fA-F]+)/.exec(html);
  return match ? match[1] : null;
}

export function extractFirstLink(html: string): ParsedLink | null {
  const match = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  if (!match) {
    return null;
  }
  return {
    href: match[1],
    text: normalizeHtmlText(match[2])
  };
}

export function extractFirstStrongText(html: string): string | null {
  const match = /<strong>([\s\S]*?)<\/strong>/i.exec(html);
  return match ? normalizeHtmlText(match[1]) : null;
}

function parseFirstTable(html: string): ParsedTable | null {
  const match = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!match) {
    return null;
  }
  return parseTable(match[0]);
}

function parseTable(tableHtml: string): ParsedTable | null {
  const headerMatch = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(tableHtml);
  const headers = headerMatch
    ? Array.from(headerMatch[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map((cell) => normalizeHtmlText(cell[1]))
    : [];

  const bodyMatch = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableHtml);
  const bodyHtml = bodyMatch ? bodyMatch[1] : tableHtml;
  const rowMatches = Array.from(bodyHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
  const rows = rowMatches.map((row) => {
    const cells = Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi));
    return cells.map((cell) => parseCell(cell[1]));
  });

  if (headers.length === 0 && rows.length === 0) {
    return null;
  }

  return {
    headers,
    rows
  };
}

function parseCell(cellHtml: string): ParsedCell {
  const text = normalizeHtmlText(cellHtml);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const link = extractFirstLink(cellHtml);
  return {
    html: cellHtml,
    text,
    lines,
    firstLinkText: link?.text ?? null,
    firstLinkHref: link?.href ?? null,
    objectId: extractObjectId(cellHtml),
    firstStrongText: extractFirstStrongText(cellHtml)
  };
}

function extractFirstPre(html: string): string | null {
  const match = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  return match ? normalizeHtmlText(match[1]) : null;
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return "\"";
      case "apos":
      case "#39":
        return "'";
      case "nbsp":
        return " ";
      default:
        if (entity.startsWith("#x")) {
          return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
        }
        if (entity.startsWith("#")) {
          return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
        }
        return full;
    }
  });
}

export function stripTreePrefix(value: string): string {
  return value.replace(new RegExp(`^[${escapeRegex("+.|\\\\")}[\\]\\s]+`), "").trim();
}
