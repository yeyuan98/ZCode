# Provider 配置（模型供应商）

Zodex 不绑定任何特定厂商：任何 OpenAI / Anthropic 兼容的 API Key 供应商、以及本地模型（Ollama / vLLM）都可以作为 Provider 使用。

## 快速开始

1. 启动应用，首次运行会进入引导向导；也可以稍后在 **设置 → 模型供应商** 中添加。
2. 选择一种方式：
   - **内置供应商模板**（如 DeepSeek、OpenAI、z.ai、BigModel）：填入对应平台的 API Key 即可；
   - **Ollama（本地模型）**：选择 Ollama 模板，保持默认地址 `http://localhost:11434/v1`，无需 Key；
   - **自定义供应商**：填写任意 OpenAI / Anthropic 兼容的 Base URL 与 API Key。
3. 保存。内置模板与自定义供应商在保存时会自动发现可用模型；也可以在供应商详情页手动
   「发现模型」或逐个添加模型 ID。

## 本地模型

### Ollama

应用内置 Ollama 模板（OpenAI 兼容端点 `http://localhost:11434/v1`）。先在本机
[安装并启动 Ollama](https://ollama.com/)、拉取模型（如 `ollama pull qwen3-coder`），
然后在向导或设置中选择 Ollama 模板保存即可，模型列表会自动发现。

### vLLM

vLLM 没有内置模板，按「自定义供应商」配置：启动 vLLM 时打开 OpenAI 兼容服务
（`vllm serve <model> --port 8000`），然后在自定义供应商中填写
`http://127.0.0.1:8000/v1` 作为 Base URL（Key 可留空或任意占位），保存后自动发现模型。

## 参考

| 配置                                          | 用途                                       |
| --------------------------------------------- | ------------------------------------------ |
| 设置 → 模型供应商                             | 添加 / 编辑 / 删除供应商，发现与合并模型   |
| `.env` → `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 覆盖内置 Provider 目录的本地 JSON 文件路径 |
| [config/README.md](../config/README.md)       | 随客户端发布的内置默认配置说明             |

- 个人 Provider 配置持久化在应用数据目录中，与内置目录叠加；内置目录仅提供模板与
  模型能力元数据（如上下文长度、视觉能力），不包含任何密钥。
- 供应商请求直连其 Base URL；需要代理时在系统或应用层配置，应用不做供应商侧网关改写。
