import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  addConceptAlias,
  buildStructuredMemoryContent,
  createDefaultFiles,
  deleteMemoryFile,
  ensureDirectoryStructure,
  expandConceptSearchFamilies,
  formatMemoryRead,
  getCurrentDate,
  getMemoryCatalog,
  getMemoryDir,
  gitExec,
  listMemoryFiles,
  memoryFileFromCatalogEntry,
  migrateMemoryProject,
  normalizeConceptSearchQuery,
  normalizeMemoryConcepts,
  readMemoryFile,
  resolveMemoryFile,
  resolveMemoryPath,
  resolveMemoryWriteTarget,
  syncRepository,
  upsertMemoryCatalog,
  validateMemoryContent,
  writeMemoryFile,
} from "./memoryMdCore.js";
import { type SearchField, searchMemoryFiles } from "./search-engine.js";
import type {
  ConceptDuplicateHint,
  MemoryFrontmatter,
  MemoryMdSettings,
  MemoryReadView,
  StructuredMemoryFields,
} from "./types.js";

// Re-export types for convenience
export type { ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
export type { MemoryFrontmatter, MemoryMdSettings } from "./types.js";

// ============================================================================
// Render Utilities - Inline for simplicity
// ============================================================================

function renderText(text: string): Text {
  return new Text(text, 0, 0);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value.includes(" ") ? `"${value}"` : value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "object" && value !== null) return "{...}";
  return String(value);
}

function buildToolCallText(name: string, args: Record<string, unknown>, theme: Theme): string {
  const text = theme.fg("toolTitle", theme.bold(name));
  const entries = Object.entries(args).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return text;
  const preferred = entries.find(([k]) => k === "path" || k === "action" || k === "from" || k === "to") || entries[0];
  return `${text} ${theme.fg("accent", formatValue(preferred[1]))}`;
}

function getResultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

function formatConceptDuplicateHints(hints?: ConceptDuplicateHint[]): string {
  if (!hints?.length) return "";
  return [
    "Possible duplicate concepts:",
    ...hints.map((hint) => `- ${hint.concept} is similar to ${hint.candidate} (${hint.score})`),
  ].join("\n");
}

const SENSITIVE_MEMORY_PATTERN =
  /\b(?:api[-_\s]?key|credential|identity[-_\s]?file|password|passwd|private[-_\s]?key|secret|ssh|(?:api|access|auth|bearer|refresh|session|oauth)[-_\s]?token|token\s*[=:]\s*\S+)\b/i;

function hasSensitiveMemoryInput(value: unknown): boolean {
  if (typeof value === "string") return SENSITIVE_MEMORY_PATTERN.test(value);
  if (Array.isArray(value)) return value.some((entry) => hasSensitiveMemoryInput(entry));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(
      ([key, entry]) => SENSITIVE_MEMORY_PATTERN.test(key) || hasSensitiveMemoryInput(entry),
    );
  }
  return false;
}

function formatMemoryWriteWarnings(warnings: string[]): string {
  if (warnings.length === 0) return "";
  return ["Memory write warnings:", ...warnings.map((warning) => `- ${warning}`)].join("\n");
}

function buildMemoryWriteWarnings(input: {
  summary?: string;
  claims?: string[];
  facts?: Record<string, unknown>;
  content?: string;
  finalSensitive: boolean;
  detectedSensitive: boolean;
  hygieneWarnings?: string[];
}): string[] {
  const warnings: string[] = [];
  if (input.hygieneWarnings?.length) warnings.push(...input.hygieneWarnings);
  if (!input.summary?.trim()) warnings.push("Add a one-sentence summary so future searches do not need full prose.");
  if (!input.claims?.length && Object.keys(input.facts ?? {}).length === 0) {
    warnings.push("Add at least one claim or fact for durable retrieval.");
  }
  if (input.content && input.content.length > 800) {
    warnings.push("Raw content is long; prefer structured fields plus short notes.");
  }
  if (input.detectedSensitive) {
    warnings.push("Sensitive-looking content was marked sensitive and will not be injected automatically.");
  } else if (input.finalSensitive) {
    warnings.push("Sensitive record will not be injected automatically.");
  }
  return warnings;
}

type MemoryOverwriteDiffSummary = {
  oldStart: number;
  newStart: number;
  oldLines: string[];
  newLines: string[];
  additions: number;
  removals: number;
  lineRange: string;
  text: string;
};

function splitMarkdownLines(text: string): string[] {
  return text.split("\n");
}

