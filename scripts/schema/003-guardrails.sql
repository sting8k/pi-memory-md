-- Harness v0 schema - migration 003
-- First-class project/user guardrails.

CREATE TABLE guardrail (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    status      TEXT    NOT NULL DEFAULT 'active'
                       CHECK(status IN ('active','superseded')),
    guardrail   TEXT    NOT NULL UNIQUE,
    rationale   TEXT,
    source      TEXT,
    notes       TEXT
);

INSERT INTO schema_version (version) VALUES (3);
