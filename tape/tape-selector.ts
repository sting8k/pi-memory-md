import fs from "node:fs";
import path from "node:path";
import { readFrontmatterFile } from "../frontmatter.js";
import { listMemoryFiles } from "../memoryMdCore.js";
import type { MemoryTapeService } from "./tape-service.js";
import type { TapeEntry } from "./tape-types.js";

const CHARS_PER_TOKEN = 4;

export interface TapeMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

function entryToMessage(entry: TapeEntry): TapeMessage | null {
  switch (entry.kind) {
    case "anchor":
    case "session/start":
      return {
        role: "assistant",
        content: `[Anchor: ${entry.payload.name}] ${JSON.stringify(entry.payload.state, null, 2)}`,
      };

    case "message/user":
      return { role: "user", content: entry.payload.content as string };

    case "message/assistant":
      return { role: "assistant", content: entry.payload.content as string };

    case "tool_call":
      return null; // Tool calls handled in pairs with results

    case "tool_result": {
      const callId = entry.payload.callId as string;
      const content =
        typeof entry.payload.result === "string" ? entry.payload.result : JSON.stringify(entry.payload.result);
      return { role: "tool", content: content.slice(0, 5000), tool_call_id: callId };
    }

    case "memory/read":
      return { role: "assistant", content: `[Memory Read] ${entry.payload.path}` };

    case "memory/write":
      return { role: "assistant", content: `[Memory Write] ${entry.payload.path}` };

    case "memory/search":
      return {
        role: "assistant",
        content: `[Memory Search] "${entry.payload.query}" returned ${entry.payload.count} results`,
      };

    default:
      return null;
  }
}

export function formatEntriesAsMessages(entries: TapeEntry[]): TapeMessage[] {
  const messages: TapeMessage[] = [];
  for (const entry of entries) {
    const msg = entryToMessage(entry);
    if (msg) messages.push(msg);
  }
  return messages;
}

function formatEntryLine(entry: TapeEntry): string | null {
  switch (entry.kind) {
    case "message/user":
    case "message/assistant": {
      const content = (entry.payload.content as string)?.substring(0, 80) ?? "";
      const truncated = content.length > 80 ? `${content}...` : content;
      return `${entry.kind === "message/user" ? "User" : "Assistant"}: ${truncated}`;
    }

    case "tool_call": {
      const argsStr = JSON.stringify(entry.payload.args).slice(0, 50);
      return `Tool: ${entry.payload.tool}(${argsStr})`;
    }

    case "tool_result": {
      const resultStr = JSON.stringify(entry.payload.result).slice(0, 50);
      return `Result: ${entry.payload.tool} -> ${resultStr}`;
    }

    case "memory/read":
      return `Memory read: ${entry.payload.path}`;

    case "memory/write":
      return `Memory write: ${entry.payload.path}`;

    case "memory/search":
      return `Memory search: ${entry.payload.query}`;

    case "anchor":
    case "session/start":
      return `-- Anchor: ${entry.payload.name ?? "checkpoint"} --`;

    default:
      return null;
  }
}

// ============================================================================
// Selectors
// ============================================================================

export class ConversationSelector {
  constructor(
    private tapeService: MemoryTapeService,
    private maxTokens = 1000,
    private maxEntries = 40,
  ) {}

  selectFromAnchor(anchorId?: string): TapeEntry[] {
    const entries = this.tapeService.query({ sinceAnchor: anchorId }).slice(-this.maxEntries);
    return this.filterByTokenBudget(entries);
  }

  buildFormattedContext(entries: TapeEntry[]): string {
    const lines = entries.map(formatEntryLine).filter((line): line is string => line !== null);
    return lines.length > 0 ? `${lines.join("\n")}\n\n---\n` : "";
  }

  private filterByTokenBudget(entries: TapeEntry[]): TapeEntry[] {
    let totalTokens = 0;
    const filtered: TapeEntry[] = [];

    for (const entry of entries) {
      const tokens = Math.ceil(JSON.stringify(entry.payload).length / CHARS_PER_TOKEN);
      if (totalTokens + tokens > this.maxTokens) break;
      filtered.push(entry);
      totalTokens += tokens;
    }

    return filtered;
  }
}