function formatMemoryOverwriteLineRange(
  diff: Pick<MemoryOverwriteDiffSummary, "oldStart" | "newStart" | "oldLines" | "newLines">,
): string {
  const oldEnd = diff.oldStart + Math.max(0, diff.oldLines.length - 1);
  if (diff.oldLines.length <= 1 && diff.newLines.length <= 1) return `:${diff.oldStart}`;
  const newEnd = diff.newStart + Math.max(0, diff.newLines.length - 1);
  return `:${diff.oldStart}-${Math.max(oldEnd, newEnd)}`;
}

function formatMemoryOverwriteDiff(
  diff: Pick<MemoryOverwriteDiffSummary, "lineRange" | "oldLines" | "newLines">,
): string {
  return [
    "── diff ──",
    diff.lineRange,
    ...diff.oldLines.map((line) => `- ${line}`),
    ...diff.newLines.map((line) => `+ ${line}`),
  ].join("\n");
}

function buildMemoryOverwriteDiff(beforeRaw: string, afterRaw: string): MemoryOverwriteDiffSummary | undefined {
  const before = splitMarkdownLines(beforeRaw);
  const after = splitMarkdownLines(afterRaw);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  if (prefix === before.length && prefix === after.length) return undefined;

  const diff = {
    oldStart: prefix + 1,
    newStart: prefix + 1,
    oldLines: before.slice(prefix, before.length - suffix),
    newLines: after.slice(prefix, after.length - suffix),
  };
  const lineRange = formatMemoryOverwriteLineRange(diff);
  const summary = {
    ...diff,
    additions: diff.newLines.length,
    removals: diff.oldLines.length,
    lineRange,
    text: "",
  };
  summary.text = formatMemoryOverwriteDiff(summary);
  return summary;
}

function renderMemoryDiffLine(theme: Theme, line: string): string {
  if (line === "── diff ──") return theme.fg("muted", "diff");
  if (/^:\d+(?:-\d+)?$/.test(line)) return theme.fg("muted", line);
  if (line.startsWith("+ ")) return theme.fg("success", line);
  if (line.startsWith("- ")) return theme.fg("error", line);
  return theme.fg("toolOutput", line);
}

function renderMemoryOutput(text: string, diff: MemoryOverwriteDiffSummary | undefined, theme: Theme): string {
  if (!diff) return theme.fg("toolOutput", text);
  let inDiff = false;
  return text
    .split("\n")
    .map((line) => {
      if (line === "── diff ──") {
        inDiff = true;
        return renderMemoryDiffLine(theme, line);
      }
      if (inDiff && line === "") {
        inDiff = false;
        return theme.fg("toolOutput", line);
      }
      return inDiff ? renderMemoryDiffLine(theme, line) : theme.fg("toolOutput", line);
    })
    .join("\n");
}

function buildExpandHint(totalLines: number, theme: Theme): string {
  const remaining = totalLines - 1;
  if (remaining <= 0) return "";
  return (
    "\n" +
    theme.fg("muted", `... (${remaining} more lines,`) +
    " " +
    keyHint("app.tools.expand", "to expand") +
    theme.fg("muted", ")")
  );
}

function renderCollapsed(summary: string, fullText: string, options: { expanded: boolean }, theme: Theme): Text {
  if (options.expanded) return renderText(theme.fg("toolOutput", fullText));
  return renderText(theme.fg("success", summary) + buildExpandHint(fullText.split("\n").length, theme));
}

function renderMemoryResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  defaults?: { description?: string; tags?: string[]; notice?: string; diff?: MemoryOverwriteDiffSummary },
): Text {
  if (options.isPartial) return renderText(theme.fg("warning", "Reading..."));
  const details = result.details as
    | { error?: boolean; frontmatter?: { description?: string; tags?: string[] }; diff?: MemoryOverwriteDiffSummary }
    | undefined;
  if (details?.error) return renderText(theme.fg("error", getResultText(result) || "Error"));

  const description = defaults?.description || details?.frontmatter?.description || "Memory file";
  const tags = defaults?.tags || details?.frontmatter?.tags || [];
  const text = getResultText(result);
  const notice = defaults?.notice;
  const diff = defaults?.diff ?? details?.diff;
  const overwriteStats = diff
    ? `${theme.fg("success", `+${diff.additions}`)}${theme.fg("muted", " / ")}${theme.fg("error", `-${diff.removals}`)}${theme.fg("muted", " overwrite")}`
    : "";

  if (!options.expanded) {
    const summary = [
      theme.fg("success", description),
      overwriteStats,
      theme.fg("muted", `Tags: ${tags.join(", ") || "none"}`),
      notice ? theme.fg("warning", notice) : "",
    ]
      .filter(Boolean)
      .join("\n");
    return renderText(summary + buildExpandHint(text.split("\n").length + 1, theme));
  }

  return renderText(
    theme.fg("success", description) +
      `\n${theme.fg("muted", `Tags: ${tags.join(", ") || "none"}`)}${notice ? `\n${theme.fg("warning", notice)}` : ""}\n${renderMemoryOutput(text, diff, theme)}`,
  );
}

function renderSyncResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
): Text {
  if (options.isPartial) return renderText(theme.fg("warning", "Syncing..."));
  const details = result.details as { success?: boolean; initialized?: boolean; timeout?: boolean } | undefined;
  if (details?.initialized === false) return renderText(theme.fg("muted", "Not initialized"));
  if (details?.timeout) return renderText(theme.fg("error", getResultText(result)));

  const text = getResultText(result);
  if (!options.expanded) {
    const lines = text.split("\n");
    if (details?.success === false) {
      return renderText(theme.fg("error", lines[0] || "Operation failed") + buildExpandHint(lines.length, theme));
    }
    const summary = details?.success
      ? theme.fg("success", lines[0] || "Success")
      : theme.fg("success", lines[0] || "Status");
    return renderText(summary + buildExpandHint(lines.length, theme));
  }
  return renderText(theme.fg("toolOutput", text));
}

function renderCountResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  label: string,
): Text {
  if (options.isPartial) return renderText(theme.fg("warning", "Loading..."));
  const details = result.details as { count?: number } | undefined;
  const text = getResultText(result);
  if (!options.expanded)
    return renderText(
      theme.fg("success", `${details?.count ?? 0} ${label}`) + buildExpandHint(text.split("\n").length, theme),
    );
  return renderText(theme.fg("toolOutput", text));
}

function formatLimitedList(items: string[], limit = 20): string[] {
  const visible = items.slice(0, limit).map((item) => `  - ${item}`);
  if (items.length > limit) visible.push(`  ...and ${items.length - limit} more`);
  return visible;
}

function formatMigrationResult(result: ReturnType<typeof migrateMemoryProject>): string {
  if (!result.success) {
    const lines = [result.message];
    if (result.conflicts.length > 0) lines.push("", "Conflicts:", ...formatLimitedList(result.conflicts));
    if (result.candidates && result.candidates.length > 0) {
      lines.push("", "Existing project folders:", ...formatLimitedList(result.candidates));
    }
    return lines.join("\n");
  }

  const lines = [
    result.dryRun ? "Migration preview:" : "Migrated project memory:",
    `  from: ${result.from}`,
    `  to: ${result.to}`,
    `  mode: ${result.mode}`,
    `  files: ${result.files}`,
  ];

  lines.push(
    "",
    result.dryRun ? "No changes made." : 'Run memory_sync(action="push") to commit and push the migration.',
  );
  return lines.join("\n");
}

export function registerMemorySync(
  pi: ExtensionAPI,
  settings: MemoryMdSettings,
  isRepoInitialized: { value: boolean },
): void {
  pi.registerTool({
    name: "memory_sync",
    label: "Memory Sync",
    description: "Synchronize memory repository with git (pull/push/status)",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("pull"), Type.Literal("push"), Type.Literal("status")], {
        description: "Action to perform",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action } = params as { action: "pull" | "push" | "status" };
      const localPath = settings.localPath!;
      const memoryDir = getMemoryDir(settings, ctx.cwd);
      const recordsDir = path.join(memoryDir, "records");

      if (action === "status") {
        const initialized = isRepoInitialized.value && fs.existsSync(recordsDir);
        if (!initialized) {
          return {
            content: [{ type: "text", text: "Memory repository not initialized. Use memory_init to set up." }],
            details: { initialized: false },
          };
        }
        const result = await gitExec(pi, localPath, ["status", "--porcelain"]);
        if (!result.success) {
          return {
            content: [{ type: "text", text: `Git status failed: ${result.stdout || "Unknown error"}` }],
            details: { success: false, error: result.stdout },
          };
        }
        const dirty = result.stdout.trim().length > 0;
        return {
          content: [{ type: "text", text: dirty ? `Changes detected:\n${result.stdout}` : "No uncommitted changes" }],
          details: { initialized: true, dirty },
        };
      }

      if (action === "pull") {
        const result = await syncRepository(pi, settings, isRepoInitialized);
        return {
          content: [{ type: "text", text: result.message }],
          details: { success: result.success },
        };
      }

      if (action === "push") {
        const statusResult = await gitExec(pi, localPath, ["status", "--porcelain"]);
        const hasChanges = statusResult.stdout.trim().length > 0;

        if (hasChanges) {
          await gitExec(pi, localPath, ["add", "."]);
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const commitResult = await gitExec(pi, localPath, ["commit", "-m", `Update memory - ${timestamp}`]);
          if (!commitResult.success) {
            return {
              content: [{ type: "text", text: commitResult.stdout || "Commit failed" }],
              details: { success: false },
            };
          }
        }

        const result = await gitExec(pi, localPath, ["push"]);
        if (result.timeout) {
          return {
            content: [
              {
                type: "text",
                text: "Unable to connect to GitHub repository, connection timeout (10s). Please check your network connection or try again later.",
              },
            ],
            details: { success: false, timeout: true },
          };
        }

        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: hasChanges
                  ? "Committed and pushed changes to repository"
                  : "No changes to commit, repository up to date",
              },
            ],
            details: { success: true, committed: hasChanges },
          };
        }
        return {
          content: [{ type: "text", text: result.stdout || "Push failed" }],
          details: { success: false },
        };
      }

      return {
        content: [{ type: "text", text: "Unknown action" }],
        details: {},
      };
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_sync", args, theme), 0, 0),
    renderResult: (result, options, theme) =>
      options.isPartial ? renderText(theme.fg("warning", "Syncing...")) : renderSyncResult(result, options, theme),
  });
}

