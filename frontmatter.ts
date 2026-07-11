import fs from "node:fs";

export type FrontmatterData = Record<string, unknown>;

export interface ParsedMarkdown {
  data: FrontmatterData;
  content: string;
}

function parseQuoted(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return parseQuoted(trimmed);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? inner.split(",").map((entry) => parseScalar(entry.trim())) : [];
  }
  return trimmed;
}

export function parseFrontmatter(source: string): ParsedMarkdown {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { data: {}, content: source };

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { data: {}, content: source };

  const lines = normalized.slice(4, end).split("\n");
  const data: FrontmatterData = {};

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match) continue;

    const [, key, rawValue = ""] = match;
    if (rawValue === ">" || rawValue === ">-") {
      const values: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) values.push(lines[++index].trim());
      data[key] = values.join(" ");
      continue;
    }
    if (rawValue === "|" || rawValue === "|-") {
      const values: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) values.push(lines[++index].replace(/^\s+/, ""));
      data[key] = values.join("\n");
      continue;
    }
    if (!rawValue && index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1])) {
      const values: unknown[] = [];
      while (index + 1 < lines.length) {
        const item = lines[index + 1].match(/^\s*-\s+(.*)$/);
        if (!item) break;
        index++;
        values.push(parseScalar(item[1]));
      }
      data[key] = values;
      continue;
    }
    data[key] = parseScalar(rawValue);
  }

  const bodyStart = normalized[end + 4] === "\n" ? end + 5 : end + 4;
  return { data, content: normalized.slice(bodyStart) };
}

function serializeValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.length === 0 ? ["[]"] : value.map((entry) => `  - ${JSON.stringify(entry)}`);
  }
  if (typeof value === "string") return [JSON.stringify(value)];
  return [JSON.stringify(value)];
}

export function stringifyFrontmatter(content: string, data: object): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const serialized = serializeValue(value);
    if (Array.isArray(value) && value.length > 0) {
      lines.push(`${key}:`, ...serialized);
    } else {
      lines.push(`${key}: ${serialized[0]}`);
    }
  }
  lines.push("---");
  return `${lines.join("\n")}\n${content.replace(/^\n+/, "")}`;
}

export function readFrontmatterFile(filePath: string): ParsedMarkdown {
  return parseFrontmatter(fs.readFileSync(filePath, "utf-8"));
}
