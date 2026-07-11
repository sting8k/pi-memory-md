import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFrontmatter, stringifyFrontmatter } from "../.test-dist/frontmatter.js";
import {
  buildMemoryContext,
  buildStructuredMemoryContent,
  createMemoryId,
  findMemoryFileById,
  formatMemoryRead,
  getMemoryCatalog,
  getMemoryDir,
  MEMORY_FACTS_END,
  MEMORY_FACTS_START,
  memoryFileFromCatalogEntry,
  migrateMemoryProject,
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

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-v2-"));
  const workspace = path.join(root, "My Project");
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  const settings = { localPath: path.join(root, "memory") };
  return { root, workspace, settings };
}

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

test("structured memory records support compact semantic read and search", () => {
  const { root, workspace, settings } = fixture();
  try {
    const memoryDir = getMemoryDir(settings, workspace);
    const target = resolveMemoryWriteTarget(memoryDir, "events/structured-benchmark.md", "event");
    const content = buildStructuredMemoryContent({
      description: "Structured benchmark",
      summary: "V3 optimizes semantic memory reads with compact projections",
      concepts: ["identity-addressed records", "semantic projection"],
      claims: ["Structured records avoid loading prose when facts are enough"],
      facts: { "benchmark.v3.write_ms": 0.269, "benchmark.sizes": [50, 1000, 10000] },
      relations: { implementation: "@event.memory-v3" },
      notes: "Evidence prose stays optional and should not appear in knowledge view.",
    });

    assert.deepEqual(validateMemoryContent(content), { valid: true });
    writeMemoryFile(target.filePath, content, {
      description: "Structured benchmark",
      summary: "V3 optimizes semantic memory reads with compact projections",
      concepts: ["identity-addressed records", "semantic projection"],
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
    assert.deepEqual(catalogEntry.concepts, ["identity-addressed records", "semantic projection"]);
    assert.equal(catalogEntry.facts["benchmark.v3.write_ms"], 0.269);

    const knowledge = formatMemoryRead(memory, "knowledge");
    assert.match(knowledge, /## Facts/);
    assert.match(knowledge, /benchmark\.v3\.write_ms = 0\.269/);
    assert.doesNotMatch(knowledge, /Evidence prose/);

    const summary = formatMemoryRead(memory, "summary");
    assert.match(summary, /## Concepts/);
    assert.doesNotMatch(summary, /## Claims/);

    const hits = searchMemoryFiles({
      files: new Map([[catalogEntry.path, memoryFileFromCatalogEntry(memoryDir, catalogEntry)]]),
      query: "semantic projection",
      searchIn: "concepts",
    });
    assert.equal(hits[0].path, path.join("records", "event.structured-benchmark.md"));
    assert.deepEqual(hits[0].matchedIn, ["concepts"]);
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

    const context = buildMemoryContext(settings, workspace);
    assert.equal(context.split("\n").filter((line) => line.startsWith("- ")).length, 10);
    assert.match(context, /Memory 12/);
    assert.match(context, /Memory 3/);
    assert.doesNotMatch(context, /Memory 2(?:\D|$)/);
    assert.doesNotMatch(context, /Memory 1(?:\D|$)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
