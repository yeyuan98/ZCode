interface AppLaunchGateLike {
  consume(): boolean;
}

interface RendererReadyInput {
  rendererId: number;
}

// P3 C1 供应商 OAuth 删除：renderer ready 后不再等待 pending OAuth 回调
// （onOAuthCallbackHandled 与 waitingRendererId 队列已删除），ready 即消费启动 gate。
export function createAppLaunchCoordinator(appLaunchGate: AppLaunchGateLike) {
  return {
    onRendererReady({ rendererId }: RendererReadyInput): boolean {
      void rendererId;
      return appLaunchGate.consume();
    },
  };
}
