/** 默认反馈入口：GitHub Issues 新建 issue 页（P2 起替代内置反馈中心）。 */
export const DEFAULT_GITHUB_ISSUES_URL = "https://github.com/yeyuan98/ZCode/issues/new";

/**
 * 构建 GitHub Issues 新建 issue URL，仅在 title / body 非空时追加查询参数。
 * 不能用字符串拼接 `?new?title=`：baseUrl 自带 query（…/issues/new）时必须走
 * URL.searchParams，否则会产出裸 `?` 双问号地址。
 */
/** 标题/正文预填长度上限：超出会被浏览器/GitHub 414 拒绝并静默丢失预填。 */
const TITLE_QUERY_MAX_LENGTH = 120;
const BODY_QUERY_MAX_LENGTH = 6_000;

export function buildGitHubIssueUrl(input: {
  baseUrl?: string;
  title?: string;
  body?: string;
}): string {
  // 配置来源是本地 config/default.json，仍可能被手改成非法值；此时回退默认入口而不是让反馈按钮抛错。
  let url: URL;
  try {
    url = new URL(input.baseUrl?.trim() || DEFAULT_GITHUB_ISSUES_URL);
  } catch {
    url = new URL(DEFAULT_GITHUB_ISSUES_URL);
  }
  const title = input.title?.trim().slice(0, TITLE_QUERY_MAX_LENGTH);
  const body = input.body?.trim().slice(0, BODY_QUERY_MAX_LENGTH);
  if (title) url.searchParams.set("title", title);
  if (body) url.searchParams.set("body", body);
  return url.toString();
}
