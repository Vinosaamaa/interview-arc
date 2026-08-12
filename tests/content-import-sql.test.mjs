import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildTableRefreshSql } from "../scripts/content-import-sql.mjs";

function statements(sql) {
  return sql.split(/;\n?/).filter((statement) => statement.trim()).map((statement) => `${statement};`);
}

test("batches refresh rows by encoded SQL bytes with deterministic exact results", () => {
  const rows = [
    ["first", "a".repeat(90), 1],
    ["second", "b".repeat(90), 2],
    ["third", "c".repeat(90), 3],
  ];
  const options = { maxStatementBytes: 240, largeTextColumn: "payload", keyColumns: ["id"] };
  const sql = buildTableRefreshSql("records", ["id", "payload", "updated_at"], rows, options);

  assert.equal(sql, buildTableRefreshSql("records", ["id", "payload", "updated_at"], rows, options));
  assert.ok(statements(sql).every((statement) => Buffer.byteLength(statement, "utf8") <= 240));
  assert.equal(statements(sql).filter((statement) => statement.startsWith("INSERT")).length, 3);

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);");
  db.exec(sql);
  assert.deepEqual(db.prepare("SELECT id, payload, updated_at FROM records ORDER BY rowid").all().map((row) => ({ ...row })), [
    { id: "first", payload: "a".repeat(90), updated_at: 1 },
    { id: "second", payload: "b".repeat(90), updated_at: 2 },
    { id: "third", payload: "c".repeat(90), updated_at: 3 },
  ]);
  db.close();
});

test("reconstructs one large multibyte payload across D1-safe statements", () => {
  const payload = JSON.stringify({ quote: "it's exact", transcript: "界🙂'".repeat(220) });
  const sql = buildTableRefreshSql(
    "content_artifacts",
    ["path", "type", "date", "title", "payload", "updated_at"],
    [["practice/example.md", "leetcode", "2026-08-12", "Example", payload, 123]],
    {
      maxStatementBytes: 500,
      largeTextColumn: "payload",
      keyColumns: ["path"],
    },
  );

  const generated = statements(sql);
  assert.ok(generated.length > 3);
  assert.ok(generated.every((statement) => Buffer.byteLength(statement, "utf8") <= 500));

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE content_artifacts (
    path TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );`);
  db.exec(sql);
  const row = { ...db.prepare("SELECT path, payload FROM content_artifacts").get() };
  assert.deepEqual(row, { path: "practice/example.md", payload });
  assert.deepEqual(JSON.parse(row.payload), JSON.parse(payload));
  db.close();
});

test("retains owner/table key isolation while reconstructing multiple large rows", () => {
  const rows = [
    ["leetcode", "same-id", 0, "A'界".repeat(180), 1],
    ["behavioral", "same-id", 1, "B🙂".repeat(180), 1],
  ];
  const sql = buildTableRefreshSql(
    "content_bank",
    ["category", "id", "ord", "payload", "updated_at"],
    rows,
    { maxStatementBytes: 420, largeTextColumn: "payload", keyColumns: ["category", "id"] },
  );

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE content_bank (
    category TEXT NOT NULL,
    id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (category, id)
  );`);
  db.exec(sql);
  assert.deepEqual(
    db.prepare("SELECT category, id, ord, payload FROM content_bank ORDER BY ord").all().map((row) => ({ ...row })),
    [
    { category: "leetcode", id: "same-id", ord: 0, payload: rows[0][3] },
    { category: "behavioral", id: "same-id", ord: 1, payload: rows[1][3] },
    ],
  );
  db.close();
});

test("rejects a payload above the D1 row boundary with an exact identity", () => {
  assert.throws(
    () =>
      buildTableRefreshSql(
        "content_artifacts",
        ["path", "payload"],
        [["practice/oversized.md", "x".repeat(2_000_001)]],
        { largeTextColumn: "payload", keyColumns: ["path"] },
      ),
    /content_artifacts row path="practice\/oversized\.md" is approximately 2000022 bytes; D1 row ceiling is 2000000 bytes/,
  );
});
