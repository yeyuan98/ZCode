import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GITHUB_ISSUES_URL, buildGitHubIssueUrl } from "../src/githubIssueUrl.ts";

/**
 * 契约（specs/onboarding-and-gate.md 第 5 条）：
 * 反馈入口统一跳转 `https://github.com/yeyuan98/ZCode/issues/new`，
 * 错误摘要 / 任务 id 等上下文通过 `title` / `body` 查询参数预填；
 * 无上下文时不能产出带尾随裸 `?` 的地址。
 */
test("buildGitHubIssueUrl: 缺省 baseUrl 使用 GitHub Issues 入口", () => {
  assert.equal(buildGitHubIssueUrl({}), DEFAULT_GITHUB_ISSUES_URL);
  assert.equal(DEFAULT_GITHUB_ISSUES_URL, "https://github.com/yeyuan98/ZCode/issues/new");
});

test("buildGitHubIssueUrl: title/body 非空才追加查询参数", () => {
  assert.equal(
    buildGitHubIssueUrl({ title: "崩溃了", body: "步骤…" }),
    "https://github.com/yeyuan98/ZCode/issues/new?title=%E5%B4%A9%E6%BA%83%E4%BA%86&body=%E6%AD%A5%E9%AA%A4%E2%80%A6",
  );
  // 空白字符串与 undefined 等价，不能留下空参数或尾随问号。
  assert.equal(buildGitHubIssueUrl({ title: "  ", body: undefined }), DEFAULT_GITHUB_ISSUES_URL);
});

test("buildGitHubIssueUrl: 自定义 baseUrl（含已带 query 的地址）不会拼出双问号", () => {
  assert.equal(
    buildGitHubIssueUrl({ baseUrl: "https://example.com/issues/new", title: "bug" }),
    "https://example.com/issues/new?title=bug",
  );
  // URL.searchParams 会正确并入已有 query，而不是追加第二个 ?。
  assert.equal(
    buildGitHubIssueUrl({ baseUrl: "https://example.com/issues/new?labels=bug", body: "detail" }),
    "https://example.com/issues/new?labels=bug&body=detail",
  );
});

test("buildGitHubIssueUrl: 非法 baseUrl 回退默认入口而不是抛错", () => {
  assert.equal(buildGitHubIssueUrl({ baseUrl: "not a url" }), DEFAULT_GITHUB_ISSUES_URL);
});
