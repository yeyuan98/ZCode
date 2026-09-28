import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { importLegacyAutomationSelections } from "../src/session/tasksDatabase/provider-selection-v2.js";

/**
 * A-P6（specs/agent-identity-and-tooling-purge.md 文末修订）：冻结 0002 的 decode
 * 仅保留 "zcode" 执行后端拼写；早期 "glm" 拼写按 alpha 硬切断裁决移除。本测试经
 * 真实 sqlite 路径钉死各形态的落库结果，含已记录的破坏面：hypothetical 的
 * provider=glm 裸模型行将持久化 dead providerId 而非 SQL NULL。
 */
function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE automations (
    automation_id TEXT PRIMARY KEY,
    model TEXT,
    provider TEXT,
    thought_level TEXT,
    model_selection TEXT
  )`);
  return db;
}

function insert(db: DatabaseSync, id: string, model: string | null, provider: string | null): void {
  db.prepare("INSERT INTO automations VALUES (?,?,?,NULL,NULL)").run(id, model, provider);
}

function selectionOf(db: DatabaseSync, id: string): string | null {
  const row = db
    .prepare("SELECT model_selection AS value FROM automations WHERE automation_id=?")
    .get(id) as { value: string | null };
  return row.value;
}

test("provider=zcode 执行后端：无法确定身份 → SQL NULL（不保留默认）", () => {
  const db = createDb();
  insert(db, "a1", "gpt-4o", "zcode");
  importLegacyAutomationSelections(db);
  assert.equal(selectionOf(db, "a1"), null);
});

test("A-P6 记录的破坏面：provider=glm 裸模型行持久化 dead providerId 而非 NULL", () => {
  const db = createDb();
  insert(db, "a2", "gpt-4o", "glm");
  importLegacyAutomationSelections(db);
  const decoded = JSON.parse(selectionOf(db, "a2") ?? "{}");
  assert.deepEqual(decoded, { providerId: "glm", modelId: "gpt-4o" });
});

test("custom:builtin 形态与斜杠形态仍按冻结映射解码", () => {
  const db = createDb();
  insert(db, "a3", "custom:builtin:bigmodel:glm-5.3", null);
  insert(db, "a4", "bigmodel-api/glm-5.3", null);
  importLegacyAutomationSelections(db);
  assert.deepEqual(JSON.parse(selectionOf(db, "a3") ?? "{}"), {
    providerId: "bigmodel-api",
    modelId: "glm-5.3",
  });
  assert.deepEqual(JSON.parse(selectionOf(db, "a4") ?? "{}"), {
    providerId: "bigmodel-api",
    modelId: "glm-5.3",
  });
});

test("空模型行走 'null' 默认语义", () => {
  const db = createDb();
  insert(db, "a5", "   ", "bigmodel-api");
  importLegacyAutomationSelections(db);
  assert.equal(selectionOf(db, "a5"), "null");
});
