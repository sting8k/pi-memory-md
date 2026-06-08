import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import matter from "gray-matter";
import type { GitResult, MemoryFrontmatter, MemoryMdSettings, ParsedFrontmatter } from "./types.js";

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

export function getMemoryDir(settings: MemoryMdSettings, cwd: string): string {
  if (!localPath) {
    localPath = settings.localPath || DEFAULT_LOCAL_PATH;
  }
  return path.join(localPath, path.basename(cwd));
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

export function migrateMemoryProject(settings: MemoryMdSettings, input: MemoryMigrateInput): MemoryMigrateResult {
  const mode = input.mode ?? "move";
  const dryRun = input.dryRun ?? false;
  const to = input.to?.trim() || path.basename(input.cwd);
  const from = input.from.trim();
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
    const fromError = validateProjectFolderName(from, "from");
    if (fromError) return fail(fromError);

    const toError = validateProjectFolderName(to, "to");
    if (toError) return fail(toError);

    if (from === to) return fail("Source and destination project folders are the same");

    const fromStats = lstatIfExists(fromPath);
    if (!fromStats) {
      return fail(`Source memory folder not found: ${from}`, { candidates: listProjectMemoryFolders(memoryRoot) });
    }
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

function validateFrontmatter(data: ParsedFrontmatter): { valid: boolean; error?: string } {
  if (!data) {
    return { valid: false, error: "No frontmatter found (requires --- delimiters)" };
  }

  const frontmatter = data as MemoryFrontmatter;

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
    const parsed = matter(content);

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
      frontmatter: parsed.data as MemoryFrontmatter,
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

export function writeMemoryFile(filePath: string, content: string, frontmatter: MemoryFrontmatter): void {
  const fileDir = path.dirname(filePath);
  fs.mkdirSync(fileDir, { recursive: true });
  const frontmatterStr = matter.stringify(content, frontmatter);
  fs.writeFileSync(filePath, frontmatterStr);
}

/**
 * Memory context
 */

function ensureDirectoryStructure(memoryDir: string): void {
  const dirs = [
    path.join(memoryDir, "core", "user"),
    path.join(memoryDir, "core", "project"),
    path.join(memoryDir, "reference"),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createDefaultFiles(memoryDir: string): void {
  const identityFile = path.join(memoryDir, "core", "user", "identity.md");
  if (!fs.existsSync(identityFile)) {
    writeMemoryFile(identityFile, "# User Identity\n\nCustomize this file with your information.", {
      description: "User identity and background",
      tags: ["user", "identity"],
      created: getCurrentDate(),
    });
  }

  const preferFile = path.join(memoryDir, "core", "user", "prefer.md");
  if (!fs.existsSync(preferFile)) {
    writeMemoryFile(
      preferFile,
      "# User Preferences\n\n## Communication Style\n- Be concise\n- Show code examples\n\n## Code Style\n- 2 space indentation\n- Prefer const over var\n- Functional programming preferred",
      {
        description: "User habits and code style preferences",
        tags: ["user", "preferences"],
        created: getCurrentDate(),
      },
    );
  }
}

export { createDefaultFiles, ensureDirectoryStructure };

const MAX_INJECTED_MEMORY_FILES = 10;

export function buildMemoryContext(settings: MemoryMdSettings, cwd: string): string {
  const memoryDir = getMemoryDir(settings, cwd);
  const coreDir = path.join(memoryDir, "core");

  if (!fs.existsSync(coreDir)) {
    return "";
  }

  const files = listMemoryFiles(coreDir)
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath))
    .slice(0, MAX_INJECTED_MEMORY_FILES)
    .map(({ filePath }) => filePath);
  if (files.length === 0) {
    return "";
  }

  const lines: string[] = [
    "# Project Memory",
    "",
    "Available memory files (use memory_read to view full content):",
    "",
  ];

  for (const filePath of files) {
    const memory = readMemoryFile(filePath);
    if (memory) {
      const relPath = path.relative(memoryDir, filePath);
      const { description, tags } = memory.frontmatter;
      const tagStr = tags?.join(", ") || "none";
      lines.push(`- ${relPath}`);
      lines.push(`  Description: ${description}`);
      lines.push(`  Tags: ${tagStr}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