export function registerMemoryRead(pi: ExtensionAPI, settings: MemoryMdSettings): void {
  pi.registerTool({
    name: "memory_read",
    label: "Memory Read",
    description:
      "Read a project memory file by relative path or stable @id with full, summary, or knowledge projection",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Relative path (e.g. 'records/state.runtime.md' or logical 'state/runtime.md') or stable ID (e.g. '@state.runtime')",
      }),
      view: Type.Optional(
        Type.Union([Type.Literal("full"), Type.Literal("summary"), Type.Literal("knowledge")], {
          description: "Projection to return: full Markdown, compact summary, or semantic knowledge only",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { path: pathOrId, view = "full" } = params as { path: string; view?: MemoryReadView };
      const memoryDir = getMemoryDir(settings, ctx.cwd);

      try {
        const fullPath = resolveMemoryFile(memoryDir, pathOrId);
        const memory = readMemoryFile(fullPath);
        if (!memory) throw new Error("File could not be parsed");

        return {
          content: [{ type: "text", text: formatMemoryRead(memory, view) }],
          details: { path: path.relative(memoryDir, fullPath), frontmatter: memory.frontmatter, view },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to read memory file: ${(error as Error).message}` }],
          details: { error: true },
        };
      }
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_read", args, theme), 0, 0),
    renderResult: (result, options, theme) => renderMemoryResult(result, options, theme),
  });
}

export function registerMemoryWrite(pi: ExtensionAPI, settings: MemoryMdSettings): void {
  pi.registerTool({
    name: "memory_write",
    label: "Memory Write",
    description:
      "Create or replace a structured project memory record. Logical state/ and events/ paths are stored under records/<stable-id>.md. " +
      "Prefer summary, concepts, claims, facts, relations, and optional notes over long prose.",
    parameters: Type.Object({
      path: Type.String({
        description: "Relative .md path under logical state/ or events/, or records/<stable-id>.md",
      }),
      content: Type.Optional(
        Type.String({ description: "Full Markdown content; optional when structured fields are provided" }),
      ),
      description: Type.String({ description: "Concise purpose shown in the recent-memory index" }),
      summary: Type.Optional(Type.String({ description: "One-sentence semantic summary for compact reads" })),
      concepts: Type.Optional(Type.Array(Type.String({ description: "Core concepts captured by this memory" }))),
      claims: Type.Optional(Type.Array(Type.String({ description: "Important conclusions or decisions" }))),
      facts: Type.Optional(
        Type.Record(Type.String(), Type.Any({ description: "Machine-readable scalar/array fact values" })),
      ),
      relations: Type.Optional(Type.Record(Type.String(), Type.String({ description: "Relation target stable @id" }))),
      notes: Type.Optional(Type.String({ description: "Optional prose/evidence rendered after structured knowledge" })),
      tags: Type.Optional(Type.Array(Type.String())),
      sensitive: Type.Optional(Type.Boolean({ description: "Mark this record as non-injectable sensitive memory" })),
      kind: Type.Optional(
        Type.Union([Type.Literal("state"), Type.Literal("event")], {
          description: "Optional lifecycle; inferred from logical path or record ID and must match it",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const {
        path: relPath,
        content,
        description,
        summary,
        concepts,
        claims,
        facts,
        relations,
        notes,
        tags,
        sensitive,
        kind: requestedKind,
      } = params as {
        path: string;
        content?: string;
        description: string;
        tags?: string[];
        sensitive?: boolean;
        kind?: "state" | "event";
      } & StructuredMemoryFields;
      const memoryDir = getMemoryDir(settings, ctx.cwd);

      try {
        const hasStructuredFields = Boolean(
          summary ||
            concepts?.length ||
            claims?.length ||
            Object.keys(facts ?? {}).length ||
            Object.keys(relations ?? {}).length ||
            notes,
        );
        if (!content && !hasStructuredFields) throw new Error("Either content or structured fields must be provided");
        if (content && (Object.keys(facts ?? {}).length || Object.keys(relations ?? {}).length || notes)) {
          throw new Error("facts, relations, and notes are only generated when content is omitted");
        }
        const conceptNormalization = normalizeMemoryConcepts(memoryDir, concepts);
        const normalizedConcepts = conceptNormalization.concepts;
        const memoryContent =
          content ??
          buildStructuredMemoryContent({
            description,
            summary,
            concepts: normalizedConcepts,
            claims,
            facts,
            relations,
            notes,
          });

        const detectedSensitive = hasSensitiveMemoryInput({
          content: memoryContent,
          concepts: normalizedConcepts,
          description,
          facts,
          relations,
          summary,
          claims,
          notes,
          tags,
        });

        const contentValidation = validateMemoryContent(memoryContent);
        if (!contentValidation.valid) throw new Error(contentValidation.error);

        const legacyPath = resolveMemoryPath(memoryDir, relPath);
        const legacyExists = fs.existsSync(legacyPath);
        const legacyExisting = legacyExists ? readMemoryFile(legacyPath) : null;
        const target = resolveMemoryWriteTarget(
          memoryDir,
          relPath,
          requestedKind,
          legacyExisting?.frontmatter.id,
          legacyExisting?.frontmatter.kind,
        );
        const targetExists = fs.existsSync(target.filePath);
        const existingPath = targetExists ? target.filePath : legacyExists && legacyExisting ? legacyPath : null;
        const beforeRaw = existingPath ? fs.readFileSync(existingPath, "utf-8") : undefined;
        const existing = targetExists ? readMemoryFile(target.filePath) : legacyExisting;

        const finalSensitive = sensitive === undefined ? detectedSensitive : sensitive;
        const today = getCurrentDate();
        const frontmatter: MemoryFrontmatter = {
          ...existing?.frontmatter,
          description,
          summary,
          concepts: normalizedConcepts,
          claims,
          created: existing?.frontmatter.created ?? today,
          updated: today,
          ...(tags && { tags }),
        };
        if (finalSensitive) frontmatter.sensitive = true;
        else delete frontmatter.sensitive;
        delete frontmatter.id;
        delete frontmatter.kind;

        writeMemoryFile(target.filePath, memoryContent, frontmatter);
        const afterRaw = fs.readFileSync(target.filePath, "utf-8");
        const overwriteDiff = beforeRaw === undefined ? undefined : buildMemoryOverwriteDiff(beforeRaw, afterRaw);
        upsertMemoryCatalog(memoryDir, target.filePath);
        const relTarget = path.relative(memoryDir, target.filePath);
        const duplicateHints = formatConceptDuplicateHints(conceptNormalization.audit.possibleDuplicates);
        const writeWarnings = formatMemoryWriteWarnings(
          buildMemoryWriteWarnings({
            summary,
            claims,
            facts,
            content,
            finalSensitive,
            detectedSensitive,
            hygieneWarnings: conceptNormalization.audit.warnings,
          }),
        );
        const operation = beforeRaw === undefined ? "create" : "overwrite";
        const status =
          operation === "overwrite"
            ? `Memory file overwritten: ${relTarget} (@${target.id})`
            : `Memory file written: ${relTarget} (@${target.id})`;
        return {
          content: [
            {
              type: "text",
              text: [status, overwriteDiff?.text, duplicateHints, writeWarnings].filter(Boolean).join("\n\n"),
            },
          ],
          details: {
            path: target.filePath,
            operation,
            diff: overwriteDiff,
            frontmatter: { ...frontmatter, id: target.id, kind: target.kind },
            concepts: conceptNormalization.audit,
            warnings: buildMemoryWriteWarnings({
              summary,
              claims,
              facts,
              content,
              finalSensitive,
              detectedSensitive,
              hygieneWarnings: conceptNormalization.audit.warnings,
            }),
          },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to write memory file: ${(error as Error).message}` }],
          details: { error: true },
        };
      }
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_write", args, theme), 0, 0),
    renderResult: (result, options, theme) => {
      const details = result.details as {
        frontmatter?: { description?: string; tags?: string[] };
        concepts?: { possibleDuplicates?: ConceptDuplicateHint[] };
        diff?: MemoryOverwriteDiffSummary;
      };
      return renderMemoryResult(result, options, theme, {
        description: details?.frontmatter?.description,
        tags: details?.frontmatter?.tags,
        notice: formatConceptDuplicateHints(details?.concepts?.possibleDuplicates),
        diff: details?.diff,
      });
    },
  });
}

