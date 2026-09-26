import {
  createReleaseChangelogWriterOpts,
  RELEASE_CHANGELOG_PARSER_OPTS,
  RELEASE_CHANGELOG_TYPES,
} from "./scripts/release-it/changelog-writer.mjs";

export default {
  hooks: {
    // 版本号写入 package.json 会改变 notices 门禁的输入哈希；必须在 release commit
    // 之前再生成一次并纳入提交，否则下一次 licenses check 必定失败。
    "after:bump":
      "node scripts/licenses.mjs notices && git add third-party/inventory.json third-party/npm-overrides.json THIRD-PARTY-NOTICES.md",
  },
  git: {
    commitMessage: "chore: release v${version}",
    tagName: "v${version}",
    tagAnnotation: "Release v${version}",
    push: true,
  },
  github: {
    release: false,
  },
  gitlab: {
    release: false,
  },
  npm: {
    publish: false,
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        name: "conventionalcommits",
        types: RELEASE_CHANGELOG_TYPES,
      },
      parserOpts: RELEASE_CHANGELOG_PARSER_OPTS,
      writerOpts: createReleaseChangelogWriterOpts(),
      infile: "CHANGELOG.md",
    },
  },
};
