import assert from "node:assert/strict";
import test from "node:test";
import {
  isProviderStartupSyncPending,
  shouldBlockRootRender,
  shouldResolveProviderStartupState,
  shouldShowRootStartupLoading,
} from "../src/lib/rootStartupGate.ts";

test("provider startup sync waits for both settings hydration and model selection view", () => {
  // settings 未水化时必须继续等待：跳过标志（providerOnboardingDismissedAt）存在 settings 中，
  // 提前判定会把已跳过向导的用户误弹向导。
  assert.equal(
    isProviderStartupSyncPending({
      settingsHydrated: false,
      modelSelectionViewHydrated: true,
    }),
    true,
  );
  assert.equal(
    isProviderStartupSyncPending({
      settingsHydrated: true,
      modelSelectionViewHydrated: false,
    }),
    true,
  );
  assert.equal(
    isProviderStartupSyncPending({
      settingsHydrated: true,
      modelSelectionViewHydrated: true,
    }),
    false,
  );
});

// P3 C1 供应商 OAuth 删除：启动 auth 恢复门禁字段（isResolvingStartupAuthState）已移除，
// 门禁只由 provider 启动态 / tab 恢复 / workspace 引导构成。
test("root render gate keeps blocking while provider startup state resolves", () => {
  assert.equal(
    shouldBlockRootRender({
      isResolvingProviderStartupState: false,
      isRestoring: false,
      isBootstrappingInitialWorkspace: false,
    }),
    false,
  );
  assert.equal(
    shouldBlockRootRender({
      isResolvingProviderStartupState: true,
      isRestoring: false,
      isBootstrappingInitialWorkspace: false,
    }),
    true,
  );
});

test("root startup loading stays hidden once the welcome screen is open", () => {
  const base = {
    isDesktop: true,
    isResolvingProviderStartupState: true,
    isRestoring: false,
    isBootstrappingInitialWorkspace: false,
  };
  assert.equal(shouldShowRootStartupLoading({ ...base, welcomeScreenOpen: false }), true);
  assert.equal(shouldShowRootStartupLoading({ ...base, welcomeScreenOpen: true }), false);
});

test("provider startup resolution covers pending sync and incomplete availability check", () => {
  assert.equal(
    shouldResolveProviderStartupState({
      providerStartupSyncPending: true,
      providerAvailabilityStartupCheckCompleted: true,
    }),
    true,
  );
  assert.equal(
    shouldResolveProviderStartupState({
      providerStartupSyncPending: false,
      providerAvailabilityStartupCheckCompleted: false,
    }),
    true,
  );
  assert.equal(
    shouldResolveProviderStartupState({
      providerStartupSyncPending: false,
      providerAvailabilityStartupCheckCompleted: true,
    }),
    false,
  );
});
