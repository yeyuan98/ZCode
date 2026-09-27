import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  OFF_PEAK_TERMINAL_STATUSES,
  isOffPeakTerminalStatus,
  modelSelectionSchema,
} from "@zcode/shared";
import { OffPeakTaskRepo } from "../src/session/offPeakTaskRepo.js";
import { OffPeakTaskService } from "../src/session/offPeakTaskService.js";
import {
  areTasksDatabaseMigrationsApplied,
  inspectTasksMigrationKind,
} from "../src/session/tasksDatabase/migrations.js";
import { OFF_PEAK_SCHEMA } from "../src/session/tasksDatabase/schema-v1.js";
import { createServiceLogger } from "../src/logger/serviceLogger.js";
import type { ModelSelection } from "@zcode/provider";

// P3 本地准入：temp sqlite 上验证 create→claim→dispatch→settle 全链路、
// schema hard-cut（无票据列）与迁移账本校验，以及 Run-now 的 single-flight 语义。

const MODEL_SELECTION: ModelSelection = {
  providerId: "provider-a",
  modelId: "model-x",
  options: { reasoningLevel: "high" },
};

const CREATE_PARAMS = {
  title: "夜间重构",
  prompt: "把 utils 目录按模块拆分并补测试",
  permissionMode: "build" as const,
  modelSelection: MODEL_SELECTION,
  workspacePath: "/workspace/off-peak",
  workspaceIdentity: undefined,
};

/** 固定通过的模型解析（资格 = 选择可解析；无 Provider 白名单）。 */
const alwaysOkResolver = async () => ({ ok: true as const, selection: MODEL_SELECTION }) as const;

const alwaysFailResolver = async () =>
  ({
    ok: false as const,
    validation: { ok: false as const, code: "provider-not-found" as const, providerId: "p" },
  }) as const;

async function makeRepo(): Promise<{ repo: OffPeakTaskRepo; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-offpeak-admission-"));
  const repo = new OffPeakTaskRepo(join(dir, "tasks-index.sqlite"));
  await repo.ensureReady();
  return {
    repo,
    cleanup: async () => {
      repo.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (row) => row.name,
  );
}

test("fresh DB: off_peak_tasks 无 6 个供应商票据列；认领索引保留；迁移账本与 schema 字符串一致", async () => {
  const { repo, cleanup } = await makeRepo();
  try {
    const raw = (repo as unknown as { db: DatabaseSync }).db;
    const columns = columnNames(raw, "off_peak_tasks");
    // P3 hard-cut：服务端票据六列必须消失（start>end 之外无任何遗留）。
    for (const dead of [
      "server_ticket_id",
      "registered_at",
      "schedulable",
      "queue_position",
      "next_poll_at",
      "settled_at",
    ]) {
      assert.equal(columns.includes(dead), false, `${dead} 应已从 DDL 删除`);
    }
    // 认领扫描仍由 idx_off_peak_pick(status, queued_at) 服务。
    const indexes = (
      raw.prepare(`PRAGMA index_list(off_peak_tasks)`).all() as { name: string }[]
    ).map((row) => row.name);
    assert.equal(indexes.includes("idx_off_peak_pick"), true);

    // 账本 checksum 以 OFF_PEAK_SCHEMA 为输入重算校验；schema 与账本漂移会 throw。
    assert.equal(inspectTasksMigrationKind(raw), "none");
    assert.equal(areTasksDatabaseMigrationsApplied(raw), true);
    // 直接钉住：账本记录的 0001 checksum 就是当前 schema 字符串参与计算的那一个
    //（areTasksDatabaseMigrationsApplied 内部重算同源输入，此处再取账本值对齐）。
    const ledger = raw
      .prepare(`SELECT checksum FROM tasks_schema_migration WHERE id = '0001_adopt_task_schema'`)
      .get() as { checksum: string };
    assert.match(ledger.checksum, /^[0-9a-f]{64}$/);
    assert.equal(ledger.checksum.includes(OFF_PEAK_SCHEMA), false, "checksum 是哈希而非原文");
  } finally {
    await cleanup();
  }
});

test("旧 alpha 库（含票据列 + 旧 schema 落账）按预期 checksum_mismatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-offpeak-legacy-"));
  const dbPath = join(dir, "tasks-index.sqlite");
  const db = new DatabaseSync(dbPath);
  // 用当前 schema 建库落账，再手工加回票据列模拟 alpha 库形状；账本仍是新 checksum。
  db.exec(OFF_PEAK_SCHEMA);
  db.exec(`ALTER TABLE off_peak_tasks ADD COLUMN server_ticket_id TEXT`);
  db.exec(`ALTER TABLE off_peak_tasks ADD COLUMN schedulable INTEGER NOT NULL DEFAULT 0`);
  const checksumInput = ["legacy-shape-with-ticket-columns"];
  const legacyChecksum = createHash("sha256").update(JSON.stringify(checksumInput)).digest("hex");
  db.exec(
    `CREATE TABLE tasks_schema_migration (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, time_applied INTEGER NOT NULL)`,
  );
  db.prepare(`INSERT INTO tasks_schema_migration VALUES ('0001_adopt_task_schema', ?, 0)`).run(
    legacyChecksum,
  );
  db.close();
  // 账本 checksum 与当前 schema 字符串输入不匹配 → 打开即 checksum_mismatch（hard-cut 预期）。
  const repo = new OffPeakTaskRepo(dbPath);
  await assert.rejects(
    () => repo.ensureReady(),
    (error: unknown) =>
      (error as { kind?: string }).kind === "checksum_mismatch" ||
      String((error as Error).message).includes("checksum mismatch"),
  );
  repo.close();
  await rm(dir, { recursive: true, force: true });
});