export function registerMemoryList(pi: ExtensionAPI, settings: MemoryMdSettings): void {
  pi.registerTool({
    name: "memory_list",
    label: "Memory List",
    description: "List current-project memory files with stable IDs and lifecycle kinds",
    parameters: Type.Object({
      directory: Type.Optional(Type.String({ description: "Filter by state or events" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { directory } = params as { directory?: string };
      const memoryDir = getMemoryDir(settings, ctx.cwd);

      try {
        const normalizedDirectory = directory?.replace(/\/$/, "");
        const entries = getMemoryCatalog(memoryDir)
          .filter((entry) => {
            if (!normalizedDirectory) return true;
            if (normalizedDirectory === "state") return entry.kind === "state";
            if (normalizedDirectory === "events") return entry.kind === "event";
            return entry.path === normalizedDirectory || entry.path.startsWith(`${normalizedDirectory}/`);
          })
          .map((entry) => ({
            path: entry.path,
            id: entry.id,
            kind: entry.kind,
            description: entry.description,
          }));
        const text = entries
          .map(
            (entry) => `  - ${entry.path} (@${entry.id})\n    ${entry.kind}: ${entry.description ?? "No description"}`,
          )
          .join("\n");
        return {
          content: [{ type: "text", text: `Memory files (${entries.length}):\n\n${text}` }],
          details: { files: entries, count: entries.length },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list memory files: ${(error as Error).message}` }],
          details: { error: true },
        };
      }
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_list", args, theme), 0, 0),
    renderResult: (result, options, theme) => renderCountResult(result, options, theme, "memory files"),
  });
}

export function registerMemoryDelete(pi: ExtensionAPI, settings: MemoryMdSettings): void {
  pi.registerTool({
    name: "memory_delete",
    label: "Memory Delete",
    description:
      "Delete a project memory record by stable @id or path, then update derived catalog and concept dictionary",
    parameters: Type.Object({
      path: Type.String({ description: "Stable @id or memory path to delete" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { path: target } = params as { path: string };
      const memoryDir = getMemoryDir(settings, ctx.cwd);
      try {
        const deleted = deleteMemoryFile(memoryDir, target);
        return {
          content: [{ type: "text", text: `Memory deleted: ${deleted.path} (@${deleted.id})` }],
          details: { ...deleted, conceptCount: deleted.dictionary.concepts.length },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to delete memory: ${(error as Error).message}` }],
          details: { error: true },
        };
      }
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_delete", args, theme), 0, 0),
    renderResult: (result, options, theme) => renderCollapsed("Memory delete", getResultText(result), options, theme),
  });
}

export function registerMemorySearch(pi: ExtensionAPI, settings: MemoryMdSettings): void {
  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search memory files by content, tags, or description." +
      " Supports regex (e.g. 'typescript|javascript', 'fail.*build')." +
      " Multi-word queries use OR logic ranked by relevance -- use keywords, not full sentences.",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search terms or regex pattern (e.g. 'hook|inject', 'fail.*build'). Multi-word = OR ranked by relevance.",
      }),
      searchIn: Type.Union(
        [
          Type.Literal("content"),
          Type.Literal("tags"),
          Type.Literal("description"),
          Type.Literal("summary"),
          Type.Literal("concepts"),
          Type.Literal("claims"),
          Type.Literal("id"),
          Type.Literal("all"),
        ],
        { description: "Where to search" },
      ),
      kind: Type.Optional(
        Type.Union([Type.Literal("state"), Type.Literal("event")], {
          description: "Limit results to current state or time-bound events",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { query, searchIn, kind } = params as {
        query: string;
        searchIn: SearchField;
        kind?: "state" | "event";
      };
      const memoryDir = getMemoryDir(settings, ctx.cwd);
      const fileMap = new Map<string, import("./types.js").MemoryFile>();
      const needsContent = searchIn === "content" || searchIn === "all";
      for (const entry of getMemoryCatalog(memoryDir)) {
        fileMap.set(
          entry.path,
          needsContent
            ? memoryFileFromCatalogEntry(memoryDir, entry)
            : {
                path: path.join(memoryDir, entry.path),
                frontmatter: {
                  id: entry.id,
                  kind: entry.kind,
                  description: entry.description,
                  summary: entry.summary,
                  concepts: entry.concepts,
                  claims: entry.claims,
                  tags: entry.tags,
                  created: entry.created,
                  updated: entry.updated,
                },
                content: "",
              },
        );
      }

      const normalizedQuery = searchIn === "concepts" ? normalizeConceptSearchQuery(memoryDir, query) : query;
      const conceptAliasFamilies =
        searchIn === "concepts" && normalizedQuery.trim()
          ? expandConceptSearchFamilies(memoryDir, normalizedQuery.split(/\s+/))
          : undefined;
      const hits = searchMemoryFiles({ files: fileMap, query: normalizedQuery, searchIn, kind, conceptAliasFamilies });

      const catalogByPath = new Map(getMemoryCatalog(memoryDir).map((entry) => [entry.path, entry]));
      const results = hits.map((h) => {
        const entry = catalogByPath.get(h.path);
        const id = entry?.id ?? h.path;
        return {
          path: h.path,
          id,
          kind: entry?.kind,
          match: h.snippet,
          matchCount: h.matchCount,
          matchedIn: h.matchedIn,
          next: `memory_read({ path: "@${id}", view: "knowledge" })`,
        };
      });

      return {
        content: [
          {
            type: "text",
            text:
              results.length === 0
                ? "No results found."
                : `Found ${results.length} result(s):\n\n${results
                    .map((r) => `  ${r.path} (@${r.id})\n  ${r.match}\n  Next: ${r.next}`)
                    .join("\n\n")}`,
          },
        ],
        details: { results, count: results.length, query: normalizedQuery },
      };
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_search", args, theme), 0, 0),
    renderResult: (result, options, theme) => renderCountResult(result, options, theme, "result(s)"),
  });
}

export function registerMemoryAlias(pi: ExtensionAPI, settings: MemoryMdSettings): void {
  pi.registerTool({
    name: "memory_alias",
    label: "Memory Alias",
    description:
      "Add an alias for an existing canonical concept so future memory_write and memory_search calls resolve it. " +
      "Canonical must already exist in the concept dictionary; an alias that is currently a standalone concept is " +
      "converted into an alias without rewriting existing records.",
    parameters: Type.Object({
      alias: Type.String({ description: "Alias label to resolve to the canonical concept" }),
      canonical: Type.String({ description: "Existing canonical concept the alias should point to" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { alias, canonical } = params as { alias: string; canonical: string };
      const memoryDir = getMemoryDir(settings, ctx.cwd);
      const result = addConceptAlias(memoryDir, alias, canonical);
      const text = result.ok
        ? result.converted
          ? `Concept alias added: ${result.alias} -> ${result.canonical} (converted from standalone concept; existing records resolve lazily).`
          : `Concept alias added: ${result.alias} -> ${result.canonical}.`
        : `Failed to add concept alias: ${result.error}`;
      return { content: [{ type: "text", text }], details: result };
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_alias", args, theme), 0, 0),
    renderResult: (result, options, theme) => {
      if (options.isPartial) return renderText(theme.fg("warning", "Adding alias..."));
      const details = result.details as { ok?: boolean };
      return renderCollapsed(details?.ok ? "Alias added" : "Alias failed", getResultText(result), options, theme);
    },
  });
}

export function registerMemoryInit(
  pi: ExtensionAPI,
  settings: MemoryMdSettings,
  isRepoInitialized: { value: boolean },
): void {
  pi.registerTool({
    name: "memory_init",
    label: "Memory Init",
    description: "Initialize memory repository (clone or create initial structure)",
    parameters: Type.Object({
      force: Type.Optional(Type.Boolean({ description: "Reinitialize even if already set up" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { force = false } = params as { force?: boolean };
      if (isRepoInitialized.value && !force) {
        return {
          content: [{ type: "text", text: "Memory repository already initialized. Use force: true to reinitialize." }],
          details: { initialized: true },
        };
      }
      const result = await syncRepository(pi, settings, isRepoInitialized);
      if (result.success) {
        const memoryDir = getMemoryDir(settings, ctx.cwd);
        ensureDirectoryStructure(memoryDir);
        createDefaultFiles(memoryDir);
      }
      return {
        content: [
          {
            type: "text",
            text: result.success
              ? `Memory repository initialized:\n${result.message}\n\nCreated project directory:\n  - records`
              : `Initialization failed: ${result.message}`,
          },
        ],
        details: { success: result.success },
      };
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_init", args, theme), 0, 0),
    renderResult: (result, options, theme) => {
      if (options.isPartial) return renderText(theme.fg("warning", "Initializing..."));
      const details = result.details as { initialized?: boolean; success?: boolean };
      if (details?.initialized) return renderText(theme.fg("muted", "Already initialized"));
      const summary = details?.success ? "Initialized" : "Initialization failed";
      return renderCollapsed(summary, getResultText(result), options, theme);
    },
  });
}

export function registerMemoryMigrate(pi: ExtensionAPI, settings: MemoryMdSettings): void {
  pi.registerTool({
    name: "memory_migrate",
    label: "Memory Migrate",
    description: "Migrate project memory after renaming a workspace folder",
    parameters: Type.Object({
      from: Type.String({ description: "Old workspace folder name that owns the existing memory" }),
      to: Type.Optional(Type.String({ description: "New workspace folder name. Defaults to the current workspace." })),
      mode: Type.Optional(
        Type.Union([Type.Literal("move"), Type.Literal("merge")], {
          description: "move fails if destination exists; merge moves missing files and fails on conflicts.",
        }),
      ),
      dryRun: Type.Optional(Type.Boolean({ description: "Preview migration without changing files" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const {
        from,
        to,
        mode = "move",
        dryRun = false,
      } = params as { from: string; to?: string; mode?: "move" | "merge"; dryRun?: boolean };
      const result = migrateMemoryProject(settings, { cwd: ctx.cwd, from, to, mode, dryRun });

      return {
        content: [{ type: "text", text: formatMigrationResult(result) }],
        details: result,
      };
    },

    renderCall: (args, theme) => new Text(buildToolCallText("memory_migrate", args, theme), 0, 0),
    renderResult: (result, options, theme) =>
      options.isPartial ? renderText(theme.fg("warning", "Migrating...")) : renderSyncResult(result, options, theme),
  });
}

export function registerMemoryCheck(pi: ExtensionAPI, settings: MemoryMdSettings): void {
  pi.registerTool({
    name: "memory_check",
    label: "Memory Check",
    description: "Check current project memory folder structure",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const memoryDir = getMemoryDir(settings, ctx.cwd);
      if (!fs.existsSync(memoryDir)) {
        return {
          content: [
            {
              type: "text",
              text: `Memory directory not found: ${memoryDir}\n\nProject memory may not be initialized yet.`,
            },
          ],
          details: { exists: false },
        };
      }

      const { execSync } = await import("node:child_process");
      let treeOutput = "";
      try {
        treeOutput = execSync(`tree -L 3 -I "node_modules" "${memoryDir}"`, { encoding: "utf-8" });
      } catch {
        try {
          treeOutput = execSync(`find "${memoryDir}" -type d -not -path "*/node_modules/*" | head -20`, {
            encoding: "utf-8",
          });
        } catch {
          treeOutput = "Unable to generate directory tree. Please check permissions.";
        }
      }

      const files = listMemoryFiles(memoryDir);
      const relPaths = files.map((f) => path.relative(memoryDir, f));
      return {
        content: [
          {
            type: "text",
            text: `Memory directory structure for project: ${path.basename(ctx.cwd)}\n\nPath: ${memoryDir}\n\n${treeOutput}\n\nMemory files (${relPaths.length}):\n${relPaths.map((p) => `  ${p}`).join("\n")}`,
          },
        ],
        details: { path: memoryDir, fileCount: relPaths.length },
      };
    },

    renderCall: (_args, theme) => new Text(buildToolCallText("memory_check", {}, theme), 0, 0),
    renderResult: (result, options, theme) => {
      if (options.isPartial) return renderText(theme.fg("warning", "Checking..."));
      const details = result.details as { exists?: boolean; fileCount?: number };
      const summary = (details?.exists ?? true) ? `Structure: ${details?.fileCount ?? 0} files` : "Not initialized";
      return renderCollapsed(summary, getResultText(result), options, theme);
    },
  });
}

export function registerAllMemoryTools(
  pi: ExtensionAPI,
  settings: MemoryMdSettings,
  isRepoInitialized: { value: boolean },
): void {
  registerMemoryRead(pi, settings);
  registerMemoryWrite(pi, settings);
  registerMemoryList(pi, settings);
  registerMemorySearch(pi, settings);
  registerMemoryAlias(pi, settings);
  registerMemoryDelete(pi, settings);
  registerMemoryInit(pi, settings, isRepoInitialized);
  registerMemoryMigrate(pi, settings);
}
