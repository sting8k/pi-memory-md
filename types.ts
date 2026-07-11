import type { FrontmatterData } from "./frontmatter.js";

/**
 * Type definitions for memory files, settings, and git operations.
 */

export type MemoryKind = "state" | "event";
export type MemoryReadView = "full" | "summary" | "knowledge";

export type MemoryFactValue = string | number | boolean | null | Array<string | number | boolean | null>;

export interface StructuredMemoryFields {
  summary?: string;
  concepts?: string[];
  claims?: string[];
  facts?: Record<string, MemoryFactValue>;
  relations?: Record<string, string>;
  notes?: string;
}

export interface MemoryFrontmatter {
  id?: string;
  kind?: MemoryKind;
  description: string;
  summary?: string;
  concepts?: string[];
  claims?: string[];
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