export class MemoryFileSelector {
  constructor(
    private tapeService: MemoryTapeService,
    private memoryDir: string,
  ) {}

  selectFilesForContext(strategy: "recent-only" | "smart", limit: number): string[] {
    return strategy === "recent-only" ? this.selectRecentOnly(limit) : this.selectSmart(limit);
  }

  private selectRecentOnly(limit: number): string[] {
    const entries = this.tapeService.query({ kinds: ["memory/read", "memory/write"] });
    const paths = new Set<string>();

    for (let i = entries.length - 1; i >= 0 && paths.size < limit; i--) {
      const entryPath = entries[i].payload.path as string;
      if (entryPath) paths.add(entryPath);
    }

    return Array.from(paths);
  }

  private selectSmart(limit: number): string[] {
    const anchor = this.tapeService.getLastAnchor();
    const entries = this.tapeService.query({ sinceAnchor: anchor?.id });
    const pathStats = this.analyzePathAccess(entries);
    const selected = new Set(this.tapeService.getAlwaysInclude());

    for (const entryPath of this.sortPathsByStats(pathStats)) {
      selected.add(entryPath);
      if (selected.size >= limit) break;
    }

    if (selected.size === 0) {
      for (const entryPath of this.scanMemoryDirectory(limit)) {
        selected.add(entryPath);
        if (selected.size >= limit) break;
      }
    }

    return Array.from(selected);
  }

  buildContextFromFiles(filePaths: string[]): string {
    if (filePaths.length === 0) return "";

    const lines = ["# Project Memory", "", "Available memory files (use memory_read to view full content):", ""];
    for (const relPath of filePaths) {
      const { id, kind, description, tags } = this.extractFrontmatter(relPath);
      lines.push(
        `- ${relPath}${id ? ` (@${id})` : ""}`,
        `  Kind: ${kind}`,
        `  Description: ${description}`,
        `  Tags: ${tags}`,
        "",
      );
    }

    return lines.join("\n");
  }

  private analyzePathAccess(entries: TapeEntry[]): Map<string, { count: number; lastAccess: number }> {
    const pathStats = new Map<string, { count: number; lastAccess: number }>();

    for (const entry of entries) {
      if (entry.kind !== "memory/read" && entry.kind !== "memory/write") continue;
      const entryPath = entry.payload.path as string;
      if (!entryPath) continue;

      const stats = pathStats.get(entryPath) ?? { count: 0, lastAccess: 0 };
      stats.count++;
      stats.lastAccess = Math.max(stats.lastAccess, new Date(entry.timestamp).getTime());
      pathStats.set(entryPath, stats);
    }

    return pathStats;
  }

  private sortPathsByStats(pathStats: Map<string, { count: number; lastAccess: number }>): string[] {
    return Array.from(pathStats.keys()).sort((a, b) => {
      const statsA = pathStats.get(a)!;
      const statsB = pathStats.get(b)!;
      return statsA.count !== statsB.count ? statsB.count - statsA.count : statsB.lastAccess - statsA.lastAccess;
    });
  }

  private scanMemoryDirectory(limit: number): string[] {
    return listMemoryFiles(this.memoryDir)
      .map((filePath) => {
        const { data } = readFrontmatterFile(filePath);
        const timestamp = Date.parse(String(data.updated ?? data.created ?? ""));
        return {
          relPath: path.relative(this.memoryDir, filePath),
          timestamp: Number.isNaN(timestamp) ? fs.statSync(filePath).mtimeMs : timestamp,
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp || a.relPath.localeCompare(b.relPath))
      .slice(0, limit)
      .map(({ relPath }) => relPath);
  }

  private extractFrontmatter(relPath: string): { id?: string; kind: string; description: string; tags: string } {
    const fullPath = path.join(this.memoryDir, relPath);
    try {
      const { data } = readFrontmatterFile(fullPath);
      return {
        id: typeof data.id === "string" ? data.id : undefined,
        kind: typeof data.kind === "string" ? data.kind : "legacy",
        description: (data.description as string)?.trim() || "No description",
        tags: Array.isArray(data.tags) && data.tags.length > 0 ? data.tags.join(", ") : "none",
      };
    } catch {
      return { kind: "legacy", description: "No description", tags: "none" };
    }
  }
}