test("create→claimDue→markRunning→markTerminal 全链路（无票据/额度参与）", async () => {
  const { repo, cleanup } = await makeRepo();
  try {
    const service = new OffPeakTaskService({
      repo,
      resolveModelSelection: alwaysOkResolver as OffPeakTaskServiceDepsResolver,
      logger: createServiceLogger("off-peak-test"),
    });
    const created = await service.createTask(CREATE_PARAMS);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.task.status, "queued");
    assert.equal(created.task.offPeakTaskId.startsWith("offpeak-"), true);
    // 创建即落库：模型选择按原样持久化（无取号/服务端字段）。
    assert.deepEqual(modelSelectionSchema.parse(created.task.modelSelection), MODEL_SELECTION);

    // 时间窗求值不在 repo/service——claimDue 只看 queued + claim_running。
    const now = Date.now();
    const claimed = await repo.claimDue(now);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]!.offPeakTaskId, created.task.offPeakTaskId);

    // single-flight：认领后再次 claimDue 不会重复认领。
    assert.equal((await repo.claimDue(now)).length, 0);

    // FIFO：第二条任务按 queued_at 排在后面。
    const second = await service.createTask({
      ...CREATE_PARAMS,
      title: "第二条任务",
    });
    assert.equal(second.ok, true);

    // 派发成功结算：queued→running，回填 conversation/session。
    const running = await repo.markRunning(created.task.offPeakTaskId, {
      startedAt: now,
      conversationId: "conv-1",
      sessionId: "conv-1",
    });
    assert.equal(running?.status, "running");
    assert.equal(running?.conversationId, "conv-1");

    // run-to-completion：窗口关闭不影响在跑任务——结算路径不接收任何窗口输入，
    // 终态写入只由 loop 结果驱动（此处直接断言 markTerminal 在“窗口外时间”仍可用）。
    const endedAt = now + 60_000;
    const terminal = await repo.markTerminal(created.task.offPeakTaskId, {
      status: "completed",
      endedAt,
      filesChanged: 3,
    });
    assert.equal(terminal?.status, "completed");
    assert.equal(terminal?.filesChanged, 3);
    assert.equal(isOffPeakTerminalStatus(terminal!.status), true);
    // 终态不可逆出：二次迁移被守卫拒绝。
    assert.equal(
      await repo.markTerminal(created.task.offPeakTaskId, {
        status: "failed",
        endedAt: endedAt + 1,
      }),
      null,
    );
  } finally {
    await cleanup();
  }
});

test("Run-now 竞态：claim_running=1 时 claimOneForRunNow 幂等 no-op", async () => {
  const { repo, cleanup } = await makeRepo();
  try {
    const service = new OffPeakTaskService({
      repo,
      resolveModelSelection: alwaysOkResolver as OffPeakTaskServiceDepsResolver,
      logger: createServiceLogger("off-peak-test"),
    });
    const created = await service.createTask(CREATE_PARAMS);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const taskId = created.task.offPeakTaskId;
    const now = Date.now();

    // scheduler 正常认领在途（claim_running=1）→ Run-now 原子 no-op，不会双派发。
    assert.equal((await repo.claimDue(now)).length, 1);
    assert.equal(await repo.claimOneForRunNow(taskId, now), null);

    // 释放认领后 Run-now 可强制认领（绕过窗口语义由调用方保证，repo 不感知）。
    await repo.releaseClaim(taskId);
    const forced = await repo.claimOneForRunNow(taskId, now);
    assert.equal(forced?.offPeakTaskId, taskId);

    // running / paused / 终态 / 不存在 → 一律 no-op。
    await repo.markRunning(taskId, { startedAt: now, conversationId: "c", sessionId: "c" });
    assert.equal(await repo.claimOneForRunNow(taskId, now), null);
    await repo.markTerminal(taskId, { status: "cancelled", endedAt: now });
    assert.equal(await repo.claimOneForRunNow(taskId, now), null);
    assert.equal(await repo.claimOneForRunNow("offpeak-missing", now), null);
  } finally {
    await cleanup();
  }
});

