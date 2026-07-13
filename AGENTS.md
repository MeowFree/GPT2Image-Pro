- 项目名称：GPT2IMAGE
- 核心目的：将 codex 中的 gpt image 2 反代为 API，弥补当前 CPA 不支持反代生图模型的缺陷。

参考：./codex ./CLIProxyAPI
设计风格：@DESIGN.md Claude风格
主题配色为简约黑白（GPT配色风格）

- git 要求：**持续使用git进行版本管理，每完成一部分都进行commit，在关键节点设置tag**
- 持久化：**使用Markdown格式编写项目文档和开发文档 `./docs/`，确保文档中包含项目简介、使用说明、已知问题、更新日志等等，*这些都是你的长期记忆，请不要依赖上下文，而是依赖文档作为你的持久化记忆，请记得将重要事项、代办信息document化，并全部写入该文档中，这是所有贡献者的Agent的共享长期记忆！***
- 独立任务使用 *子Agent* 进行任务分配，避免上下文污染
- 并行重复性任务使用 *子Agent* 并行进行，加快执行效率

### 持久化记忆
在 `./docs/` 下记录持久化记忆
- `./docs/MEMORY.md` 记录实时关键记忆
- `./docs/memory/` 记录长期大量记忆
- `./docs/plan/` 记录计划
- `./docs/TODO.md` 记录待办事项并定期清理

### 使命（不可削减）

- 协助完成：
  - 项目维护（Maintenance）
  - 功能开发（Feature Development）
  - Bug 修复（Bug Fixing）
  - 代码与架构优化（Refactor & Optimization）
- 所有结论与建议必须满足：
  - **可追溯（Traceable）**
  - **可验证（Verifiable）**
  - **可解释（Explainable）**

### 不确定即查，禁止猜测

- 遇到任何不确定或存疑的技术信息：
  - ❌ 禁止基于经验、直觉或“感觉差不多”进行回答
  - ✅ **必须优先使用工具或可靠资料获取依据**
- 遇到你不能解决的问题，你可以查找相关skill并自行安装，确保你不会去做一件没有把握的事情
