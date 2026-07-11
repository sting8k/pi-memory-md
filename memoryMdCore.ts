import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import type {
  GitResult,
  MemoryFactValue,
  MemoryFile,
  MemoryFrontmatter,
  MemoryKind,
  MemoryMdSettings,
  MemoryReadView,
  ParsedFrontmatter,
  StructuredMemoryFields,
} from "./types.js";

export * from "./types.js";

/**
 * Constants
 */

const DEFAULT_LOCAL_PATH = path.join(os.homedir(), ".pi", "memory-md");
const TIMEOUT_MS = 10000;
const TIMEOUT_MESSAGE =
  "Unable to connect to GitHub repository, connection timeout (10s). Please check your network connection or try again later.";

/**
 * Settings
 */

let localPath: string;

export function getLocalPath(): string {
  return localPath;
}

export function getCurrentDate(): string {
  return new Date().toISOString().split("T")[0];
}

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function findWorkspaceRoot(cwd: string): string {
  let current = path.resolve(cwd);

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

function toProjectSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

export function getProjectSlug(cwd: string): string {
  return toProjectSlug(path.basename(findWorkspaceRoot(cwd)));
}

export function getMemoryDir(settings: MemoryMdSettings, cwd: string): string {
  localPath = expandPath(settings.localPath || DEFAULT_LOCAL_PATH);
  return path.join(localPath, "projects", getProjectSlug(cwd));
}

export type MemoryMigrateMode = "move" | "merge";

export interface MemoryMigrateInput {
  cwd: string;
  from: string;
  to?: string;
  mode?: MemoryMigrateMode;
  dryRun?: boolean;
}

export interface MemoryMigrateResult {
  success: boolean;
  message: string;
  dryRun: boolean;
  mode: MemoryMigrateMode;
  from: string;
  to: string;
  fromPath: string;
  toPath: string;
  files: number;
  conflicts: string[];
  candidates?: string[];
}

function validateProjectFolderName(name: string, label: string): string | null {
  if (!name.trim()) return `${label} is required`;
  if (path.isAbsolute(name) || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    return `${label} must be a workspace folder name, not a path`;
  }
  if (name.startsWith(".")) return `${label} must not be a hidden or reserved folder name`;
  return null;
}

function listProjectMemoryFolders(memoryRoot: string): string[] {
  if (!fs.existsSync(memoryRoot)) return [];
  return fs
    .readdirSync(memoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== ".git")
    .map((entry) => entry.name)
    .sort();
}

function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function formatFsError(error: unknown): string {
  const err = error as NodeJS.ErrnoException;
  return err.message || String(error);
}

function lstatIfExists(targetPath: string): fs.Stats | null {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

interface FileInventory {
  files: string[];
  symlinks: string[];
}

function listFilesRecursive(dir: string): FileInventory {
  const files: string[] = [];
  const symlinks: string[] = [];

  function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        symlinks.push(fullPath);
      } else if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return { files: files.sort(), symlinks: symlinks.sort() };
}

function detectMergeConflicts(toPath: string, relativeFiles: string[]): string[] {
  const conflicts: string[] = [];

  for (const relPath of relativeFiles) {
    const destFile = path.join(toPath, relPath);
    if (lstatIfExists(destFile)) {
      conflicts.push(relPath);
      continue;
    }

    const parts = relPath.split(path.sep);
    for (let i = 1; i < parts.length; i++) {
      const ancestor = path.join(toPath, ...parts.slice(0, i));
      const ancestorStats = lstatIfExists(ancestor);
      if (ancestorStats && !ancestorStats.isDirectory()) {
        conflicts.push(relPath);
        break;
      }
    }
  }

  return conflicts;
}

function getMissingDirectories(targetDir: string, stopDir: string): string[] {
  const relative = path.relative(stopDir, targetDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return [];

  const missingDirs: string[] = [];
  let current = stopDir;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (!lstatIfExists(current)) missingDirs.push(current);
  }
  return missingDirs;
}

function rollbackMergeWrites(
  copiedFiles: string[],
  attemptedFile: string | null,
  createdDirs: string[],
  toPath: string,
): string[] {
  const failures: string[] = [];
  const filesToRemove = attemptedFile ? [...copiedFiles, attemptedFile] : copiedFiles;

  for (const file of [...new Set(filesToRemove)].reverse()) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      failures.push(path.relative(toPath, file));
    }
  }

  const dirsToRemove = [...new Set(createdDirs)].sort((a, b) => b.length - a.length);
  for (const dir of dirsToRemove) {
    try {
      fs.rmdirSync(dir);
    } catch (error) {
      if (!isNotFoundError(error)) failures.push(path.relative(toPath, dir));
    }
  }

  return failures;
}

