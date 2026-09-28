type SkillSourceType = "zcode" | "unknown";

function resolveSkillSourceType(skillPath: string): SkillSourceType {
  const normalized = skillPath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/.zcode/skills/")) {
    return "zcode";
  }
  if (normalized.includes("/.zcode/cli/plugins/cache/")) {
    return "zcode";
  }
  return "unknown";
}

const SKILL_ID_PROVIDER_RE = /^zcode:/;

function isZcodeSkill(skill: { id?: string; path: string; scope?: string }): boolean {
  return (
    // plugin skill 的真实路径在 CLI plugin cache 下，不在 `.zcode/skills`。
    // 服务层已用 scope 标记来源，前端过滤时要放行，否则 `/` 和 `$` 面板会漏掉插件技能。
    skill.scope === "plugin" ||
    (typeof skill.id === "string" && SKILL_ID_PROVIDER_RE.test(skill.id)) ||
    resolveSkillSourceType(skill.path) === "zcode"
  );
}

// P6 2c：删除从未被读取的 _legacyProvider 形参（P4 供应商过滤死参数）。
export function filterSkillsForProvider<T extends { path: string; id?: string; scope?: string }>(
  skills: T[],
): T[] {
  return skills.filter(isZcodeSkill);
}
