import assert from "node:assert/strict";
import test from "node:test";
import { ZCODE_PRODUCT_DOCS_URL } from "../src/lib/productDocs.ts";

/**
 * P6 2a（specs/vendor-free-gate-and-ci.md 关联清扫）：Help 菜单与命令面板的
 * "Product docs" 入口指向本仓库文档。厂商文档站已随去供应商化删除；此测试钉住
 * 入口不得回流厂商域名。
 */
test("产品文档入口指向本仓库文档", () => {
  assert.equal(ZCODE_PRODUCT_DOCS_URL, "https://github.com/yeyuan98/ZCode#readme");
});
