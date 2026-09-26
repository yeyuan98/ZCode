import { useState, type FormEvent } from "react";
import { Button } from "@zcode/ui";
import {
  loadPersistedServerOrigin,
  normalizeServerOriginInput,
  probeServerToken,
  savePersistedServerOrigin,
} from "./serverTokenLogin.js";
import { getServerTokenLoginCopy } from "./serverTokenLoginLocale.js";

interface ServerTokenLoginPageProps {
  /** 令牌校验通过（Cookie 已由服务端写入）后回调，由入口重新走应用启动流程。 */
  onAuthenticated: () => void;
}

const addressInputClassName =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-ui-xs text-foreground outline-none focus:border-input-border-focused";

export function ServerTokenLoginPage({ onAuthenticated }: ServerTokenLoginPageProps) {
  const copy = getServerTokenLoginCopy();
  const currentOrigin = window.location.origin;
  const [token, setToken] = useState("");
  const [address, setAddress] = useState(
    () => loadPersistedServerOrigin(currentOrigin) ?? currentOrigin,
  );
  const [addressExpanded, setAddressExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError(copy.emptyTokenError);
      return;
    }
    const normalizedAddress = normalizeServerOriginInput(address);
    if (!normalizedAddress) {
      setError(copy.invalidAddressError);
      return;
    }

    // Cookie（zcode_lite_token）按 origin 作用域生效：从当前 origin 跨域探测只会把
    // Cookie 写到目标 origin 的隔离存储，无法为当前页面建立登录态。因此当地址与
    // 当前 origin 不同时，直接跳转到目标服务器的登录页（?zcode_login=1 仅标记入口，
    // 绝不在跳转 URL 中携带令牌），由目标 origin 上的同一登录页完成同源探测与 Cookie 写入。
    savePersistedServerOrigin(currentOrigin, normalizedAddress);
    if (normalizedAddress !== currentOrigin) {
      window.location.replace(`${normalizedAddress}/?zcode_login=1`);
      return;
    }

    setError(null);
    setSubmitting(true);
    const outcome = await probeServerToken(normalizedAddress, trimmedToken);
    setSubmitting(false);
    if (outcome === "authenticated") {
      onAuthenticated();
      return;
    }
    setError(outcome === "invalid-token" ? copy.invalidTokenError : copy.unreachableError);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm rounded-lg border border-card-border bg-card p-5 shadow-sm">
        <h1 className="text-ui-lg font-medium text-foreground">{copy.title}</h1>
        <p className="mt-2 text-ui-xs leading-6 text-foreground-subtle">{copy.description}</p>
        <form className="mt-5" onSubmit={(event) => void handleSubmit(event)}>
          <label
            className="block text-ui-xs font-medium text-foreground-subtle"
            htmlFor="zcode-server-token"
          >
            {copy.tokenLabel}
          </label>
          <input
            id="zcode-server-token"
            className={`mt-2 ${addressInputClassName}`}
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={copy.tokenPlaceholder}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />

          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-ui-xs text-foreground-subtle">
              {/* 展示的是实际提交的目标地址：持久化的跨实例地址必须如实显示，避免"看着 A 却登录到 B"。 */}
              {address}
            </span>
            <button
              type="button"
              className="shrink-0 text-ui-xs text-foreground-subtle underline-offset-2 hover:underline"
              onClick={() => setAddressExpanded((expanded) => !expanded)}
            >
              {addressExpanded ? copy.advancedToggleHide : copy.advancedToggleShow}
            </button>
          </div>
          {addressExpanded ? (
            <div className="mt-2">
              <label className="sr-only" htmlFor="zcode-server-address">
                {copy.serverAddressLabel}
              </label>
              <input
                id="zcode-server-address"
                className={addressInputClassName}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="http://127.0.0.1:3030"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <p className="mt-1 text-ui-xs leading-5 text-foreground-subtle">
                {copy.serverAddressHint}
              </p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-4 break-words text-ui-xs leading-5 text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="mt-5 w-full" disabled={submitting}>
            {submitting ? copy.submittingAction : copy.submitAction}
          </Button>
        </form>
      </section>
    </main>
  );
}
