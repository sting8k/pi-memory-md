import type { FrontmatterData } from "./frontmatter.js";

/**
 * Type definitions for memory files, settings, and git operations.
 */

export type MemoryKind = "state" | "event";

export interface MemoryFrontmatter {
  id?: string;
  kind?: MemoryKind;
  description: string;
  limit?: number;
  tags?: string[];
  created?: string;
  updated?: string;
}

export interface MemoryFile {
  path: string;
  frontmatter: MemoryFrontmatter;
  content: string;
}

export interface MemoryMdSettings {
  enabled?: boolean;
  repoUrl?: string;
  localPath?: string;
  autoSync?: {
    onSessionStart?: boolean;
  };
  injection?: "system-prompt" | "message-append";
  systemPrompt?: {
    maxTokens?: number;
    includeProjects?: string[];
  };
  tape?: {
    enabled?: boolean;
    context?: {
      strategy?: "smart" | "recent-only";
      fileLimit?: number;
      alwaysInclude?: string[];
    };
    anchor?: {
      mode?: "hand" | "threshold" | "manual";
      threshold?: number;
    };
    tapePath?: string;
  };
}

export interface GitResult {
  stdout: string;
  success: boolean;
  timeout?: boolean;
}

export interface SyncResult {
  success: boolean;
  message: string;
  updated?: boolean;
}

export type ParsedFrontmatter = FrontmatterData;