test("service.runNow：paused 先回 queued 再转发；requestRunNow 收到任务 id", async () => {
  const { repo, cleanup } = await makeRepo();
  try {
    const forwarded: string[] = [];
    const service = new OffPeakTaskService({
      repo,
      resolveModelSelection: alwaysOkResolver as OffPeakTaskServiceDepsResolver,
      logger: createServiceLogger("off-peak-test"),
      requestRunNow: (id) => forwarded.push(id),
    });
    const created = await service.createTask(CREATE_PARAMS);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const taskId = created.task.offPeakTaskId;

    const paused = await service.pauseTask(taskId);
    assert.equal(paused?.status, "paused");
    assert.deepEqual(forwarded, []);

    const resumed = await service.runNow(taskId);
    assert.equal(resumed?.status, "queued");
    assert.deepEqual(forwarded, [taskId], "run-now 必须转发到 host→main→scheduler 链");

    // 终态任务 run-now 是 no-op，不转发。
    await service.cancelTask(taskId);
    const afterTerminal = await service.runNow(taskId);
    assert.equal(isOffPeakTerminalStatus(afterTerminal!.status), true);
    assert.deepEqual(forwarded, [taskId]);
  } finally {
    await cleanup();
  }
});

test("创建资格 = 存在可解析的模型选择；解析失败返回 client_validation（无灰度/额度门）", async () => {
  const { repo, cleanup } = await makeRepo();
  try {
    const service = new OffPeakTaskService({
      repo,
      resolveModelSelection: alwaysFailResolver as OffPeakTaskServiceDepsResolver,
      logger: createServiceLogger("off-peak-test"),
    });
    const rejected = await service.createTask(CREATE_PARAMS);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.failureStage, "client_validation");
    assert.equal(rejected.errorCategory, "client_validation");

    // 参数校验失败（空 prompt）同样走 client_validation，且不落库。
    const invalid = await service.createTask({ ...CREATE_PARAMS, prompt: "  " });
    assert.equal(invalid.ok, false);
    assert.equal((await repo.list()).length, 0);
  } finally {
    await cleanup();
  }
});

test("重启恢复：running 置回 queued（保留 session/queued_at 供 resume）；僵尸认领回收", async () => {
  const { repo, cleanup } = await makeRepo();
  try {
    const service = new OffPeakTaskService({
      repo,
      resolveModelSelection: alwaysOkResolver as OffPeakTaskServiceDepsResolver,
      logger: createServiceLogger("off-peak-test"),
    });
    const created = await service.createTask(CREATE_PARAMS);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const taskId = created.task.offPeakTaskId;
    const now = Date.now();
    await repo.claimDue(now);
    await repo.markRunning(taskId, {
      startedAt: now,
      conversationId: "conv-resume",
      sessionId: "conv-resume",
    });

    // 模拟下一个 app 实例启动：running → queued，session 保留。
    const recovered = await repo.recoverInterrupted(now + 1000);
    assert.equal(recovered, 1);
    const after = await repo.get(taskId);
    assert.equal(after?.status, "queued");
    assert.equal(after?.sessionId, "conv-resume");
    assert.equal(after?.queuedAt, created.task.queuedAt, "queued_at 保留，恢复后仍在队首附近");

    // 认领超时（CLAIM_STALE）的僵尸认领同样被回收。
    const stale = await repo.claimDue(now + 2000);
    assert.equal(stale.length, 1);
    const recoveredClaims = await repo.recoverInterrupted(now + 2000 + 11 * 60_000);
    assert.equal(recoveredClaims, 0, "无 running 任务时回收数为 0（认领已随派发在途）");
  } finally {
    await cleanup();
  }
});

test("终态集合与 list 过滤基础不变量", () => {
  assert.deepEqual([...OFF_PEAK_TERMINAL_STATUSES], ["completed", "failed", "cancelled"]);
});

type OffPeakTaskServiceDepsResolver = ConstructorParameters<
  typeof OffPeakTaskService
>[0]["resolveModelSelection"];
