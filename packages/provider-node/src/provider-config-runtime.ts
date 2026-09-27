import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";
import { NodeZCodeBuiltinProviderConfigSource } from "./zcode-builtin-provider-config-source.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

// P3 C5 供应商目录远端下载删除：zcode-builtin-download（client/configs →
// builtin_provider_config_json → CDN）、zcode-builtin-remote-synchronizer（TTL/租约
// 刷新控制文件）与 endpoint-scoped-zcode-builtin-source（按 Endpoint 隔离的 Active/LKG
// 缓存）已整体移除。Registry 只读打包/本地 zcode-builtin.json（Bundled Source of Truth），
// 离线可用；无远端刷新，也就没有刷新控制路径与周期检查任务。
export interface NodeProviderConfigRuntimeOptions {
  readonly zcodeBuiltinFilePath: string;
  readonly zcodeBuiltinActiveFilePath?: string;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    zcodeBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/** 组装一个 Node.js 进程内共享的 ZCode Built-in/Personal Config 运行边界。 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #zcodeBuiltinSource: NodeZCodeBuiltinProviderConfigSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  #startPromise: Promise<void> | null = null;
  #disposed = false;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#zcodeBuiltinSource = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: options.zcodeBuiltinFilePath,
      activeFilePath: options.zcodeBuiltinActiveFilePath,
      watch: options.watch,
    });
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#zcodeBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      zcodeBuiltinSource: this.#zcodeBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveZCodeBuiltinActiveFilePath(): Promise<string> {
    return Promise.resolve(this.#zcodeBuiltinSource.activeFilePath);
  }

  get personalRepository(): import("@zcode/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => undefined);
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  /**
   * P3 C5：远端目录刷新已删除（无 CDN 下载与租约控制）。保留该方法作为
   * "立即重读 Built-in 文件源" 的本地入口（文件源自身带 watcher，这里只补一次
   * 同步磁盘读取），消费方（refreshSources）语义不回退。
   */
  refreshZCodeBuiltin(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    return this.#zcodeBuiltinSource.read().then(() => undefined);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#zcodeBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