function legacyDestination(relativePath: string, duplicateNames: Set<string>): string {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized === "core/user/identity.md") return path.join("state", "identity.md");
  if (normalized === "core/user/prefer.md") return path.join("state", "preferences.md");

  const basename = path.basename(relativePath);
  if (!duplicateNames.has(basename)) return path.join("events", basename);
  const prefix = path.dirname(relativePath).split(path.sep).map(idSegment).filter(Boolean).join("-");
  return path.join("events", `${prefix}-${basename}`);
}

function migrateLegacyProject(
  legacyPath: string,
  toPath: string,
  result: Omit<MemoryMigrateResult, "success" | "message" | "files" | "conflicts">,
  mode: MemoryMigrateMode,
  dryRun: boolean,
): MemoryMigrateResult {
  const inventory = listFilesRecursive(legacyPath);
  const markdownFiles = inventory.files.filter((file) => file.endsWith(".md"));
  const unsupported = inventory.files
    .filter((file) => !file.endsWith(".md"))
    .map((file) => path.relative(legacyPath, file));
  if (inventory.symlinks.length > 0 || unsupported.length > 0) {
    const conflicts = [...inventory.symlinks.map((file) => path.relative(legacyPath, file)), ...unsupported];
    return {
      ...result,
      success: false,
      message: "Legacy migration supports Markdown files only",
      files: markdownFiles.length,
      conflicts,
    };
  }

  const nameCounts = new Map<string, number>();
  for (const file of markdownFiles) {
    const name = path.basename(file);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const duplicateNames = new Set(
    Array.from(nameCounts)
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
  const mappings = markdownFiles.map((source) => {
    const relative = path.relative(legacyPath, source);
    return { source, destination: path.join(toPath, legacyDestination(relative, duplicateNames)) };
  });
  const relativeDestinations = mappings.map(({ destination }) => path.relative(toPath, destination));
  const conflicts = detectMergeConflicts(toPath, relativeDestinations);

  if (lstatIfExists(toPath) && mode === "move") {
    return {
      ...result,
      success: false,
      message: `Destination memory folder already exists: ${result.to}. Use mode: "merge" to merge without overwriting.`,
      files: mappings.length,
      conflicts,
    };
  }
  if (conflicts.length > 0) {
    return {
      ...result,
      success: false,
      message: `Legacy migration blocked by ${conflicts.length} conflict(s)`,
      files: mappings.length,
      conflicts,
    };
  }
  if (dryRun) {
    return {
      ...result,
      success: true,
      message: `Legacy project ${result.from} can be migrated to Memory v2`,
      files: mappings.length,
      conflicts: [],
    };
  }

  const written: string[] = [];
  try {
    for (const { source, destination } of mappings) {
      const memory = readMemoryFile(source);
      if (!memory) throw new Error(`Unable to read ${path.relative(legacyPath, source)}`);
      const kind = inferMemoryKind(toPath, destination);
      if (!kind) throw new Error(`Unable to classify ${path.relative(legacyPath, source)}`);
      const fallbackDate = fs.statSync(source).mtime.toISOString().slice(0, 10);
      writeMemoryFile(destination, memory.content, {
        ...memory.frontmatter,
        id: createMemoryId(toPath, destination, kind),
        kind,
        description: memory.frontmatter.description || path.basename(source, ".md"),
        created: memory.frontmatter.created ?? memory.frontmatter.updated ?? fallbackDate,
        updated: memory.frontmatter.updated ?? memory.frontmatter.created ?? fallbackDate,
      });
      written.push(destination);
    }
    fs.rmSync(legacyPath, { recursive: true });
  } catch (error) {
    for (const file of written.reverse()) fs.rmSync(file, { force: true });
    return {
      ...result,
      success: false,
      message: `Legacy migration failed and destination writes were rolled back: ${formatFsError(error)}`,
      files: mappings.length,
      conflicts: [],
    };
  }

  return {
    ...result,
    success: true,
    message: `Migrated legacy project ${result.from} to Memory v2 project ${result.to}`,
    files: mappings.length,
    conflicts: [],
  };
}

export function migrateMemoryProject(settings: MemoryMdSettings, input: MemoryMigrateInput): MemoryMigrateResult {
  const mode = input.mode ?? "move";
  const dryRun = input.dryRun ?? false;
  const toInput = input.to?.trim() || getProjectSlug(input.cwd);
  const fromInput = input.from.trim();
  const to = toProjectSlug(toInput);
  const from = toProjectSlug(fromInput);
  const currentMemoryDir = getMemoryDir(settings, input.cwd);
  const memoryRoot = path.dirname(currentMemoryDir);
  const fromPath = path.join(memoryRoot, from);
  const toPath = path.join(memoryRoot, to);
  const baseResult = { dryRun, mode, from, to, fromPath, toPath, files: 0, conflicts: [] as string[] };

  const fail = (message: string, extra?: Partial<MemoryMigrateResult>): MemoryMigrateResult => ({
    ...baseResult,
    ...extra,
    success: false,
    message,
  });

  try {
    const fromError = validateProjectFolderName(fromInput, "from");
    if (fromError) return fail(fromError);

    const toError = validateProjectFolderName(toInput, "to");
    if (toError) return fail(toError);

    const fromStats = lstatIfExists(fromPath);
    if (!fromStats) {
      const legacyPath = path.join(path.dirname(memoryRoot), fromInput);
      const legacyStats = lstatIfExists(legacyPath);
      if (legacyStats?.isDirectory()) {
        return migrateLegacyProject(legacyPath, toPath, { ...baseResult, fromPath: legacyPath }, mode, dryRun);
      }
      return fail(`Source memory folder not found: ${from}`, { candidates: listProjectMemoryFolders(memoryRoot) });
    }
    if (from === to) return fail("Source and destination project folders are the same");
    if (!fromStats.isDirectory()) return fail(`Source exists but is not a directory: ${from}`);

    const inventory = listFilesRecursive(fromPath);
    const files = inventory.files;
    const relativeFiles = files.map((file) => path.relative(fromPath, file));
    const resultBase = { ...baseResult, files: files.length };
    const symlinks = inventory.symlinks.map((file) => path.relative(fromPath, file));

    const toStats = lstatIfExists(toPath);
    if (!toStats) {
      if (!dryRun) {
        try {
          fs.renameSync(fromPath, toPath);
        } catch (error) {
          return { ...resultBase, success: false, message: `Move failed: ${formatFsError(error)}` };
        }
      }
      return { ...resultBase, success: true, message: `Moved project memory from ${from} to ${to}` };
    }

    if (!toStats.isDirectory()) {
      return { ...resultBase, success: false, message: `Destination exists but is not a directory: ${to}` };
    }

    if (mode === "move") {
      return {
        ...resultBase,
        success: false,
        message: `Destination memory folder already exists: ${to}. Use mode: "merge" to merge without overwriting.`,
      };
    }

    if (symlinks.length > 0) {
      return {
        ...resultBase,
        success: false,
        message: `Merge blocked by ${symlinks.length} unsupported symlink(s)`,
        conflicts: symlinks,
      };
    }

    const conflicts = detectMergeConflicts(toPath, relativeFiles);
    if (conflicts.length > 0) {
      return {
        ...resultBase,
        success: false,
        message: `Merge blocked by ${conflicts.length} conflict(s)`,
        conflicts,
      };
    }

    if (!dryRun) {
      const copiedFiles: string[] = [];
      const createdDirs: string[] = [];
      let currentRelPath = "";
      let currentDestFile: string | null = null;

      try {
        for (const file of files) {
          currentRelPath = path.relative(fromPath, file);
          const destFile = path.join(toPath, currentRelPath);
          currentDestFile = destFile;
          const destDir = path.dirname(destFile);
          const missingDirs = getMissingDirectories(destDir, toPath);
          fs.mkdirSync(destDir, { recursive: true });
          createdDirs.push(...missingDirs);
          fs.copyFileSync(file, destFile, fs.constants.COPYFILE_EXCL);
          copiedFiles.push(destFile);
          currentDestFile = null;
        }
      } catch (error) {
        const rollbackFailures = rollbackMergeWrites(copiedFiles, currentDestFile, createdDirs, toPath);
        const rollbackMessage =
          rollbackFailures.length === 0
            ? "Destination writes were rolled back."
            : `Rollback could not remove ${rollbackFailures.length} path(s): ${rollbackFailures.join(", ")}`;
        return {
          ...resultBase,
          success: false,
          message: `Merge failed while copying ${currentRelPath || "file"}: ${formatFsError(error)}. Source was left intact. ${rollbackMessage}`,
        };
      }

      try {
        fs.rmSync(fromPath, { recursive: true, force: true });
      } catch (error) {
        return {
          ...resultBase,
          success: false,
          message: `Merge copied files into ${to}, but failed to remove source ${from}: ${formatFsError(error)}. Remove the source folder manually after verifying the destination.`,
        };
      }
    }

    return { ...resultBase, success: true, message: `Merged project memory from ${from} into ${to}` };
  } catch (error) {
    return fail(`Migration failed: ${formatFsError(error)}`);
  }
}

function getRepoName(settings: MemoryMdSettings): string {
  if (!settings.repoUrl) return "memory-md";
  const match = settings.repoUrl.match(/\/([^/]+?)(\.git)?$/);
  return match ? match[1] : "memory-md";
}

export function loadSettings(): MemoryMdSettings {
  const DEFAULT_SETTINGS: MemoryMdSettings = {
    enabled: true,
    repoUrl: "",
    localPath: DEFAULT_LOCAL_PATH,
    autoSync: { onSessionStart: true },
    injection: "message-append",
    systemPrompt: {
      maxTokens: 10000,
      includeProjects: ["current"],
    },
  };

  const globalSettings = path.join(os.homedir(), ".pi", "agent", "settings.json");
  if (!fs.existsSync(globalSettings)) {
    return DEFAULT_SETTINGS;
  }

  try {
    const content = fs.readFileSync(globalSettings, "utf-8");
    const parsed = JSON.parse(content);
    const loadedSettings = { ...DEFAULT_SETTINGS, ...(parsed["pi-memory-md"] as MemoryMdSettings) };

    if (loadedSettings.localPath) {
      loadedSettings.localPath = expandPath(loadedSettings.localPath);
    }

    return loadedSettings;
  } catch (error) {
    console.warn("Failed to load memory settings:", error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Git operations
 */

export async function gitExec(
  pi: ExtensionAPI,
  cwd: string,
  args: string[],
  timeoutMs = TIMEOUT_MS,
): Promise<GitResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await pi.exec("git", args, { cwd, signal: controller.signal });
    clearTimeout(timeoutId);
    return { stdout: result.stdout || "", success: true };
  } catch (error) {
    clearTimeout(timeoutId);
    const err = error as { name?: string; code?: string; message?: string };
    const isTimeout = err?.name === "AbortError" || err?.code === "ABORT_ERR";
    if (isTimeout) return { stdout: "", success: false, timeout: true };
    return { stdout: err?.message || String(error), success: false };
  }
}

export async function syncRepository(
  pi: ExtensionAPI,
  settings: MemoryMdSettings,
  isRepoInitialized: { value: boolean },
): Promise<{ success: boolean; message: string; updated?: boolean }> {
  const { localPath, repoUrl } = settings;

  if (!localPath) {
    return { success: false, message: "Local memory path not configured" };
  }

  if (!repoUrl) {
    fs.mkdirSync(localPath, { recursive: true });
    isRepoInitialized.value = true;
    return { success: true, message: `Using local memory directory: ${localPath}` };
  }

  const repoName = getRepoName(settings);

  if (fs.existsSync(localPath)) {
    const gitDir = path.join(localPath, ".git");
    if (!fs.existsSync(gitDir)) {
      return { success: false, message: `Directory exists but is not a git repo: ${localPath}` };
    }

    const pullResult = await gitExec(pi, localPath, ["pull", "--rebase", "--autostash"]);
    if (pullResult.timeout) return { success: false, message: TIMEOUT_MESSAGE };
    if (!pullResult.success) return { success: false, message: pullResult.stdout || "Pull failed" };

    isRepoInitialized.value = true;
    const updated = pullResult.stdout.includes("Updating") || pullResult.stdout.includes("Fast-forward");

    return {
      success: true,
      message: updated ? `Pulled latest changes from [${repoName}]` : `[${repoName}] is already latest`,
      updated,
    };
  }

  fs.mkdirSync(localPath, { recursive: true });

  const memoryDirName = path.basename(localPath);
  const parentDir = path.dirname(localPath);
  const cloneResult = await gitExec(pi, parentDir, ["clone", repoUrl, memoryDirName]);

  if (cloneResult.timeout) return { success: false, message: TIMEOUT_MESSAGE };
  if (cloneResult.success) {
    isRepoInitialized.value = true;
    return { success: true, message: `Cloned [${repoName}] successfully`, updated: true };
  }

  return { success: false, message: cloneResult.stdout || "Clone failed" };
}

/**
 * File operations
 */

export const MEMORY_FACTS_START = "<!-- memory:facts:v1 -->";
export const MEMORY_FACTS_END = "<!-- /memory:facts -->";

const MEMORY_KEY_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const MEMORY_RECORDS_DIR = "records";
const MEMORY_CATALOG_FILE = ".catalog.json";
const MEMORY_CATALOG_VERSION = 2;

export interface MemoryCatalogEntry {
  path: string;
  id: string;
  kind: MemoryKind;
  description: string;
  summary?: string;
  concepts: string[];
  claims: string[];
  tags: string[];
  facts: Record<string, MemoryFactValue>;
  relations: Record<string, string>;
  created?: string;
  updated?: string;
  mtimeMs: number;
  size: number;
  content: string;
}

interface MemoryCatalog {
  version: typeof MEMORY_CATALOG_VERSION;
  entries: MemoryCatalogEntry[];
}

function normalizeMemoryId(id: string): string {
  return id.startsWith("@") ? id.slice(1) : id;
}

function inferKindFromId(id: string): MemoryKind | null {
  if (id.startsWith("state.")) return "state";
  if (id.startsWith("event.")) return "event";
  return null;
}

function recordPathForId(memoryDir: string, id: string): string {
  return path.join(memoryDir, MEMORY_RECORDS_DIR, `${normalizeMemoryId(id)}.md`);
}

function recordIdFromPath(memoryDir: string, filePath: string): string | null {
  const relative = path.relative(path.join(memoryDir, MEMORY_RECORDS_DIR), filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.endsWith(".md")) return null;
  return relative.replace(/\.md$/i, "").split(path.sep).join(".");
}

function catalogPath(memoryDir: string): string {
  return path.join(memoryDir, MEMORY_CATALOG_FILE);
}

function isMemoryFactValue(value: unknown): value is MemoryFactValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  return (
    Array.isArray(value) &&
    value.every((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry))
  );
}

export function parseMemoryFacts(content: string): {
  facts: Record<string, MemoryFactValue>;
  relations: Record<string, string>;
} {
  const startCount = content.split(MEMORY_FACTS_START).length - 1;
  const endCount = content.split(MEMORY_FACTS_END).length - 1;

  if (startCount === 0 && endCount === 0) return { facts: {}, relations: {} };
  if (startCount !== 1 || endCount !== 1) {
    throw new Error("Memory content must contain exactly one complete facts block");
  }

  const start = content.indexOf(MEMORY_FACTS_START) + MEMORY_FACTS_START.length;
  const end = content.indexOf(MEMORY_FACTS_END);
  if (end < start) throw new Error("Memory facts end marker must follow the start marker");

  const facts: Record<string, MemoryFactValue> = {};
  const relations: Record<string, string> = {};
  const keys = new Set<string>();

  for (const rawLine of content.slice(start, end).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const relation = line.match(/^([a-z][a-z0-9_.-]*)\s*->\s*@([a-z][a-z0-9_.-]*)$/);
    if (relation) {
      if (keys.has(relation[1])) throw new Error(`Duplicate memory fact key: ${relation[1]}`);
      keys.add(relation[1]);
      relations[relation[1]] = `@${relation[2]}`;
      continue;
    }

    const assignment = line.match(/^([a-z][a-z0-9_.-]*)\s*=\s*(.+)$/);
    if (!assignment || !MEMORY_KEY_PATTERN.test(assignment[1])) {
      throw new Error(`Invalid memory fact line: ${line}`);
    }

    let value: unknown;
    try {
      value = JSON.parse(assignment[2]);
    } catch {
      throw new Error(`Memory fact value must be valid JSON: ${assignment[1]}`);
    }
    if (!isMemoryFactValue(value)) throw new Error(`Memory fact values cannot be objects: ${assignment[1]}`);
    if (keys.has(assignment[1])) throw new Error(`Duplicate memory fact key: ${assignment[1]}`);
    keys.add(assignment[1]);
    facts[assignment[1]] = value;
  }

  return { facts, relations };
}

function normalizeRelationKey(key: string): string {
  return key.startsWith("relation.") ? key : `relation.${key}`;
}

export function buildStructuredMemoryContent(fields: StructuredMemoryFields & { description: string }): string {
  const lines: string[] = [`# ${fields.summary ?? fields.description}`];

  if (fields.summary) lines.push("", "## Summary", fields.summary);
  if (fields.concepts?.length) lines.push("", "## Concepts", ...fields.concepts.map((concept) => `- ${concept}`));
  if (fields.claims?.length) lines.push("", "## Claims", ...fields.claims.map((claim) => `- ${claim}`));

  const factLines = [
    ...Object.entries(fields.facts ?? {}).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    ...Object.entries(fields.relations ?? {}).map(
      ([key, target]) => `${normalizeRelationKey(key)} -> ${target.startsWith("@") ? target : `@${target}`}`,
    ),
  ];
  if (factLines.length) lines.push("", MEMORY_FACTS_START, ...factLines, MEMORY_FACTS_END);
  if (fields.notes) lines.push("", "## Notes", fields.notes);

  return `${lines.join("\n")}\n`;
}

function pushListSection(lines: string[], title: string, values?: string[]): void {
  if (!values?.length) return;
  lines.push("", `## ${title}`, ...values.map((value) => `- ${value}`));
}

function pushMapSection(lines: string[], title: string, values: Record<string, unknown>, separator: string): void {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  lines.push(
    "",
    `## ${title}`,
    ...entries.map(
      ([key, value]) => `- ${key} ${separator} ${typeof value === "string" ? value : JSON.stringify(value)}`,
    ),
  );
}

export function formatMemoryRead(memory: MemoryFile, view: MemoryReadView = "full"): string {
  const {
    id,
    kind,
    description = "No description",
    tags = [],
    summary,
    concepts = [],
    claims = [],
  } = memory.frontmatter;
  const semantic = parseMemoryFacts(memory.content);
  const lines = [
    `# ${description}`,
    "",
    `ID: ${id ? `@${id}` : "none"}`,
    `Kind: ${kind ?? "legacy"}`,
    `Tags: ${tags.join(", ") || "none"}`,
  ];
  if (view === "full") return [...lines, "", memory.content].join("\n");

  if (summary) lines.push("", "## Summary", summary);
  pushListSection(lines, "Concepts", concepts);

  if (view === "summary") return `${lines.join("\n")}\n`;

  pushListSection(lines, "Claims", claims);
  pushMapSection(lines, "Facts", semantic.facts, "=");
  pushMapSection(lines, "Relations", semantic.relations, "->");
  return `${lines.join("\n")}\n`;
}
function recordInfoFromFilePath(filePath: string): { id: string; kind: MemoryKind } | null {
  const parts = path.normalize(filePath).split(path.sep);
  const recordIndex = parts.lastIndexOf(MEMORY_RECORDS_DIR);
  if (recordIndex < 0) return null;
  const relativeParts = parts.slice(recordIndex + 1);
  if (relativeParts.length === 0) return null;
  const filename = relativeParts.at(-1);
  if (!filename?.endsWith(".md")) return null;
  relativeParts[relativeParts.length - 1] = filename.replace(/\.md$/i, "");
  const id = relativeParts.join(".");
  const kind = inferKindFromId(id);
  return kind ? { id, kind } : null;
}

export function validateMemoryContent(content: string): { valid: boolean; error?: string } {
  try {
    parseMemoryFacts(content);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

function validateFrontmatter(data: ParsedFrontmatter): { valid: boolean; error?: string } {
  if (!data) {
    return { valid: false, error: "No frontmatter found (requires --- delimiters)" };
  }

  const frontmatter = data as unknown as MemoryFrontmatter;

  if (
    frontmatter.id !== undefined &&
    (typeof frontmatter.id !== "string" || !MEMORY_KEY_PATTERN.test(frontmatter.id))
  ) {
    return { valid: false, error: "'id' must be a dotted lowercase logical ID" };
  }

  if (frontmatter.kind !== undefined && frontmatter.kind !== "state" && frontmatter.kind !== "event") {
    return { valid: false, error: "'kind' must be 'state' or 'event'" };
  }

  if (frontmatter.description !== undefined && typeof frontmatter.description !== "string") {
    return { valid: false, error: "'description' must be a string if provided" };
  }

  if (frontmatter.summary !== undefined && typeof frontmatter.summary !== "string") {
    return { valid: false, error: "'summary' must be a string if provided" };
  }

  if (frontmatter.limit !== undefined && (typeof frontmatter.limit !== "number" || frontmatter.limit <= 0)) {
    return { valid: false, error: "'limit' must be a positive number" };
  }

  for (const field of ["tags", "concepts", "claims"] as const) {
    const value = frontmatter[field];
    if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) {
      return { valid: false, error: `'${field}' must be an array of strings` };
    }
  }

  return { valid: true };
}

export function readMemoryFile(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(content);
    const recordInfo = recordInfoFromFilePath(filePath);

    if (!parsed.data || Object.keys(parsed.data).length === 0) {
      return {
        path: filePath,
        frontmatter: {
          id: recordInfo?.id,
          kind: recordInfo?.kind,
          description: "No description",
        },
        content: content,
      };
    }

    const validation = validateFrontmatter(parsed.data);

    if (!validation.valid) {
      return {
        path: filePath,
        frontmatter: {
          id: recordInfo?.id,
          kind: recordInfo?.kind,
          description: "No description",
        },
        content: content,
      };
    }

    const frontmatter = parsed.data as unknown as MemoryFrontmatter;
    return {
      path: filePath,
      frontmatter: {
        ...frontmatter,
        id: frontmatter.id ?? recordInfo?.id,
        kind: frontmatter.kind ?? recordInfo?.kind,
      },
      content: parsed.content,
    };
  } catch (error) {
    console.error(`Failed to read memory file ${filePath}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export function listMemoryFiles(memoryDir: string): string[] {
  const files: string[] = [];

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  walkDir(memoryDir);
  return files;
}

export function resolveMemoryPath(memoryDir: string, relPath: string): string {
  const root = path.resolve(memoryDir);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Memory path must stay inside the current project");
  }
  return resolved;
}

export function inferMemoryKind(memoryDir: string, filePath: string): MemoryKind | null {
  const [namespace] = path.relative(memoryDir, filePath).split(path.sep);
  if (namespace === "state") return "state";
  if (namespace === "events") return "event";
  if (namespace === MEMORY_RECORDS_DIR) {
    const id = recordIdFromPath(memoryDir, filePath);
    return id ? inferKindFromId(id) : null;
  }
  return null;
}

function idSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createMemoryId(memoryDir: string, filePath: string, kind: MemoryKind): string {
  const relative = path.relative(path.join(memoryDir, kind === "state" ? "state" : "events"), filePath);
  const segments = relative.split(path.sep).map(idSegment).filter(Boolean);
  return [kind, ...segments].join(".");
}

function memoryIdFromRelativePath(memoryDir: string, relPath: string, kind: MemoryKind): string {
  return createMemoryId(memoryDir, resolveMemoryPath(memoryDir, relPath), kind);
}

export function resolveMemoryWriteTarget(
  memoryDir: string,
  relPath: string,
  requestedKind?: MemoryKind,
  existingId?: string,
  existingKind?: MemoryKind,
  requireExistingId = false,
  allowLegacyPath = false,
): { filePath: string; id: string; kind: MemoryKind } {
  if (!relPath.endsWith(".md")) throw new Error("Memory path must end with .md");
  const resolvedPath = resolveMemoryPath(memoryDir, relPath);
  const normalizedRel = path.relative(memoryDir, resolvedPath);
  const [namespace] = normalizedRel.split(path.sep);

  if (namespace === MEMORY_RECORDS_DIR) {
    const id = recordIdFromPath(memoryDir, resolvedPath);
    if (!id || !MEMORY_KEY_PATTERN.test(id)) throw new Error("Record path must be records/<stable-id>.md");
    const kind = inferKindFromId(id);
    if (!kind) throw new Error("Record ID must start with state. or event.");
    if (requestedKind && requestedKind !== kind) {
      throw new Error(`kind '${requestedKind}' does not match record lifecycle '${kind}'`);
    }
    return { filePath: resolvedPath, id, kind };
  }

  if (namespace !== "state" && namespace !== "events") {
    throw new Error("Memory path must be under state/, events/, or records/");
  }

  const inferredKind = namespace === "state" ? "state" : "event";
  if (requestedKind && requestedKind !== inferredKind) {
    throw new Error(`kind '${requestedKind}' does not match path lifecycle '${inferredKind}'`);
  }

  const id = existingId ?? memoryIdFromRelativePath(memoryDir, normalizedRel, inferredKind);
  if (requireExistingId && !existingId) throw new Error("Existing legacy file has no stable ID");
  const kind = existingKind ?? inferredKind;
  if (kind !== inferredKind) throw new Error(`Existing kind '${kind}' does not match path lifecycle '${inferredKind}'`);
  return { filePath: allowLegacyPath ? resolvedPath : recordPathForId(memoryDir, id), id, kind };
}

export function findMemoryFileById(memoryDir: string, id: string): string | null {
  const normalized = normalizeMemoryId(id);
  const recordPath = recordPathForId(memoryDir, normalized);
  if (fs.existsSync(recordPath)) return recordPath;

  for (const entry of getMemoryCatalog(memoryDir)) {
    if (entry.id === normalized) return path.join(memoryDir, entry.path);
  }

  for (const filePath of listMemoryFiles(memoryDir)) {
    const memory = readMemoryFile(filePath);
    if (memory?.frontmatter.id === normalized) return filePath;
  }
  return null;
}

export function resolveMemoryFile(memoryDir: string, pathOrId: string): string {
  if (pathOrId.startsWith("@")) {
    const filePath = findMemoryFileById(memoryDir, pathOrId);
    if (!filePath) throw new Error(`Memory ID not found: ${pathOrId}`);
    return filePath;
  }

  const filePath = resolveMemoryPath(memoryDir, pathOrId);
  if (fs.existsSync(filePath)) return filePath;

  const kind = inferMemoryKind(memoryDir, filePath);
  if (kind) {
    const id = createMemoryId(memoryDir, filePath, kind);
    const recordPath = recordPathForId(memoryDir, id);
    if (fs.existsSync(recordPath)) return recordPath;
  }

  return filePath;
}

export function writeMemoryFile(filePath: string, content: string, frontmatter: MemoryFrontmatter): void {
  const fileDir = path.dirname(filePath);
  fs.mkdirSync(fileDir, { recursive: true });
  fs.writeFileSync(filePath, stringifyFrontmatter(content, frontmatter));
}

function catalogEntryFromMemory(memoryDir: string, filePath: string): MemoryCatalogEntry | null {
  const memory = readMemoryFile(filePath);
  if (!memory?.frontmatter.id || !memory.frontmatter.kind) return null;
  const stats = fs.statSync(filePath);
  const semantic = parseMemoryFacts(memory.content);
  return {
    path: path.relative(memoryDir, filePath),
    id: memory.frontmatter.id,
    kind: memory.frontmatter.kind,
    description: memory.frontmatter.description ?? "No description",
    summary: memory.frontmatter.summary,
    concepts: memory.frontmatter.concepts ?? [],
    claims: memory.frontmatter.claims ?? [],
    tags: memory.frontmatter.tags ?? [],
    facts: semantic.facts,
    relations: semantic.relations,
    created: memory.frontmatter.created,
    updated: memory.frontmatter.updated,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    content: memory.content,
  };
}

function memoryFromCatalogEntry(memoryDir: string, entry: MemoryCatalogEntry) {
  return {
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
    content: entry.content,
  };
}

function readMemoryCatalog(memoryDir: string): MemoryCatalog | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath(memoryDir), "utf-8")) as MemoryCatalog;
    if (parsed.version !== MEMORY_CATALOG_VERSION || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMemoryCatalog(memoryDir: string, entries: MemoryCatalogEntry[]): void {
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(
    catalogPath(memoryDir),
    `${JSON.stringify({ version: MEMORY_CATALOG_VERSION, entries }, null, 2)}\n`,
  );
}

function catalogIsFresh(memoryDir: string, entries: MemoryCatalogEntry[]): boolean {
  const files = listMemoryFiles(memoryDir);
  if (files.length !== entries.length) return false;
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const filePath of files) {
    const relPath = path.relative(memoryDir, filePath);
    const entry = byPath.get(relPath);
    if (!entry) return false;
    const stats = fs.statSync(filePath);
    if (entry.size !== stats.size || entry.mtimeMs !== stats.mtimeMs) return false;
  }
  return true;
}

export function rebuildMemoryCatalog(memoryDir: string): MemoryCatalogEntry[] {
  const entries = listMemoryFiles(memoryDir)
    .map((filePath) => catalogEntryFromMemory(memoryDir, filePath))
    .filter((entry): entry is MemoryCatalogEntry => Boolean(entry))
    .sort((a, b) => a.path.localeCompare(b.path));
  writeMemoryCatalog(memoryDir, entries);
  return entries;
}

export function getMemoryCatalog(memoryDir: string): MemoryCatalogEntry[] {
  const catalog = readMemoryCatalog(memoryDir);
  if (catalog && catalogIsFresh(memoryDir, catalog.entries)) return catalog.entries;
  return rebuildMemoryCatalog(memoryDir);
}

export function upsertMemoryCatalog(memoryDir: string, filePath: string): void {
  const entry = catalogEntryFromMemory(memoryDir, filePath);
  if (!entry) return;
  const catalog = readMemoryCatalog(memoryDir);
  const entries =
    catalog?.entries.filter((candidate) => candidate.path !== entry.path && candidate.id !== entry.id) ?? [];
  entries.push(entry);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  writeMemoryCatalog(memoryDir, entries);
}

export function memoryFileFromCatalogEntry(memoryDir: string, entry: MemoryCatalogEntry) {
  return memoryFromCatalogEntry(memoryDir, entry);
}
/**
 * Memory context
 */

function ensureDirectoryStructure(memoryDir: string): void {
  fs.mkdirSync(path.join(memoryDir, MEMORY_RECORDS_DIR), { recursive: true });
}

function createDefaultFiles(memoryDir: string): void {
  const today = getCurrentDate();
  const defaults: Array<{ id: string; description: string; tags: string[]; content: string }> = [
    {
      id: "state.identity",
      description: "Project-specific user identity and background",
      tags: ["user", "identity"],
      content: `# User Identity\n\n${MEMORY_FACTS_START}\nuser.identity = "Customize this fact"\n${MEMORY_FACTS_END}`,
    },
    {
      id: "state.preferences",
      description: "Project-specific user and collaboration preferences",
      tags: ["user", "preferences"],
      content: `# User Preferences\n\n${MEMORY_FACTS_START}\ncommunication.style = "concise"\n${MEMORY_FACTS_END}`,
    },
  ];

  for (const entry of defaults) {
    const filePath = recordPathForId(memoryDir, entry.id);
    if (fs.existsSync(filePath)) continue;
    writeMemoryFile(filePath, entry.content, {
      description: entry.description,
      tags: entry.tags,
      created: today,
      updated: today,
    });
    upsertMemoryCatalog(memoryDir, filePath);
  }
}

export { createDefaultFiles, ensureDirectoryStructure };

const MAX_INJECTED_MEMORY_FILES = 10;

function memoryTimestamp(filePath: string, frontmatter: MemoryFrontmatter): number {
  for (const value of [frontmatter.updated, frontmatter.created]) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return fs.statSync(filePath).mtimeMs;
}

export function buildMemoryContext(settings: MemoryMdSettings, cwd: string): string {
  const memoryDir = getMemoryDir(settings, cwd);
  if (!fs.existsSync(memoryDir)) return "";

  const memories = getMemoryCatalog(memoryDir)
    .sort(
      (a, b) =>
        memoryTimestamp(path.join(memoryDir, b.path), b) - memoryTimestamp(path.join(memoryDir, a.path), a) ||
        a.path.localeCompare(b.path),
    )
    .slice(0, MAX_INJECTED_MEMORY_FILES);
  if (memories.length === 0) return "";

  const lines: string[] = [
    "# Project Memory",
    "",
    "Recent memory files (use memory_read with a path or @id for full content):",
    "",
  ];

  for (const entry of memories) {
    lines.push(`- ${entry.path} (@${entry.id})`);
    lines.push(`  Kind: ${entry.kind}`);
    lines.push(`  Description: ${entry.description}`);
    lines.push(`  Tags: ${entry.tags.join(", ") || "none"}`);
    lines.push("");
  }

  return lines.join("\n");
}
