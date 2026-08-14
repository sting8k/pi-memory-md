import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter, stringifyFrontmatter } from "../.test-dist/frontmatter.js";
import {
  addConceptAlias,
  buildMemoryContext,
  buildStructuredMemoryContent,
  createMemoryId,
  deleteMemoryFile,
  findMemoryFileById,
  formatMemoryRead,
  getConceptDictionary,
  getMemoryCatalog,
  getMemoryDir,
  MEMORY_FACTS_END,
  MEMORY_FACTS_START,
  memoryFileFromCatalogEntry,
  migrateMemoryProject,
  normalizeConceptLabel,
  normalizeConceptSearchQuery,
  normalizeMemoryConcepts,
  parseMemoryFacts,
  readMemoryFile,
  resolveMemoryPath,
  resolveMemoryWriteTarget,
  syncRepository,
  upsertMemoryCatalog,
  validateMemoryContent,
  writeMemoryFile,
} from "../.test-dist/memoryMdCore.js";
import { searchMemoryFiles } from "../.test-dist/search-engine.js";
import {
  registerMemoryAlias,
  registerMemoryDelete,
  registerMemorySearch,
  registerMemoryWrite,
} from "../.test-dist/tools.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-v2-"));
  const workspace = path.join(root, "My Project");
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  const settings = { localPath: path.join(root, "memory") };
  return { root, workspace, settings };
}

function fakePi() {
  const tools = new Map();
  return {
    tools,
    pi: {
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
    },
  };
}

initTheme(undefined, false);

const renderTheme = {
  fg: (role, text) => `[${role}]${text}[/${role}]`,
  bold: (text) => text,
};

function renderToolText(component) {
  return component.render(500).join("\n");
}

