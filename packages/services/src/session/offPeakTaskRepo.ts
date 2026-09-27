import {
  isTasksStorageMigrated,
  isTasksStoragePrepared,
} from "#src/session/tasksDatabase/prepared.js";
/* eslint-disable max-lines -- 与 automationRepo 同理：off-peak 仓库集中维护 off_peak_tasks 的
   sqlite schema、状态机守卫写入与调度认领，稳定后再按读写职责拆分。 */
/* off-peak 任务仓库：off_peak_tasks 的 sqlite schema、状态机守卫写入与调度认领。
   与 automation 共用 tasks-index.sqlite 与 Repo 模式，但表/状态机/常量全部独立，
   禁止往 automations 表或 ZCodeAutomation 类型上加字段。 */
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OFF_PEAK_TERMINAL_STATUSES,
  modelSelectionSchema,
  resolveWorkspaceKey,
  type ZCodeOffPeakTask,
  type ZCodeOffPeakTaskCreateParams,
  type ZCodeOffPeakTaskStatus,
  type ZCodeTaskMode,
} from "@zcode/shared";
import { getTasksIndexDatabasePath } from "#src/paths.js";
import { runTasksDatabaseMigrations } from "#src/session/tasksDatabase/migrations.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

/** 认领超时回收：claim_running=1 超过该时长仍未结算，视为持有者已崩溃，允许重新认领。
    独立于 automation 的 CLAIM_STALE_MS（语义相同、常量独立一份，勿互相引用）。 */
export const OFF_PEAK_CLAIM_STALE_MS = 10 * 60_000;

/** 终态 SQL IN 片段；OFF_PEAK_TERMINAL_STATUSES 的单一来源投影。 */
const TERMINAL_SQL_LIST = OFF_PEAK_TERMINAL_STATUSES.map((s) => `'${s}'`).join(", ");

interface OffPeakTaskRow {
  off_peak_task_id: string;
  title: string;
  conversation_id: string | null;
  session_id: string | null;
  /** list() 联查 tasks-index 得到的绑定会话标题；单行读取不带该列。 */
  session_title?: string | null;
  prompt: string;
  permission_mode: string;
  model: string | null;
  thought_level: string | null;
  model_selection: string | null;
  workspace_key: string;
  workspace_path: string;
  workspace_identity: string | null;
  status: string;
  queued_at: number;
  started_at: number | null;
  ended_at: number | null;
  failure_reason: string | null;
  files_changed: number | null;
  history_deleted_at: number | null;
  claim_running: number;
  claimed_at: number | null;
  attempt_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTask(row: OffPeakTaskRow): ZCodeOffPeakTask {
  const modelSelection = readOffPeakModelSelection(row);
  return {
    offPeakTaskId: row.off_peak_task_id,
    title: row.title,
    conversationId: row.conversation_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    ...(row.session_title ? { sessionTitle: row.session_title } : {}),
    prompt: row.prompt,
    permissionMode: row.permission_mode as ZCodeTaskMode,
    ...(modelSelection ? { modelSelection } : {}),
    ...(!modelSelection
      ? {
          modelSelectionIssue: {
            code: "repair-required" as const,
          },
        }
      : {}),
    workspaceKey: row.workspace_key,
    workspacePath: row.workspace_path,
    workspaceIdentity: row.workspace_identity ?? undefined,
    status: row.status as ZCodeOffPeakTaskStatus,
    queuedAt: row.queued_at,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    filesChanged: row.files_changed ?? undefined,
    historyDeletedAt: row.history_deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readOffPeakModelSelection(row: OffPeakTaskRow): ZCodeOffPeakTask["modelSelection"] | null {
  if (row.model_selection) {
    try {
      const parsed = modelSelectionSchema.safeParse(JSON.parse(row.model_selection));
      if (parsed.success) return parsed.data;
    } catch {
      // 继续尝试已发布旧列的单向导入。
    }
  }
  // 旧单列没有 Provider Family，不能安全迁移到任一新 Off-Peak Provider。
  return null;
}

function serializeOffPeakModelSelection(
  selection: NonNullable<ZCodeOffPeakTask["modelSelection"]>,
): string {
  const options = selection.options;
  return JSON.stringify(
    modelSelectionSchema.parse({
      providerId: selection.providerId,
      modelId: selection.modelId,
      ...(options && Object.keys(options).length > 0 ? { options } : {}),
    }),
  );
}

/**
 * 闲时任务存储仓库（tasks-index.sqlite，WAL、多进程安全）。
 *
 * 仓库只做存储与原子状态迁移，守卫两条不变量：
 * 终态不可逆出；单任务认领 single-flight（任务间并发不设本地上限）。
 * 排队语义在本地：仓库不感知时间窗——认领前准入由 scheduler 向 main 求值（P3）。
 */
/** INSERT 撞上 idx_off_peak_bound_active（并发双创建的失败方）。 */
export function isOffPeakBoundSessionConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: off_peak_tasks\.workspace_key, off_peak_tasks\.session_id/.test(
      error.message,
    )
  );
}

export class OffPeakTaskRepo {
  private db: DatabaseSyncInstance | null = null;
  private dbPath: string | null = null;
  private initializePromise: Promise<void> | null = null;
  // 同 AutomationRepo，db 路径不能依赖进程级全局 _dataBaseDir：
  // vitest threads 并发跑测试文件时全局值被互相覆盖，存在写进真实库的窗口。
  // 改为构造期固定 dbPath，测试通过依赖注入传入临时库路径，生产路径不传则回退默认。
  private readonly resolvedDbPath: string | null;

