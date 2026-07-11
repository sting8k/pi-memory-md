import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import type { GitResult, MemoryFrontmatter, MemoryKind, MemoryMdSettings, ParsedFrontmatter } from "./types.js";

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
    tape: {
      enabled: false,
      context: {
        strategy: "smart",
        fileLimit: 10,
      },
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

  if (!repoUrl || !localPath) {
    return { success: false, message: "GitHub repo URL or local path not configured" };
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

export function validateMemoryContent(content: string): { valid: boolean; error?: string } {
  const startCount = content.split(MEMORY_FACTS_START).length - 1;
  const endCount = content.split(MEMORY_FACTS_END).length - 1;

  if (startCount === 0 && endCount === 0) return { valid: true };
  if (startCount !== 1 || endCount !== 1) {
    return { valid: false, error: "Memory content must contain exactly one complete facts block" };
  }

  const start = content.indexOf(MEMORY_FACTS_START) + MEMORY_FACTS_START.length;
  const end = content.indexOf(MEMORY_FACTS_END);
  if (end < start) return { valid: false, error: "Memory facts end marker must follow the start marker" };

  const keys = new Set<string>();
  for (const rawLine of content.slice(start, end).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const relation = line.match(/^([a-z][a-z0-9_.-]*)\s*->\s*@([a-z][a-z0-9_.-]*)$/);
    if (relation) {
      if (keys.has(relation[1])) return { valid: false, error: `Duplicate memory fact key: ${relation[1]}` };
      keys.add(relation[1]);
      continue;
    }

    const assignment = line.match(/^([a-z][a-z0-9_.-]*)\s*=\s*(.+)$/);
    if (!assignment || !MEMORY_KEY_PATTERN.test(assignment[1])) {
      return { valid: false, error: `Invalid memory fact line: ${line}` };
    }

    try {
      const value = JSON.parse(assignment[2]);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return { valid: false, error: `Memory fact values cannot be objects: ${assignment[1]}` };
      }
    } catch {
      return { valid: false, error: `Memory fact value must be valid JSON: ${assignment[1]}` };
    }

    if (keys.has(assignment[1])) return { valid: false, error: `Duplicate memory fact key: ${assignment[1]}` };
    keys.add(assignment[1]);
  }

  return { valid: true };
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

  if (frontmatter.limit !== undefined && (typeof frontmatter.limit !== "number" || frontmatter.limit <= 0)) {
    return { valid: false, error: "'limit' must be a positive number" };
  }

  if (frontmatter.tags !== undefined && !Array.isArray(frontmatter.tags)) {
    return { valid: false, error: "'tags' must be an array of strings" };
  }

  return { valid: true };
}

export function readMemoryFile(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(content);

    if (!parsed.data || Object.keys(parsed.data).length === 0) {
      return {
        path: filePath,
        frontmatter: { description: "No description" },
        content: content,
      };
    }

    const validation = validateFrontmatter(parsed.data);

    if (!validation.valid) {
      return {
        path: filePath,
        frontmatter: { description: "No description" },
        content: content,
      };
    }

    return {
      path: filePath,
      frontmatter: parsed.data as unknown as MemoryFrontmatter,
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

export function findMemoryFileById(memoryDir: string, id: string): string | null {
  const normalized = id.startsWith("@") ? id.slice(1) : id;
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
  return resolveMemoryPath(memoryDir, pathOrId);
}

export function writeMemoryFile(filePath: string, content: string, frontmatter: MemoryFrontmatter): void {
  const fileDir = path.dirname(filePath);
  fs.mkdirSync(fileDir, { recursive: true });
  fs.writeFileSync(filePath, stringifyFrontmatter(content, frontmatter));
}

/**
 * Memory context
 */

function ensureDirectoryStructure(memoryDir: string): void {
  for (const dir of [path.join(memoryDir, "state"), path.join(memoryDir, "events")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createDefaultFiles(memoryDir: string): void {
  const today = getCurrentDate();
  const defaults: Array<{ name: string; description: string; tags: string[]; content: string }> = [
    {
      name: "identity.md",
      description: "Project-specific user identity and background",
      tags: ["user", "identity"],
      content: `# User Identity\n\n${MEMORY_FACTS_START}\nuser.identity = "Customize this fact"\n${MEMORY_FACTS_END}`,
    },
    {
      name: "preferences.md",
      description: "Project-specific user and collaboration preferences",
      tags: ["user", "preferences"],
      content: `# User Preferences\n\n${MEMORY_FACTS_START}\ncommunication.style = "concise"\n${MEMORY_FACTS_END}`,
    },
  ];

  for (const entry of defaults) {
    const filePath = path.join(memoryDir, "state", entry.name);
    if (fs.existsSync(filePath)) continue;
    writeMemoryFile(filePath, entry.content, {
      id: createMemoryId(memoryDir, filePath, "state"),
      kind: "state",
      description: entry.description,
      tags: entry.tags,
      created: today,
      updated: today,
    });
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

  const memories = listMemoryFiles(memoryDir)
    .map((filePath) => ({ filePath, memory: readMemoryFile(filePath) }))
    .filter((entry): entry is { filePath: string; memory: NonNullable<ReturnType<typeof readMemoryFile>> } =>
      Boolean(entry.memory),
    )
    .sort(
      (a, b) =>
        memoryTimestamp(b.filePath, b.memory.frontmatter) - memoryTimestamp(a.filePath, a.memory.frontmatter) ||
        a.filePath.localeCompare(b.filePath),
    )
    .slice(0, MAX_INJECTED_MEMORY_FILES);
  if (memories.length === 0) return "";

  const lines: string[] = [
    "# Project Memory",
    "",
    "Recent memory files (use memory_read with a path or @id for full content):",
    "",
  ];

  for (const { filePath, memory } of memories) {
    const relPath = path.relative(memoryDir, filePath);
    const { id, kind, description, tags } = memory.frontmatter;
    lines.push(`- ${relPath}${id ? ` (@${id})` : ""}`);
    lines.push(`  Kind: ${kind ?? inferMemoryKind(memoryDir, filePath) ?? "legacy"}`);
    lines.push(`  Description: ${description}`);
    lines.push(`  Tags: ${tags?.join(", ") || "none"}`);
    lines.push("");
  }

  return lines.join("\n");
}
