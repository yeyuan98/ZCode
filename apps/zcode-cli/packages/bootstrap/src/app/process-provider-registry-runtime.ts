import {
  NodeModelSelectionConfigRepository,
  NodeProviderRegistryRuntime,
  resolveNodeProviderRuntimePaths,
} from "@zcode/provider-node";
import { readLegacyCliPersonalProviderConfig } from "./legacy-cli-personal-provider-config-importer.js";

export interface ProcessProviderRegistryRuntimeOptions {
  /** Standalone Prompt CLI / TUI 自己拥有旧配置的一次性导入。 */
  readonly standalone?: {
    readonly legacyCliUserConfigFilePath?: string;
  };
}

// P3 C5 供应商 client/configs 拉取删除：远端内置目录下载（client/configs →
// builtin_provider_config_json → CDN）与 TTL/租约刷新（zcodeBuiltinRemote）、
// 刷新 reporter（onBuiltinRefreshError / onBuiltinRefreshResult）已整体移除。
// Registry 只读打包/本地 zcode-builtin.json（ZCODE_BUILTIN_PROVIDER_CONFIG_FILE），
// 离线可用，不再有后台下载或刷新日志。
export async function startProcessProviderRegistryRuntime(
  env: Readonly<Record<string, string | undefined>>,
  options: ProcessProviderRegistryRuntimeOptions = {},
) {
  const paths = resolveNodeProviderRuntimePaths(env);
  if (!paths) {
    throw new Error("缺少进程 Provider Registry 的 ZCode Built-in / Personal Config 路径");
  }

  const runtime = new NodeProviderRegistryRuntime({
    ...paths,
    ...(options.standalone
      ? {
          importLegacy: () =>
            readLegacyCliPersonalProviderConfig(
              options.standalone?.legacyCliUserConfigFilePath
                ? { filePath: options.standalone.legacyCliUserConfigFilePath }
                : {},
            ),
        }
      : {}),
  });
  try {
    await runtime.start();
    const snapshot = runtime.registryService.getSnapshot()!;
    const modelSelectionConfigRepository = new NodeModelSelectionConfigRepository({
      personalRepository: runtime.personalRepository,
    });
    try {
      const configuredDefaultModelSelection = await modelSelectionConfigRepository.read();
      // P2：Account Provider 第三层 Overlay 与 standalone 账号运行时已删除；
      // 进程 Registry 只由 Built-in / Personal Config 驱动。
      return Object.freeze({
        dispose() {
          modelSelectionConfigRepository.dispose();
          runtime.dispose();
        },
        runtime,
        snapshot,
        modelSelectionConfigRepository,
        configuredDefaultModelSelection,
      });
    } catch (error) {
      modelSelectionConfigRepository.dispose();
      throw error;
    }
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}