  constructor(
    dbPath?: string,
    private readonly startupBusyTimeoutMs = 5000,
  ) {
    this.resolvedDbPath = dbPath?.trim() || null;
  }

  private resolveDbPath(): string {
    return this.resolvedDbPath ?? getTasksIndexDatabasePath();
  }

  async ensureReady(): Promise<void> {
    const path = this.resolveDbPath();
    if (this.dbPath && this.dbPath !== path) {
      this.close();
    }
    if (!this.initializePromise) {
      this.initializePromise = this.initialize(path).catch((error) => {
        this.close();
        throw error;
      });
    }
    await this.initializePromise;
  }

  close(options?: { throwOnError?: boolean }): void {
    let closeError: unknown;
    try {
      this.db?.close();
    } catch (error) {
      closeError = error;
      // ignore
    }
    this.db = null;
    this.dbPath = null;
    this.initializePromise = null;
    if (options?.throwOnError && closeError) throw closeError;
  }

  private async initialize(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    if (!this.db) {
      this.db = new DatabaseSync(path);
      this.dbPath = path;
      this.db.exec(`PRAGMA busy_timeout = ${this.startupBusyTimeoutMs}`);
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
    }
    // Worker 已完成该路径的原始准备，业务连接不再重复全表修复。
    if (isTasksStoragePrepared(path, this.db)) return;
    if (!isTasksStorageMigrated(path, this.db)) runTasksDatabaseMigrations(this.db);
    // 早期预留了 awaiting_approval，但生产链路从未写入，UI 却把它包装成可用能力。
    // 当前确认只走普通 session；迁移遗留行回 running，随后由启动回收按真实进程状态处理。
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = 'running', updated_at = @now
        WHERE status = 'awaiting_approval'`,
      )
      .run({ now: Date.now() });
  }

  private getDatabase(): DatabaseSyncInstance {
    if (!this.db) {
      throw new Error("OffPeakTaskRepo 未初始化：请先 await ensureReady()");
    }
    return this.db;
  }

  private hasTasksIndexTable(): boolean {
    return Boolean(
      this.getDatabase()
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`)
        .get(),
    );
  }

  private getRow(offPeakTaskId: string): OffPeakTaskRow | null {
    const row = this.getDatabase()
      .prepare(`SELECT * FROM off_peak_tasks WHERE off_peak_task_id = ?`)
      .get(offPeakTaskId) as OffPeakTaskRow | undefined;
    return row ?? null;
  }

  // ---- 管理 CRUD ----

  /**
   * 创建即入队（status=queued）。P3 起准入完全本地化：无取号、无服务端字段，
   * 是否可派发由 claim 时的时间窗求值决定（scheduler→main correlated 询问）。
   */
  async create(
    params: ZCodeOffPeakTaskCreateParams,
    options?: {
      /** 测试注入用；缺省 Date.now()。 */
      now?: number;
      /** 外部指定主键（测试/协议投影）；缺省内部生成。 */
      offPeakTaskId?: string;
    },
  ): Promise<ZCodeOffPeakTask> {
    await this.ensureReady();
    const now = options?.now ?? Date.now();
    const offPeakTaskId = options?.offPeakTaskId ?? `offpeak-${randomUUID()}`;
    const workspaceKey = resolveWorkspaceKey({
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
    });
    this.getDatabase()
      .prepare(
        `INSERT INTO off_peak_tasks (
          off_peak_task_id, title, conversation_id, session_id,
          prompt, permission_mode, model, thought_level, model_selection,
          workspace_key, workspace_path, workspace_identity,
          status, queued_at,
          claim_running, attempt_count, created_at, updated_at
        ) VALUES (
          @off_peak_task_id, @title, NULL, @session_id,
          @prompt, @permission_mode, @model, @thought_level, @model_selection,
          @workspace_key, @workspace_path, @workspace_identity,
          'queued', @queued_at,
          0, 0, @now, @now
        )`,
      )
      .run({
        off_peak_task_id: offPeakTaskId,
        title: params.title,
        // 会话内创建绑定当前会话；conversation_id 仍等首跑回填（非空 = 已跑过）。
        session_id: params.boundSessionId ?? null,
        prompt: params.prompt,
        permission_mode: params.permissionMode,
        model: null,
        thought_level: null,
        model_selection: serializeOffPeakModelSelection(params.modelSelection),
        workspace_key: workspaceKey,
        workspace_path: params.workspacePath,
        workspace_identity: params.workspaceIdentity ?? null,
        queued_at: now,
        now,
      });
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  async list(scope?: {
    workspacePath?: string;
    workspaceIdentity?: string;
  }): Promise<ZCodeOffPeakTask[]> {
    await this.ensureReady();
    const workspaceKey = scope?.workspacePath
      ? resolveWorkspaceKey({
          workspacePath: scope.workspacePath,
          workspaceIdentity: scope.workspaceIdentity,
        })
      : null;
    // 绑定会话标题联查 tasks-index 同库 tasks 表（卡片展示）；独立库（测试/迁移前）无该表则不联。
    const withSessionTitle = this.hasTasksIndexTable();
    const rows = this.getDatabase()
      .prepare(
        withSessionTitle
          ? `SELECT t.*, s.title AS session_title FROM off_peak_tasks t
            LEFT JOIN tasks s ON s.workspace_key = t.workspace_key AND s.task_id = t.session_id
            WHERE (@workspace_key IS NULL OR t.workspace_key = @workspace_key)
            ORDER BY t.created_at DESC`
          : `SELECT * FROM off_peak_tasks
            WHERE (@workspace_key IS NULL OR workspace_key = @workspace_key)
            ORDER BY created_at DESC`,
      )
      .all({ workspace_key: workspaceKey }) as unknown as OffPeakTaskRow[];
    return rows.map(rowToTask);
  }

  async get(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    await this.ensureReady();
    const row = this.getRow(offPeakTaskId);
    return row ? rowToTask(row) : null;
  }

  /**
   * Registry 变化使已保存 Selection 失效时，保留原模型与档位供用户修复或后续可靠恢复，
   * 同时清空正式 Selection 并撤销可调度状态，避免旧配置继续被 scheduler 认领。
   */
  async invalidateModelSelection(
    offPeakTaskId: string,
    modelSelection: NonNullable<ZCodeOffPeakTask["modelSelection"]>,
    options?: { now?: number },
  ): Promise<ZCodeOffPeakTask | null> {
    await this.ensureReady();
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getRow(offPeakTaskId);
      if (!current) {
        db.exec("COMMIT");
        return null;
      }
      const currentSelection = readOffPeakModelSelection(current);
      if (
        currentSelection &&
        (currentSelection.providerId !== modelSelection.providerId ||
          currentSelection.modelId !== modelSelection.modelId ||
          currentSelection.options?.reasoningLevel !== modelSelection.options?.reasoningLevel)
      ) {
        // 另一进程已完成用户修复，以更新后的值为准，不能用旧 Registry 观察覆盖它。
        db.exec("COMMIT");
        return rowToTask(current);
      }
      db.prepare(
        `UPDATE off_peak_tasks
         SET model = @model, thought_level = @thought_level,
             model_selection = NULL, updated_at = @now
         WHERE off_peak_task_id = @id`,
      ).run({
        id: offPeakTaskId,
        model: modelSelection.modelId,
        thought_level: modelSelection.options?.reasoningLevel ?? null,
        now: options?.now ?? Date.now(),
      });
      const invalidated = this.getRow(offPeakTaskId);
      db.exec("COMMIT");
      return invalidated ? rowToTask(invalidated) : null;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** 卡片 Delete：任何状态均可删（非终态删除的服务端核销由 service 层先行取消处理）。 */
  async delete(offPeakTaskId: string): Promise<void> {
    await this.ensureReady();
    this.getDatabase()
      .prepare(`DELETE FROM off_peak_tasks WHERE off_peak_task_id = ?`)
      .run(offPeakTaskId);
  }

  /**
   * 仅隐藏 History 行：任务必须已经实际启动；重复调用幂等。
   * 不修改状态、session、started/ended/filesChanged 或服务端核销字段。
   */
  async markHistoryDeleted(
    offPeakTaskId: string,
    options?: { now?: number },
  ): Promise<ZCodeOffPeakTask | null> {
    await this.ensureReady();
    const row = this.getRow(offPeakTaskId);
    if (!row || row.started_at === null) return row ? rowToTask(row) : null;
    if (row.history_deleted_at !== null) return rowToTask(row);
    const now = options?.now ?? Date.now();
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET history_deleted_at = @now, updated_at = @now
        WHERE off_peak_task_id = @id AND started_at IS NOT NULL`,
      )
      .run({ id: offPeakTaskId, now });
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  /** 创建上限的本地预判用（权威是服务端取号 429/3103）。 */
  async countNonTerminal(): Promise<number> {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare(
        `SELECT COUNT(*) AS n FROM off_peak_tasks WHERE status NOT IN (${TERMINAL_SQL_LIST})`,
      )
      .get() as { n: number };
    return row.n;
  }

  /** 本会话是否已有未终态绑定任务（创建前预检；索引 idx_off_peak_bound_active 同条件）。 */
  async hasActiveBoundTask(workspaceKey: string, sessionId: string): Promise<boolean> {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare(
        `SELECT 1 AS hit FROM off_peak_tasks
         WHERE workspace_key = @workspace_key AND session_id = @session_id
           AND status NOT IN (${TERMINAL_SQL_LIST})
         LIMIT 1`,
      )
      .get({ workspace_key: workspaceKey, session_id: sessionId }) as { hit: number } | undefined;
    return row !== undefined;
  }

  /** 执行中计数：keep-awake powerSaveBlocker 判据。 */
  async countActive(): Promise<number> {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM off_peak_tasks WHERE status = 'running'`)
      .get() as { n: number };
    return row.n;
  }

  /**
   * 编辑窗口期字段：仅 queued/paused 可编辑；票只锁队列身份，prompt 派发时才读。
   * modelSelection 只能替换为另一份明确 Selection；undefined = 不改。
   */
  async updateEditableFields(
    offPeakTaskId: string,
    params: {
      title?: string;
      prompt?: string;
      permissionMode?: string;
      modelSelection?: ZCodeOffPeakTask["modelSelection"] | null;
    },
    options?: { now?: number },
  ): Promise<ZCodeOffPeakTask | null> {
    await this.ensureReady();
    const row = this.getRow(offPeakTaskId);
    if (!row) return null;
    if (row.status !== "queued" && row.status !== "paused") return null;
    if (params.modelSelection === null) return null;
    const nextModelSelection = params.modelSelection ?? readOffPeakModelSelection(row);
    if (!nextModelSelection) {
      throw new Error(`Off-Peak task 缺少有效 ModelSelection: ${offPeakTaskId}`);
    }
    // 旧列是已发布版本的回滚快照，不能因普通编辑被清空；本更新只改 model_selection，
    // 不反向改写旧身份/档位，也不为新记录伪造旧值。
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks SET
          title = @title, prompt = @prompt, permission_mode = @permission_mode,
          model_selection = @model_selection, updated_at = @now
        WHERE off_peak_task_id = @id`,
      )
      .run({
        id: offPeakTaskId,
        title: params.title ?? row.title,
        prompt: params.prompt ?? row.prompt,
        permission_mode: params.permissionMode ?? row.permission_mode,
        model_selection: serializeOffPeakModelSelection(nextModelSelection),
        now: options?.now ?? Date.now(),
      });
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  // ---- 调度状态机 ----

  /**
   * single-flight 认领到期任务：status='queued' 且无在途认领，原子 claim_running 0→1。
   * FIFO 序按 queued_at（本地入队序）。P3 起可调度性不再落库——时间窗准入由 scheduler
   * 在调用本方法之前向 main 询问（withinWindow），Run-now 路径绕过窗口走 claimOneForRunNow。
   * 同时回收认领超时（claimed_at 过期）的僵尸认领。
   */
  async claimDue(now: number): Promise<ZCodeOffPeakTask[]> {
    await this.ensureReady();
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `UPDATE off_peak_tasks
        SET claim_running = 0, claimed_at = NULL
        WHERE claim_running = 1 AND claimed_at IS NOT NULL AND claimed_at <= @stale`,
      ).run({ stale: now - OFF_PEAK_CLAIM_STALE_MS });
      const dueRows = db
        .prepare(
          `SELECT * FROM off_peak_tasks
          WHERE status = 'queued' AND claim_running = 0
          ORDER BY queued_at ASC, created_at ASC`,
        )
        .all() as unknown as OffPeakTaskRow[];
      const claimed: ZCodeOffPeakTask[] = [];
      const claim = db.prepare(
        `UPDATE off_peak_tasks
        SET claim_running = 1, claimed_at = @now, updated_at = @now
        WHERE off_peak_task_id = @id AND claim_running = 0`,
      );
      for (const row of dueRows) {
        // 历史行可能没有 Provider 身份；它们必须留在列表等待修复，但不能被
        // scheduler 认领。逐行跳过还能保证一条旧记录不阻塞后续健康任务。
        if (!readOffPeakModelSelection(row)) continue;
        const res = claim.run({ id: row.off_peak_task_id, now });
        if (res.changes === 1) {
          claimed.push(rowToTask({ ...row, claim_running: 1, claimed_at: now }));
        }
      }
      db.exec("COMMIT");
      return claimed;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Run-now 强制认领（P3 本地准入）：只对 status='queued' 且 claim_running=0 的单任务
   * 原子置 claim_running=1 并返回；其余情况（不存在/paused/running/已在派发在途/终态）返回 null。
   * 与 claimDue 不同：不做批量、不检查可调度快照——绕过窗口是 Run-now 的产品语义。
   */
  async claimOneForRunNow(offPeakTaskId: string, now: number): Promise<ZCodeOffPeakTask | null> {
    await this.ensureReady();
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare(
          `SELECT * FROM off_peak_tasks
           WHERE off_peak_task_id = @id AND status = 'queued' AND claim_running = 0`,
        )
        .get({ id: offPeakTaskId }) as OffPeakTaskRow | undefined;
      if (!row) {
        db.exec("COMMIT");
        return null;
      }
      const res = db
        .prepare(
          `UPDATE off_peak_tasks
           SET claim_running = 1, claimed_at = @now, updated_at = @now
           WHERE off_peak_task_id = @id AND claim_running = 0`,
        )
        .run({ id: offPeakTaskId, now });
      if (res.changes !== 1) {
        db.exec("COMMIT");
        return null;
      }
      db.exec("COMMIT");
      return rowToTask({ ...row, claim_running: 1, claimed_at: now });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * 派发成功（session 已接受 prompt）：queued→running，回填首跑产生的 conversation/session，
   * 释放认领。守卫：仅 queued 可入 running（终态不可逆出；paused 竞态下
   * 派发结果作废，返回 null 由调用方处理）。续跑段保留首段 started_at（用户视角单任务）。
   */
  async markRunning(
    offPeakTaskId: string,
    options: {
      startedAt: number;
      conversationId?: string;
      sessionId?: string;
    },
  ): Promise<ZCodeOffPeakTask | null> {
    await this.ensureReady();
    const res = this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = 'running',
            started_at = COALESCE(started_at, @started_at),
            conversation_id = COALESCE(@conversation_id, conversation_id),
            session_id = COALESCE(@session_id, session_id),
            claim_running = 0, claimed_at = NULL,
            last_error = NULL,
            updated_at = @started_at
        WHERE off_peak_task_id = @id AND status = 'queued'`,
      )
      .run({
        id: offPeakTaskId,
        started_at: options.startedAt,
        conversation_id: options.conversationId ?? null,
        session_id: options.sessionId ?? null,
      });
    if (res.changes !== 1) return null;
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  /**
   * 终态落库（completed/failed/cancelled）。守卫：终态不可逆出——已终态的行拒绝二次迁移，
   * 返回 null（OffPeakRunResult 迟到兜底时调用方据此丢弃）。
   */
  async markTerminal(
    offPeakTaskId: string,
    options: {
      status: "completed" | "failed" | "cancelled";
      endedAt: number;
      failureReason?: string;
      filesChanged?: number;
      /** scheduler 派发阶段的确定性错误；存在时原子累计一次派发尝试并留 last_error。 */
      dispatchError?: string;
    },
  ): Promise<ZCodeOffPeakTask | null> {
    await this.ensureReady();
    const res = this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = @status,
            ended_at = @ended_at,
            failure_reason = @failure_reason,
            files_changed = COALESCE(@files_changed, files_changed),
            attempt_count = attempt_count + @dispatch_attempt_inc,
            last_error = COALESCE(@dispatch_error, last_error),
            claim_running = 0, claimed_at = NULL,
            updated_at = @ended_at
        WHERE off_peak_task_id = @id AND status NOT IN (${TERMINAL_SQL_LIST})`,
      )
      .run({
        id: offPeakTaskId,
        status: options.status,
        ended_at: options.endedAt,
        failure_reason: options.failureReason ?? null,
        files_changed: options.filesChanged ?? null,
        dispatch_attempt_inc: options.dispatchError ? 1 : 0,
        dispatch_error: options.dispatchError ?? null,
      });
    if (res.changes !== 1) return null;
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  /**
   * 用户 Pause / Continue：queued ⇄ paused。
   * Pause 只停本地派发（时间窗开也不会被认领）；Continue 的资格处理在 service 层。
   * 已被认领派发在途（claim_running=1）的任务不可 Pause，返回 null。
   */
  async setPaused(
    offPeakTaskId: string,
    paused: boolean,
    options?: { now?: number },
  ): Promise<ZCodeOffPeakTask | null> {
    await this.ensureReady();
    const res = this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET status = @to, updated_at = @now
        WHERE off_peak_task_id = @id AND status = @from AND claim_running = 0`,
      )
      .run({
        id: offPeakTaskId,
        to: paused ? "paused" : "queued",
        from: paused ? "queued" : "paused",
        now: options?.now ?? Date.now(),
      });
    if (res.changes !== 1) return null;
    return rowToTask(this.getRow(offPeakTaskId)!);
  }

  /**
   * 释放认领（派发失败/关机退出）：复位 single-flight 锁；带 error 时累计 attempt_count
   * 并记 last_error（供派发退避与诊断）。不改 status——任务留在 queued 等下轮认领（无 skip）。
   */
  async releaseClaim(
    offPeakTaskId: string,
    options?: { error?: string; now?: number },
  ): Promise<void> {
    await this.ensureReady();
    this.getDatabase()
      .prepare(
        `UPDATE off_peak_tasks
        SET claim_running = 0, claimed_at = NULL,
            attempt_count = attempt_count + @attempt_inc,
            last_error = COALESCE(@error, last_error),
            updated_at = @now
        WHERE off_peak_task_id = @id AND claim_running = 1`,
      )
      .run({
        id: offPeakTaskId,
        attempt_inc: options?.error ? 1 : 0,
        error: options?.error ?? null,
        now: options?.now ?? Date.now(),
      });
  }

  /**
   * 启动回收（app 级启动时调用一次，先于任何派发）：进程死亡时残留的
   * running 置回 queued（保留 queued_at，天然仍在队首附近；保留 session_id 供 resume
   * 续跑），并清理超时认领。返回回收的任务数。
   * ⚠ 调用方必须保证调用时无在跑 off-peak loop（属主应为 app 单例进程，非每个 host）。
   */
  async recoverInterrupted(now: number): Promise<number> {
    await this.ensureReady();
    const db = this.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      const recovered = db
        .prepare(
          `UPDATE off_peak_tasks
          SET status = 'queued', claim_running = 0, claimed_at = NULL, updated_at = @now
          WHERE status = 'running'`,
        )
        .run({ now });
      db.prepare(
        `UPDATE off_peak_tasks
        SET claim_running = 0, claimed_at = NULL, updated_at = @now
        WHERE claim_running = 1 AND claimed_at IS NOT NULL AND claimed_at <= @stale`,
      ).run({ now, stale: now - OFF_PEAK_CLAIM_STALE_MS });
      db.exec("COMMIT");
      return Number(recovered.changes ?? 0);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** 全部非终态任务（运行中任务观测/测试用）。 */
  async listNonTerminal(): Promise<ZCodeOffPeakTask[]> {
    await this.ensureReady();
    const rows = this.getDatabase()
      .prepare(
        `SELECT * FROM off_peak_tasks
        WHERE status NOT IN (${TERMINAL_SQL_LIST})
        ORDER BY queued_at ASC`,
      )
      .all() as unknown as OffPeakTaskRow[];
    return rows.map(rowToTask);
  }
}