test("memory_write create returns success with soft quality warnings", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    const signal = new AbortController().signal;

    const result = await tools.get("memory_write").execute(
      "write-create",
      {
        path: "events/create-diff.md",
        kind: "event",
        description: "Create diff test",
        content: "# Created\n",
      },
      signal,
      () => {},
      { cwd: workspace },
    );

    assert.equal(result.details.operation, "create");
    assert.equal(result.details.diff, undefined);
    assert.match(
      result.content[0].text,
      /^Memory file written: records\/event\.create-diff\.md \(@event\.create-diff\)/,
    );
    assert.match(result.content[0].text, /Memory write warnings:/);
    assert.match(result.content[0].text, /Add a one-sentence summary/);
    assert.deepEqual(result.details.warnings, [
      "Add a one-sentence summary so future searches do not need full prose.",
      "Add at least one claim or fact for durable retrieval.",
    ]);
    assert.doesNotMatch(result.content[0].text, /overwritten|── diff ──/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_write marks sensitive-looking records as non-injectable", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    const result = await tools.get("memory_write").execute(
      "write-sensitive",
      {
        path: "events/ops-access.md",
        kind: "event",
        description: "Ops access token path",
        summary: "Ops access details include credential paths",
        claims: ["Sensitive records should not be injected automatically"],
        facts: { "ssh.identity_file": "/tmp/key" },
      },
      new AbortController().signal,
      () => {},
      { cwd: workspace },
    );

    assert.equal(result.details.frontmatter.sensitive, true);
    assert.match(result.content[0].text, /Sensitive-looking content was marked sensitive/);
    const context = buildMemoryContext(settings, workspace);
    assert.doesNotMatch(context, /Ops access token path/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_write overwrite diff preserves a terminal-newline change", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    const tool = tools.get("memory_write");
    const signal = new AbortController().signal;

    await tool.execute(
      "write-no-terminal-newline",
      {
        path: "events/terminal-newline.md",
        kind: "event",
        description: "Terminal newline test",
        content: "# Terminal newline",
      },
      signal,
      () => {},
      { cwd: workspace },
    );
    const result = await tool.execute(
      "write-with-terminal-newline",
      {
        path: "events/terminal-newline.md",
        kind: "event",
        description: "Terminal newline test",
        content: "# Terminal newline\n",
      },
      signal,
      () => {},
      { cwd: workspace },
    );

    assert.equal(result.details.operation, "overwrite");
    assert.equal(result.details.diff.newLines.at(-1), "");
    assert.match(result.content[0].text, /\n\+ /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_write overwrite response includes compact diff and renderer stats", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    const tool = tools.get("memory_write");
    const signal = new AbortController().signal;

    await tool.execute(
      "write-before",
      {
        path: "events/overwrite-diff.md",
        kind: "event",
        description: "Overwrite diff test",
        summary: "First summary",
        claims: ["first claim"],
      },
      signal,
      () => {},
      { cwd: workspace },
    );
    const result = await tool.execute(
      "write-after",
      {
        path: "events/overwrite-diff.md",
        kind: "event",
        description: "Overwrite diff test",
        summary: "Second summary",
        claims: ["second claim"],
      },
      signal,
      () => {},
      { cwd: workspace },
    );

    const text = result.content[0].text;
    assert.equal(result.details.operation, "overwrite");
    assert.match(text, /^Memory file overwritten: records\/event\.overwrite-diff\.md \(@event\.overwrite-diff\)/);
    assert.match(text, /── diff ──\n:\d+(?:-\d+)?/);
    assert.match(text, /- summary: "First summary"/);
    assert.match(text, /\+ summary: "Second summary"/);
    assert.match(text, /- # First summary/);
    assert.match(text, /\+ # Second summary/);
    assert.equal(result.details.diff.text, text.split("\n\n")[1]);
    assert.equal(result.details.diff.additions, result.details.diff.newLines.length);
    assert.equal(result.details.diff.removals, result.details.diff.oldLines.length);

    const collapsed = renderToolText(tool.renderResult(result, { expanded: false, isPartial: false }, renderTheme));
    assert.match(collapsed, new RegExp(`\\[success\\]\\+${result.details.diff.additions}\\[/success\\]`));
    assert.match(collapsed, new RegExp(`\\[error\\]-${result.details.diff.removals}\\[/error\\]`));
    assert.match(collapsed, /overwrite/);
    assert.match(collapsed, new RegExp(`\\(${text.split("\n").length} more lines,`));

    const expanded = renderToolText(tool.renderResult(result, { expanded: true, isPartial: false }, renderTheme));
    assert.match(expanded, /\[success\]\+ summary: "Second summary"\[\/success\]/);
    assert.match(expanded, /\[error\]- summary: "First summary"\[\/error\]/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_write overwrite diff can use compatible legacy existing markdown", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    const legacyPath = path.join(memoryDir, "events", "legacy-overwrite.md");
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(
      legacyPath,
      stringifyFrontmatter("# Legacy heading\n", {
        id: "event.legacy-overwrite",
        kind: "event",
        description: "Legacy original",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      }),
    );

    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    const result = await tools.get("memory_write").execute(
      "write-legacy",
      {
        path: "events/legacy-overwrite.md",
        kind: "event",
        description: "Legacy replacement",
        content: "# Replacement heading\n",
      },
      new AbortController().signal,
      () => {},
      { cwd: workspace },
    );

    assert.equal(result.details.operation, "overwrite");
    assert.match(
      result.content[0].text,
      /^Memory file overwritten: records\/event\.legacy-overwrite\.md \(@event\.legacy-overwrite\)/,
    );
    assert.match(result.content[0].text, /- # Legacy heading/);
    assert.match(result.content[0].text, /\+ # Replacement heading/);
    assert.equal(fs.existsSync(path.join(memoryDir, "records", "event.legacy-overwrite.md")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("frontmatter parser reads legacy folded descriptions and block tags", () => {
  const parsed = parseFrontmatter(`---
description: >-
  A folded legacy
  description
updated: '2026-06-30'
tags:
  - comfyui
  - benchmark
---
# Report`);
  assert.equal(parsed.data.description, "A folded legacy description");
  assert.deepEqual(parsed.data.tags, ["comfyui", "benchmark"]);
  assert.equal(parsed.content, "# Report");
});

test("frontmatter v2 round-trips without external dependencies", () => {
  const serialized = stringifyFrontmatter("# Runtime", {
    id: "state.runtime",
    kind: "state",
    description: "Current runtime",
    tags: [],
    created: "2026-07-11",
  });
  const parsed = parseFrontmatter(serialized);
  assert.deepEqual(parsed.data.tags, []);
  assert.equal(parsed.data.id, "state.runtime");
  assert.equal(parsed.content, "# Runtime");
});

test("project memory is scoped to the Git root slug", () => {
  const { root, workspace, settings } = fixture();
  try {
    const nested = path.join(workspace, "packages", "app");
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(getMemoryDir(settings, nested), path.join(settings.localPath, "projects", "my-project"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local-only repository initialization does not require a repo URL", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-local-init-"));
  const initialized = { value: false };
  try {
    const result = await syncRepository(
      { exec: () => assert.fail("local-only initialization must not invoke git") },
      { localPath: path.join(root, "memory"), repoUrl: "" },
      initialized,
    );
    assert.equal(result.success, true);
    assert.equal(initialized.value, true);
    assert.equal(fs.existsSync(path.join(root, "memory")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy project migration dry-runs then moves reports into Memory v2", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-migrate-"));
  const cwd = path.join(root, "Legacy Project");
  const memoryRoot = path.join(root, "memory");
  const legacyRoot = path.join(memoryRoot, "Legacy Project");
  try {
    fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
    fs.mkdirSync(path.join(legacyRoot, "core", "user"), { recursive: true });
    fs.mkdirSync(path.join(legacyRoot, "core", "project"), { recursive: true });
    fs.writeFileSync(
      path.join(legacyRoot, "core", "user", "prefer.md"),
      "---\ndescription: User preferences\ntags:\n  - user\n---\n# Preferences",
    );
    fs.writeFileSync(
      path.join(legacyRoot, "core", "project", "report.md"),
      "---\ndescription: Historical report\nupdated: '2026-07-01'\n---\n# Report",
    );

    const input = { cwd, from: "Legacy Project" };
    const preview = migrateMemoryProject({ localPath: memoryRoot }, { ...input, dryRun: true });
    assert.equal(preview.success, true);
    assert.equal(preview.files, 2);
    assert.equal(fs.existsSync(legacyRoot), true);

    const result = migrateMemoryProject({ localPath: memoryRoot }, input);
    const projectRoot = path.join(memoryRoot, "projects", "legacy-project");
    assert.equal(result.success, true);
    assert.equal(fs.existsSync(legacyRoot), false);
    assert.equal(readMemoryFile(path.join(projectRoot, "state", "preferences.md")).frontmatter.id, "state.preferences");
    assert.equal(readMemoryFile(path.join(projectRoot, "events", "report.md")).frontmatter.kind, "event");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("new writes use identity-addressed records with inferred metadata", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    const target = resolveMemoryWriteTarget(memoryDir, "events/size-report.md", "event");
    assert.equal(target.id, "event.size-report");
    assert.equal(path.relative(memoryDir, target.filePath), path.join("records", "event.size-report.md"));

    writeMemoryFile(target.filePath, "# Size report", {
      description: "Size report",
      tags: ["benchmark"],
      created: "2026-07-11",
      updated: "2026-07-11",
    });
    upsertMemoryCatalog(memoryDir, target.filePath);

    const memory = readMemoryFile(target.filePath);
    assert.equal(memory.frontmatter.id, "event.size-report");
    assert.equal(memory.frontmatter.kind, "event");
    assert.equal(findMemoryFileById(memoryDir, "@event.size-report"), target.filePath);
    assert.equal(getMemoryCatalog(memoryDir).at(0).path, path.join("records", "event.size-report.md"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory paths cannot escape the current project", () => {
  assert.throws(() => resolveMemoryPath("/tmp/project-memory", "../other.md"), /must stay inside/);
});

test("logical IDs are deterministic for new files", () => {
  assert.equal(
    createMemoryId("/memory/projects/demo", "/memory/projects/demo/events/2026-07-11-report.md", "event"),
    "event.2026-07-11-report",
  );
});

test("facts DSL accepts JSON values and stable relations", () => {
  const valid = `${MEMORY_FACTS_START}\nruntime.vram_gib = 24\nrelated.report -> @event.benchmark-1\n${MEMORY_FACTS_END}`;
  assert.deepEqual(validateMemoryContent(valid), { valid: true });

  const invalid = `${MEMORY_FACTS_START}\nruntime.vram = 24 GiB\n${MEMORY_FACTS_END}`;
  assert.match(validateMemoryContent(invalid).error ?? "", /valid JSON/);
});

test("concept dictionary normalizes aliases and registers safe new concepts", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, ".concepts.json"),
      `${JSON.stringify(
        {
          version: 1,
          concepts: ["cafe-memory", "identity-addressed-record", "metadata-cache", "semantic-projection"],
          aliases: { "id-based-record": "identity-addressed-record", "knowledge-view": "semantic-projection" },
        },
        null,
        2,
      )}\n`,
    );

    const normalized = normalizeMemoryConcepts(memoryDir, [
      "ID based records",
      "Knowledge View",
      "compact context",
      "metadata-cash",
      "compact context",
    ]);

    assert.deepEqual(normalized.concepts, [
      "compact-context",
      "identity-addressed-record",
      "metadata-cash",
      "semantic-projection",
    ]);
    assert.deepEqual(normalized.audit.registered, ["compact-context", "metadata-cash"]);
    assert.equal(normalized.audit.resolvedAliases["id-based-records"], "identity-addressed-record");
    assert.equal(normalized.audit.resolvedAliases["knowledge-view"], "semantic-projection");
    assert.deepEqual(normalized.audit.possibleDuplicates, [
      { concept: "metadata-cash", candidate: "metadata-cache", score: 0.86 },
    ]);

    const dictionary = getConceptDictionary(memoryDir);
    assert.deepEqual(dictionary.concepts, [
      "cafe-memory",
      "compact-context",
      "identity-addressed-record",
      "metadata-cache",
      "metadata-cash",
      "semantic-projection",
    ]);
    assert.equal(normalizeConceptSearchQuery(memoryDir, "id based record"), "identity-addressed-record");
    assert.equal(normalizeConceptLabel("Café Memory"), "cafe-memory");
    assert.equal(
      normalizeConceptSearchQuery(memoryDir, "id based record knowledge view"),
      "identity-addressed-record semantic-projection",
    );
    assert.equal(normalizeConceptSearchQuery(memoryDir, "free form query"), "free-form-query");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory tools normalize concepts transparently", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, ".concepts.json"),
      `${JSON.stringify(
        {
          version: 1,
          concepts: ["identity-addressed-record", "metadata-cache", "semantic-projection"],
          aliases: { "id-based-record": "identity-addressed-record", "knowledge-view": "semantic-projection" },
        },
        null,
        2,
      )}\n`,
    );

    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    registerMemorySearch(pi, settings);
    const signal = new AbortController().signal;

    const writeResult = await tools.get("memory_write").execute(
      "write-1",
      {
        path: "events/concept-tool.md",
        kind: "event",
        description: "Concept tool test",
        summary: "Concept aliases are normalized before records are written",
        concepts: ["ID based records", "Knowledge View", "ID based record", "metadata cash"],
        claims: ["Tool calls should store canonical concepts"],
      },
      signal,
      () => {},
      { cwd: workspace },
    );

    assert.deepEqual(writeResult.details.frontmatter.concepts, [
      "identity-addressed-record",
      "metadata-cash",
      "semantic-projection",
    ]);
    assert.equal(writeResult.details.concepts.resolvedAliases["id-based-records"], "identity-addressed-record");
    assert.equal(writeResult.details.concepts.resolvedAliases["knowledge-view"], "semantic-projection");
    assert.match(writeResult.content[0].text, /Possible duplicate concepts:/);
    assert.match(writeResult.content[0].text, /metadata-cash is similar to metadata-cache/);
    assert.match(writeResult.details.frontmatter.created, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(writeResult.details.frontmatter.updated, /^\d{4}-\d{2}-\d{2}T/);

    const searchResult = await tools
      .get("memory_search")
      .execute("search-1", { query: "id based record", searchIn: "concepts" }, signal, () => {}, { cwd: workspace });
    assert.equal(searchResult.details.query, "identity-addressed-record");
    assert.equal(searchResult.details.count, 1);
    assert.equal(searchResult.details.results[0].path, path.join("records", "event.concept-tool.md"));

    await tools.get("memory_write").execute(
      "write-2",
      {
        path: "events/concept-distractor.md",
        kind: "event",
        description: "Concept distractor test",
        summary: "This record has only one of the searched concepts",
        concepts: ["ID based record"],
        claims: ["Exact concept search should not return this record for two-concept queries"],
      },
      signal,
      () => {},
      { cwd: workspace },
    );
    const multiConceptSearch = await tools
      .get("memory_search")
      .execute("search-2", { query: "id based record Knowledge View", searchIn: "concepts" }, signal, () => {}, {
        cwd: workspace,
      });
    assert.equal(multiConceptSearch.details.query, "identity-addressed-record semantic-projection");
    assert.equal(multiConceptSearch.details.count, 1);
    assert.equal(multiConceptSearch.details.results[0].path, path.join("records", "event.concept-tool.md"));

    const unknownConceptSearch = await tools
      .get("memory_search")
      .execute("search-3", { query: "unknown cleanup live orphan token", searchIn: "concepts" }, signal, () => {}, {
        cwd: workspace,
      });
    assert.equal(unknownConceptSearch.details.query, "unknown-cleanup-live-orphan-token");
    assert.equal(unknownConceptSearch.details.count, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory delete removes records and reconciles derived metadata", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, ".concepts.json"),
      `${JSON.stringify(
        {
          version: 1,
          concepts: ["alias-target", "kept-concept", "temporary-cleanup-concept", "unused-concept"],
          aliases: { "legacy-cleanup": "alias-target" },
        },
        null,
        2,
      )}\n`,
    );

    const keptTarget = resolveMemoryWriteTarget(memoryDir, "events/kept.md", "event");
    writeMemoryFile(keptTarget.filePath, "# Kept", {
      description: "Kept",
      concepts: ["kept-concept"],
      tags: [],
    });
    upsertMemoryCatalog(memoryDir, keptTarget.filePath);

    const deleteTarget = resolveMemoryWriteTarget(memoryDir, "events/delete-me.md", "event");
    writeMemoryFile(deleteTarget.filePath, "# Delete me", {
      description: "Delete me",
      concepts: ["temporary-cleanup-concept"],
      tags: [],
    });
    upsertMemoryCatalog(memoryDir, deleteTarget.filePath);

    const deleted = deleteMemoryFile(memoryDir, "@event.delete-me");
    assert.equal(deleted.id, "event.delete-me");
    assert.equal(fs.existsSync(deleteTarget.filePath), false);
    assert.deepEqual(
      getMemoryCatalog(memoryDir).map((entry) => entry.id),
      ["event.kept"],
    );

    const dictionary = getConceptDictionary(memoryDir);
    assert.deepEqual(dictionary.aliases, { "legacy-cleanup": "alias-target" });
    assert.deepEqual(dictionary.concepts, ["alias-target", "kept-concept", "unused-concept"]);

    const { pi, tools } = fakePi();
    registerMemoryDelete(pi, settings);
    assert.equal(tools.has("memory_delete"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("structured memory facts normalize nested objects and keys", () => {
  const content = buildStructuredMemoryContent({
    description: "Nested benchmark",
    facts: {
      task_times: { T2_seconds: 72, "Review score": "3/9" },
      "Run ID": "olm-glm-5.2",
    },
    relations: { "Evidence Link": "event.memory-v3" },
  });

  assert.deepEqual(validateMemoryContent(content), { valid: true });
  const semantic = parseMemoryFacts(content);
  assert.deepEqual(semantic.facts, {
    "task_times.t2_seconds": 72,
    "task_times.review_score": "3/9",
    run_id: "olm-glm-5.2",
  });
  assert.equal(semantic.relations["relation.evidence_link"], "@event.memory-v3");
});

test("structured memory records support compact semantic read and search", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    const target = resolveMemoryWriteTarget(memoryDir, "events/structured-benchmark.md", "event");
    const content = buildStructuredMemoryContent({
      description: "Structured benchmark",
      summary: "V3 optimizes semantic memory reads with compact projections",
      concepts: ["identity-addressed-record", "semantic-projection"],
      claims: ["Structured records avoid loading prose when facts are enough"],
      facts: { "benchmark.v3.write_ms": 0.269, "benchmark.sizes": [50, 1000, 10000] },
      relations: { implementation: "@event.memory-v3" },
      notes: "Evidence prose stays optional and should not appear in knowledge view.",
    });

    assert.deepEqual(validateMemoryContent(content), { valid: true });
    writeMemoryFile(target.filePath, content, {
      description: "Structured benchmark",
      summary: "V3 optimizes semantic memory reads with compact projections",
      concepts: ["identity-addressed-record", "semantic-projection"],
      claims: ["Structured records avoid loading prose when facts are enough"],
      tags: ["memory-v4", "structured"],
      created: "2026-07-11",
      updated: "2026-07-11",
    });
    upsertMemoryCatalog(memoryDir, target.filePath);

    const memory = readMemoryFile(target.filePath);
    const semantic = parseMemoryFacts(memory.content);
    assert.equal(semantic.facts["benchmark.v3.write_ms"], 0.269);
    assert.equal(semantic.relations["relation.implementation"], "@event.memory-v3");

    const catalogEntry = getMemoryCatalog(memoryDir).at(0);
    assert.equal(catalogEntry.summary, "V3 optimizes semantic memory reads with compact projections");
    assert.deepEqual(catalogEntry.concepts, ["identity-addressed-record", "semantic-projection"]);
    assert.equal("content" in catalogEntry, false);
    assert.equal("facts" in catalogEntry, false);
    assert.equal("relations" in catalogEntry, false);
    assert.doesNotMatch(content, /^## Summary$/m);
    assert.doesNotMatch(content, /^## Concepts$/m);
    assert.doesNotMatch(content, /^## Claims$/m);

    const knowledge = formatMemoryRead(memory, "knowledge");
    assert.match(knowledge, /## Facts/);
    assert.match(knowledge, /benchmark\.v3\.write_ms = 0\.269/);
    assert.doesNotMatch(knowledge, /Evidence prose/);

    const summary = formatMemoryRead(memory, "summary");
    assert.match(summary, /## Concepts/);
    assert.doesNotMatch(summary, /## Claims/);

    const hits = searchMemoryFiles({
      files: new Map([[catalogEntry.path, memoryFileFromCatalogEntry(memoryDir, catalogEntry)]]),
      query: normalizeConceptSearchQuery(memoryDir, "semantic projection"),
      searchIn: "concepts",
    });
    assert.equal(hits[0].path, path.join("records", "event.structured-benchmark.md"));
    assert.deepEqual(hits[0].matchedIn, ["concepts"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_search returns stable IDs and knowledge-read next steps", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    const target = resolveMemoryWriteTarget(memoryDir, "events/search-next.md", "event");
    writeMemoryFile(target.filePath, "# Search next\n", {
      description: "Search next step",
      summary: "Search results guide agents to compact knowledge reads",
      claims: ["Search output should include the stable ID and next read call"],
    });
    upsertMemoryCatalog(memoryDir, target.filePath);

    const { pi, tools } = fakePi();
    registerMemorySearch(pi, settings);
    const result = await tools
      .get("memory_search")
      .execute("search-next", { query: "compact knowledge", searchIn: "all" }, new AbortController().signal, () => {}, {
        cwd: workspace,
      });

    assert.equal(result.details.results[0].id, "event.search-next");
    assert.equal(result.details.results[0].next, 'memory_read({ path: "@event.search-next", view: "knowledge" })');
    assert.match(result.content[0].text, /records\/event\.search-next\.md \(@event\.search-next\)/);
    assert.match(result.content[0].text, /Next: memory_read\(\{ path: "@event\.search-next", view: "knowledge" \}\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("search treats metric queries literally while preserving explicit regex", () => {
  const files = new Map([
    [
      "records/event.benchmark.md",
      {
        path: "records/event.benchmark.md",
        frontmatter: {
          id: "event.benchmark",
          kind: "event",
          description: "Memory benchmark metrics",
          tags: ["benchmark"],
        },
        content: [
          "benchmark.v2.id_read_ms_10000 = 98.517",
          "benchmark.v2.latest-10 = 149.367",
          "benchmark.v3.catalog_lookup_ms_10000 = 0",
          "failure occurred during build",
        ].join("\n"),
      },
    ],
    [
      "records/event.decoy.md",
      {
        path: "records/event.decoy.md",
        frontmatter: { id: "event.decoy", kind: "event", description: "Decoy", tags: [] },
        content: "98x517 unrelated value",
      },
    ],
  ]);

  const metrics = searchMemoryFiles({
    files,
    query: "98.517 latest-10 catalog_lookup_ms_10000",
    searchIn: "all",
    kind: "event",
  });
  assert.equal(metrics[0].path, "records/event.benchmark.md");
  assert.equal(metrics[0].matchCount, 3);
  assert.equal(
    metrics.some((hit) => hit.path === "records/event.decoy.md"),
    false,
  );

  const regex = searchMemoryFiles({ files, query: "fail.*build", searchIn: "content" });
  assert.deepEqual(
    regex.map((hit) => hit.path),
    ["records/event.benchmark.md"],
  );
});

test("context injects only the ten most recently updated memories", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    for (let day = 1; day <= 12; day++) {
      const filePath = path.join(memoryDir, day % 2 === 0 ? "state" : "events", `memory-${day}.md`);
      const date = `2026-07-${String(day).padStart(2, "0")}`;
      writeMemoryFile(filePath, `# Memory ${day}`, {
        id: `${day % 2 === 0 ? "state" : "event"}.memory-${day}`,
        kind: day % 2 === 0 ? "state" : "event",
        description: `Memory ${day}`,
        created: date,
        updated: date,
      });
    }

    const secretPath = path.join(memoryDir, "events", "secret.md");
    writeMemoryFile(secretPath, "# Secret", {
      id: "event.secret",
      kind: "event",
      description: "Secret token path",
      sensitive: true,
      created: "2026-07-20",
      updated: "2026-07-20",
    });
    const context = buildMemoryContext(settings, workspace);
    assert.equal(context.split("\n").filter((line) => line.startsWith("- ")).length, 10);
    assert.match(context, /Memory 12/);
    assert.doesNotMatch(context, /Secret token path/);
    assert.match(context, /Memory 3/);
    assert.doesNotMatch(context, /Memory 2(?:\D|$)/);
    assert.doesNotMatch(context, /Memory 1(?:\D|$)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("context rebuilds old catalogs before filtering sensitive memories", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    const publicPath = path.join(memoryDir, "events", "public.md");
    const secretPath = path.join(memoryDir, "events", "secret.md");
    writeMemoryFile(publicPath, "# Public", {
      id: "event.public",
      kind: "event",
      description: "Public context",
      created: "2026-07-10",
      updated: "2026-07-10",
    });
    writeMemoryFile(secretPath, "# Secret", {
      id: "event.secret",
      kind: "event",
      description: "Secret token path",
      sensitive: true,
      created: "2026-07-20",
      updated: "2026-07-20",
    });

    const publicStats = fs.statSync(publicPath);
    const secretStats = fs.statSync(secretPath);
    fs.writeFileSync(
      path.join(memoryDir, ".catalog.json"),
      `${JSON.stringify(
        {
          version: 3,
          entries: [
            {
              path: path.relative(memoryDir, publicPath),
              id: "event.public",
              kind: "event",
              description: "Public context",
              concepts: [],
              claims: [],
              tags: [],
              created: "2026-07-10",
              updated: "2026-07-10",
              mtimeMs: publicStats.mtimeMs,
              size: publicStats.size,
            },
            {
              path: path.relative(memoryDir, secretPath),
              id: "event.secret",
              kind: "event",
              description: "Secret token path",
              concepts: [],
              claims: [],
              tags: [],
              created: "2026-07-20",
              updated: "2026-07-20",
              mtimeMs: secretStats.mtimeMs,
              size: secretStats.size,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const context = buildMemoryContext(settings, workspace);
    assert.match(context, /Public context/);
    assert.doesNotMatch(context, /Secret token path/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(memoryDir, ".catalog.json"), "utf-8")).version, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ============================================================================
// Kind-aware injection quota (5 state + 5 event, two-way backfill)
// ============================================================================

function injectedRecordIds(context) {
  return [...context.matchAll(/\(@([^)]+)\)/g)].map((match) => match[1]);
}

function writeDatedMemory(memoryDir, kind, id, day, datePrefix) {
  const filePath = path.join(memoryDir, kind === "state" ? "state" : "events", `${id}.md`);
  const date = `${datePrefix}-${String(day).padStart(2, "0")}`;
  writeMemoryFile(filePath, `# ${id}`, {
    id: `${kind}.${id}`,
    kind,
    description: `${kind} ${id}`,
    created: date,
    updated: date,
  });
}

test("context injects newest state and event records within a 5/5 quota", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    for (let day = 1; day <= 10; day++) {
      writeDatedMemory(memoryDir, day % 2 === 0 ? "state" : "event", `memory-${day}`, day, "2026-08");
    }
    const context = buildMemoryContext(settings, workspace);
    const ids = injectedRecordIds(context);
    const states = ids.filter((id) => id.startsWith("state."));
    const events = ids.filter((id) => id.startsWith("event."));
    assert.equal(ids.length, 10);
    assert.equal(states.length, 5);
    assert.equal(events.length, 5);
    assert.deepEqual(states, [
      "state.memory-10",
      "state.memory-8",
      "state.memory-6",
      "state.memory-4",
      "state.memory-2",
    ]);
    assert.deepEqual(events, [
      "event.memory-9",
      "event.memory-7",
      "event.memory-5",
      "event.memory-3",
      "event.memory-1",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("context backfills missing state quota with newest events", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    for (let day = 1; day <= 3; day++) writeDatedMemory(memoryDir, "state", `memory-${day}`, day, "2026-09");
    for (let day = 4; day <= 15; day++) writeDatedMemory(memoryDir, "event", `memory-${day}`, day, "2026-09");
    const context = buildMemoryContext(settings, workspace);
    const ids = injectedRecordIds(context);
    const states = ids.filter((id) => id.startsWith("state."));
    const events = ids.filter((id) => id.startsWith("event."));
    assert.equal(ids.length, 10);
    assert.deepEqual(states, ["state.memory-3", "state.memory-2", "state.memory-1"]);
    assert.equal(events.length, 7);
    assert.deepEqual(events, [
      "event.memory-15",
      "event.memory-14",
      "event.memory-13",
      "event.memory-12",
      "event.memory-11",
      "event.memory-10",
      "event.memory-9",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("context backfills missing event quota with newest states", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    for (let day = 1; day <= 8; day++) writeDatedMemory(memoryDir, "state", `memory-${day}`, day, "2026-10");
    for (let day = 9; day <= 10; day++) writeDatedMemory(memoryDir, "event", `memory-${day}`, day, "2026-10");
    const context = buildMemoryContext(settings, workspace);
    const ids = injectedRecordIds(context);
    const states = ids.filter((id) => id.startsWith("state."));
    const events = ids.filter((id) => id.startsWith("event."));
    assert.equal(ids.length, 10);
    assert.equal(states.length, 8);
    assert.equal(events.length, 2);
    assert.deepEqual(states, [
      "state.memory-8",
      "state.memory-7",
      "state.memory-6",
      "state.memory-5",
      "state.memory-4",
      "state.memory-3",
      "state.memory-2",
      "state.memory-1",
    ]);
    assert.deepEqual(events, ["event.memory-10", "event.memory-9"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("context injects only events when a project has no state records", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    for (let day = 1; day <= 12; day++) writeDatedMemory(memoryDir, "event", `memory-${day}`, day, "2026-11");
    const context = buildMemoryContext(settings, workspace);
    const ids = injectedRecordIds(context);
    assert.equal(ids.length, 10);
    assert.equal(ids.filter((id) => id.startsWith("state.")).length, 0);
    assert.equal(ids.filter((id) => id.startsWith("event.")).length, 10);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("context is empty for a project with no memory files", () => {
  const { root, workspace, settings } = fixture();
  try {
    assert.equal(buildMemoryContext(settings, workspace), "");
    const memoryDir = getMemoryDir(settings, workspace);
    fs.mkdirSync(memoryDir, { recursive: true });
    assert.equal(buildMemoryContext(settings, workspace), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ============================================================================
// Concept hygiene and memory_alias
// ============================================================================

test("concept hygiene blocks hash/number/date concepts and warns on sentence-like concepts", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, ".concepts.json"),
      `${JSON.stringify(
        {
          version: 1,
          concepts: ["identity-addressed-record"],
          aliases: {},
        },
        null,
        2,
      )}\n`,
    );

    const normalized = normalizeMemoryConcepts(memoryDir, [
      "deadbeefcafef00d", // hex hash 7-40 chars
      "42", // pure number
      "3.14", // pure number
      "2024-01-01", // YYYY-MM-DD date
      "20240101", // YYYYMMDD date
      "release-2025-03-01", // contains a date
      "123456789", // 9+ digit number must warn as number, not date
      "this is a very long concept sentence", // 7 words -> warn but register
      "identity-addressed-record", // valid existing concept
    ]);

    assert.deepEqual(normalized.concepts, ["identity-addressed-record", "this-is-a-very-long-concept-sentence"]);
    assert.equal(normalized.audit.warnings.length, 8);
    assert.match(normalized.audit.warnings[0], /looks like a hash/);
    assert.match(normalized.audit.warnings[1], /looks like a number/);
    assert.match(normalized.audit.warnings[2], /looks like a number/);
    assert.match(normalized.audit.warnings[3], /looks like a date/);
    assert.match(normalized.audit.warnings[4], /looks like a date/);
    assert.match(normalized.audit.warnings[5], /looks like a date/);
    assert.match(normalized.audit.warnings[6], /looks like a number/);
    assert.match(normalized.audit.warnings[7], /looks like a sentence/);

    const dictionary = getConceptDictionary(memoryDir);
    assert.deepEqual(dictionary.concepts, ["identity-addressed-record", "this-is-a-very-long-concept-sentence"]);
    assert.equal(dictionary.concepts.includes("deadbeefcafef00d"), false);
    assert.equal(dictionary.concepts.includes("42"), false);
    assert.equal(dictionary.concepts.includes("2024-01-01"), false);
    assert.equal(dictionary.concepts.includes("20240101"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_alias adds, converts, and rejects aliases", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, ".concepts.json"),
      `${JSON.stringify(
        {
          version: 1,
          concepts: ["identity-addressed-record", "metadata-cash", "metadata-cache"],
          aliases: { "short-hand": "metadata-cache" },
        },
        null,
        2,
      )}\n`,
    );

    // create new alias
    const created = addConceptAlias(memoryDir, "id based record", "identity-addressed-record");
    assert.equal(created.ok, true);
    assert.equal(created.alias, "id-based-record");
    assert.equal(created.canonical, "identity-addressed-record");
    assert.equal(created.converted, false);
    assert.equal(normalizeConceptSearchQuery(memoryDir, "id based record"), "identity-addressed-record");

    // standalone concept -> alias conversion
    const converted = addConceptAlias(memoryDir, "metadata-cash", "metadata-cache");
    assert.equal(converted.ok, true);
    assert.equal(converted.converted, true);
    const dictionary = getConceptDictionary(memoryDir);
    assert.equal(dictionary.concepts.includes("metadata-cash"), false);
    assert.equal(dictionary.aliases["metadata-cash"], "metadata-cache");
    assert.equal(normalizeConceptSearchQuery(memoryDir, "metadata cash"), "metadata-cache");

    // canonical must exist in the dictionary
    const missing = addConceptAlias(memoryDir, "whatever", "does-not-exist");
    assert.equal(missing.ok, false);
    assert.match(missing.error, /canonical concept not found/);

    // conflict: alias is the canonical of another alias in use
    const conflict = addConceptAlias(memoryDir, "metadata-cache", "identity-addressed-record");
    assert.equal(conflict.ok, false);
    assert.match(conflict.error, /canonical of another alias/);

    // tool wiring round-trip
    const { pi, tools } = fakePi();
    registerMemoryAlias(pi, settings);
    const signal = new AbortController().signal;
    const toolResult = await tools
      .get("memory_alias")
      .execute("alias-1", { alias: "id-records", canonical: "identity-addressed-record" }, signal, () => {}, {
        cwd: workspace,
      });
    assert.equal(toolResult.details.ok, true);
    assert.match(toolResult.content[0].text, /Concept alias added: id-records -> identity-addressed-record/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ============================================================================
// Sensitive detection and flag recomputation
// ============================================================================

test("sensitive detection requires credential-shaped token mentions", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    const signal = new AbortController().signal;

    const harmless = await tools.get("memory_write").execute(
      "write-harmless",
      {
        path: "events/token-cost.md",
        kind: "event",
        description: "Token cost review",
        summary: "LLM token usage summary",
        claims: ["Bare token mentions should not be treated as sensitive"],
      },
      signal,
      () => {},
      { cwd: workspace },
    );
    assert.equal(harmless.details.frontmatter.sensitive, undefined);

    const credential = await tools.get("memory_write").execute(
      "write-credential",
      {
        path: "events/api-token.md",
        kind: "event",
        description: "API token rotation",
        summary: "Access token replaced after rotation",
        claims: ["Tokens should be rotated periodically"],
      },
      signal,
      () => {},
      { cwd: workspace },
    );
    assert.equal(credential.details.frontmatter.sensitive, true);
    assert.match(credential.content[0].text, /Sensitive-looking content was marked sensitive/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_write sensitive flag follows caller and recomputes from new content", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    const signal = new AbortController().signal;
    const write = (relPath, params) =>
      tools
        .get("memory_write")
        .execute("write", { path: relPath, kind: "state", ...params }, signal, () => {}, { cwd: workspace });

    // branch 1: explicit sensitive: true wins over harmless content
    const explicit = await write("state/flag.md", {
      description: "Flagged",
      summary: "Explicitly sensitive",
      sensitive: true,
      claims: ["Caller controls the flag"],
    });
    assert.equal(explicit.details.frontmatter.sensitive, true);

    // branch 2: explicit sensitive: false clears a previously sensitive record
    const cleared = await write("state/flag.md", {
      description: "Unflagged",
      summary: "No longer sensitive",
      sensitive: false,
      claims: ["Caller clears the flag"],
    });
    assert.equal(cleared.details.frontmatter.sensitive, undefined);

    // branch 3: no explicit flag + harmless new content recomputes instead of inheriting the old flag
    await write("state/flag.md", {
      description: "Sensitive secret path",
      summary: "Contains api_token details",
      claims: ["Stored as sensitive"],
    });
    const recomputed = await write("state/flag.md", {
      description: "Public note",
      summary: "Plain metadata",
      claims: ["No longer sensitive-looking"],
    });
    assert.equal(recomputed.details.frontmatter.sensitive, undefined);
    assert.doesNotMatch(recomputed.content[0].text, /marked sensitive/);

    // and stays sensitive when the new content still looks sensitive
    const kept = await write("state/flag.md", {
      description: "Still secret",
      summary: "Password rotation completed",
      claims: ["Stays sensitive"],
    });
    assert.equal(kept.details.frontmatter.sensitive, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_search finds records stored under a concept later converted to an alias", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, ".concepts.json"),
      `${JSON.stringify(
        {
          version: 1,
          concepts: ["metadata-cache", "metadata-cash"],
          aliases: {},
        },
        null,
        2,
      )}\n`,
    );

    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    registerMemorySearch(pi, settings);
    registerMemoryAlias(pi, settings);
    const signal = new AbortController().signal;

    // record written while "metadata-cash" was still a standalone concept
    await tools.get("memory_write").execute(
      "write-1",
      {
        path: "events/pre-alias.md",
        kind: "event",
        description: "Pre alias record",
        summary: "Stored under metadata-cash before conversion",
        concepts: ["metadata-cash"],
        claims: ["Concept later converted to an alias"],
      },
      signal,
      () => {},
      { cwd: workspace },
    );
    // record written under the canonical
    await tools.get("memory_write").execute(
      "write-2",
      {
        path: "events/post-alias.md",
        kind: "event",
        description: "Canonical record",
        summary: "Stored under metadata-cache",
        concepts: ["metadata-cache"],
        claims: ["Canonical concept"],
      },
      signal,
      () => {},
      { cwd: workspace },
    );

    // convert the standalone concept into an alias
    const alias = await tools
      .get("memory_alias")
      .execute("alias-1", { alias: "metadata-cash", canonical: "metadata-cache" }, signal, () => {}, {
        cwd: workspace,
      });
    assert.equal(alias.details.ok, true);

    // query by the alias name
    const byAlias = await tools
      .get("memory_search")
      .execute("search-1", { query: "metadata cash", searchIn: "concepts" }, signal, () => {}, { cwd: workspace });
    assert.equal(byAlias.details.query, "metadata-cache");
    assert.equal(byAlias.details.count, 2);
    assert.deepEqual(
      byAlias.details.results.map((r) => r.path),
      [path.join("records", "event.post-alias.md"), path.join("records", "event.pre-alias.md")],
    );

    // query by the canonical name
    const byCanonical = await tools
      .get("memory_search")
      .execute("search-2", { query: "metadata-cache", searchIn: "concepts" }, signal, () => {}, { cwd: workspace });
    assert.equal(byCanonical.details.query, "metadata-cache");
    assert.equal(byCanonical.details.count, 2);
    assert.deepEqual(
      byCanonical.details.results.map((r) => r.path),
      [path.join("records", "event.post-alias.md"), path.join("records", "event.pre-alias.md")],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("memory_write surfaces hygiene warnings for blocked concepts in response text", async () => {
  const { root, workspace, settings } = fixture();
  try {
    const { pi, tools } = fakePi();
    registerMemoryWrite(pi, settings);
    const result = await tools.get("memory_write").execute(
      "write-hygiene",
      {
        path: "events/hygiene.md",
        kind: "event",
        description: "Hygiene warning test",
        summary: "Blocked concepts must be visible in the response",
        concepts: ["deadbeefcafef00d", "20260101", "ok-concept"],
        claims: ["Blocked concepts are dropped with a visible warning"],
      },
      new AbortController().signal,
      () => {},
      { cwd: workspace },
    );
    assert.match(result.content[0].text, /Memory file written/);
    assert.match(result.content[0].text, /looks like a hash/);
    assert.match(result.content[0].text, /looks like a date/);
    assert.deepEqual(result.details.frontmatter.concepts, ["ok-concept"]);
    assert.ok(result.details.warnings.some((warning) => /looks like a hash/.test(warning)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
