/* Host 派发闲时任务的确定性错误分类（P3 本地化后仅保留本文件，票据/凭证类错误已删除）。
 * host 据类型输出 permanent/transient；禁止依赖错误文本分流。 */
export class OffPeakPermanentDispatchError extends Error {
  readonly failureKind = "permanent" as const;

  constructor(message: string) {
    super(message);
    this.name = "OffPeakPermanentDispatchError";
  }
}

/** 任务保存的模型当前不可解析时停止空耗重试的类型化错误（确定性配置错误）。 */
export class OffPeakModelUnavailableError extends OffPeakPermanentDispatchError {
  constructor(readonly scope: "idlePlan" | "workspaceUser") {
    super(
      scope === "idlePlan"
        ? "off-peak dispatch has no usable model (task selection unresolvable)"
        : "off-peak dispatch has no usable user workspace model",
    );
    this.name = "OffPeakModelUnavailableError";
  }
}
