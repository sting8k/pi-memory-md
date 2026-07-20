import type { FrontmatterData } from "./frontmatter.js";

/**
 * Type definitions for memory files, settings, and git operations.
 */

export type MemoryKind = "state" | "event";
export type MemoryReadView = "full" | "summary" | "knowledge";

export type MemoryFactValue = string | number | boolean | null | Array<string | number | boolean | null>;
export type MemoryFactInputValue = MemoryFactValue | { [key: string]: MemoryFactInputValue };

export interface StructuredMemoryFields {
  summary?: string;
  concepts?: string[];
  claims?: string[];
  facts?: Record<string, MemoryFactInputValue>;
  relations?: Record<string, string>;
  notes?: string;
}

export interface ConceptDictionary {
  version: 1;
  concepts: string[];
  aliases: Record<string, string>;
}

export interface ConceptDuplicateHint {
  concept: string;
  candidate: string;
  score: number;
}

export interface ConceptNormalizationAudit {
  canonical: string[];
  resolvedAliases: Record<string, string>;
  registered: string[];
  possibleDuplicates: ConceptDuplicateHint[];
}

export interface MemoryFrontmatter {
  id?: string;
  kind?: MemoryKind;
  description: string;
  summary?: string;
  concepts?: string[];
  claims?: string[];
  sensitive?: boolean;
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
