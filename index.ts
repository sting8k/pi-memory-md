import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildMemoryContext,
  createDefaultFiles,
  ensureDirectoryStructure,
  getMemoryDir,
  gitExec,
  loadSettings,
  type MemoryMdSettings,
  syncRepository,
} from "./memoryMdCore.js";
import { registerAllMemoryTools } from "./tools.js";

/**
 * Main extension initialization.
 */

export default function memoryMdExtension(pi: ExtensionAPI) {
  let settings: MemoryMdSettings = loadSettings();
  const repoInitialized = { value: false };
  let syncPromise: ReturnType<typeof syncRepository> | null = null;
  let cachedMemoryContext: string | null = null;
  let memoryInjected = false;

  function initMemoryContext(
    ctx: ExtensionContext,
    options: { showNotification: boolean; autoSync: boolean },
  ): boolean {
    settings = loadSettings();

    if (!settings.enabled) return false;

    const memoryDir = getMemoryDir(settings, ctx.cwd);

    if (!fs.existsSync(memoryDir)) {
      if (options.showNotification) {
        ctx.ui.notify("Memory-md not initialized. Use /memory-init to set up project memory.", "info");
      }
      return false;
    }

    if (options.autoSync && settings.autoSync?.onSessionStart && settings.localPath) {
      syncPromise = syncRepository(pi, settings, repoInitialized).then((syncResult) => {
        if (settings.repoUrl) {
          ctx.ui.notify(syncResult.message, syncResult.success ? "info" : "error");
        }
        return syncResult;
      });
    }

    cachedMemoryContext = buildMemoryContext(settings, ctx.cwd);
    memoryInjected = false;
    return true;
  }

  pi.on("session_start", async (event, ctx) => {
    if (event.reason === "new" || event.reason === "fork") {
      syncPromise = null;
      initMemoryContext(ctx, { showNotification: true, autoSync: false });
    } else {
      initMemoryContext(ctx, { showNotification: true, autoSync: true });
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (syncPromise) {
      await syncPromise;
      syncPromise = null;
    }

    const mode = settings.injection || "message-append";

    if (!cachedMemoryContext) return undefined;

    const isFirstInjection = !memoryInjected;

    if (isFirstInjection) {
      memoryInjected = true;
      const fileCount = cachedMemoryContext.split("\n").filter((l) => l.startsWith("-")).length;
      ctx.ui.notify(`Memory injected: ${fileCount} files (${mode})`, "info");
    }

    if (mode === "message-append" && isFirstInjection) {
      return {
        message: {
          customType: "pi-memory-md",
          content: cachedMemoryContext,
          display: false,
        },
      };
    }

    if (mode === "system-prompt") {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${cachedMemoryContext}`,
      };
    }

    return undefined;
  });

  registerAllMemoryTools(pi, settings, repoInitialized);

  pi.registerCommand("memory-status", {
    description: "Show memory repository status",
    handler: async (_args, ctx) => {
      const memoryDir = getMemoryDir(settings, ctx.cwd);
      const projectName = path.basename(memoryDir);

      if (!fs.existsSync(memoryDir)) {
        ctx.ui.notify(`Memory: ${projectName} | Not initialized | Use /memory-init to set up`, "info");
        return;
      }

      const result = await gitExec(pi, settings.localPath!, ["status", "--porcelain"]);
      const isDirty = result.stdout.trim().length > 0;

      ctx.ui.notify(
        `Memory: ${projectName} | Repo: ${isDirty ? "Uncommitted changes" : "Clean"} | Path: ${memoryDir}`,
        isDirty ? "warning" : "info",
      );
    },
  });

  pi.registerCommand("memory-init", {
    description: "Initialize memory repository",
    handler: async (_args, ctx) => {
      const memoryDir = getMemoryDir(settings, ctx.cwd);
      const alreadyInitialized = fs.existsSync(memoryDir);

      const result = await syncRepository(pi, settings, repoInitialized);

      if (!result.success) {
        ctx.ui.notify(`Initialization failed: ${result.message}`, "error");
        return;
      }

      ensureDirectoryStructure(memoryDir);
      createDefaultFiles(memoryDir);

      if (alreadyInitialized) {
        ctx.ui.notify(`Memory already exists: ${result.message}`, "info");
      } else {
        ctx.ui.notify(`Memory initialized: ${result.message}\n\nCreated:\n  - records`, "info");
      }
    },
  });

  pi.registerCommand("memory-refresh", {
    description: "Refresh memory context from files",
    handler: async (_args, ctx) => {
      const memoryContext = buildMemoryContext(settings, ctx.cwd);

      if (!memoryContext) {
        ctx.ui.notify("No memory files found to refresh", "warning");
        return;
      }

      cachedMemoryContext = memoryContext;
      memoryInjected = false;

      const mode = settings.injection || "message-append";
      const fileCount = memoryContext.split("\n").filter((l) => l.startsWith("-")).length;

      if (mode === "message-append") {
        pi.sendMessage({
          customType: "pi-memory-md-refresh",
          content: memoryContext.replace(/^# Project Memory/, "# Project Memory (Refreshed)"),
          display: false,
        });
        ctx.ui.notify(`Memory refreshed: ${fileCount} files injected (${mode})`, "info");
      } else {
        ctx.ui.notify(`Memory cache refreshed: ${fileCount} files (will be injected on next prompt)`, "info");
      }
    },
  });

  pi.registerCommand("memory-check", {
    description: "Check memory folder structure",
    handler: async (_args, ctx) => {
      const memoryDir = getMemoryDir(settings, ctx.cwd);

      if (!fs.existsSync(memoryDir)) {
        ctx.ui.notify(`Memory directory not found: ${memoryDir}`, "error");
        return;
      }

      const { execSync } = await import("node:child_process");
      let treeOutput = "";

      try {
        treeOutput = execSync(`tree -L 3 -I "node_modules" "${memoryDir}"`, { encoding: "utf-8" });
      } catch {
        try {
          treeOutput = execSync(`find "${memoryDir}" -type d -not -path "*/node_modules/*"`, { encoding: "utf-8" });
        } catch {
          treeOutput = "Unable to generate directory tree.";
        }
      }

      ctx.ui.notify(treeOutput.trim(), "info");
    },
  });
}
