# Review Subsystem

Review 是 `code-engineering` 的独立横向质量工具，不绑定重构，也不属于默认必经流程。它适用于需求开发、Feature、Bugfix、架构调整、性能优化和重构。

## Skills

| Skill | 对象 | 问题 |
| --- | --- | --- |
| `$solution-review <artifact>` | PRD / Spec / 技术方案 / 架构方案 / Bugfix Plan / Refactor Plan | 准备这样做是否正确、完整、可实施？ |
| `$code-review <scope>` | commit / PR / diff / path / 实际实现 | 实际代码是否正确、符合方案、工程规范和验证要求？ |
| `$review-followup <report>` | 任意 Review Report | 用户选中的 Finding 是否成立？应修复、部分采纳、驳回还是忽略？ |

## 核心原则

Review 的执行权在用户：

- 要不要 Review，由用户决定；
- Review 哪个 Scope，由用户决定；
- Review 多少次，由用户决定；
- 要不要 Followup，由用户决定；
- Followup 后要不要再次 Review，也由用户决定。

Skill 不得把 Review 自动升级为流程 Gate。

## 可选用法

```text
Solution Artifact
  └─→ solution-review        # 用户需要第二意见时

Implementation
  └─→ code-review            # 用户需要独立质量保证时

Review Report
  └─→ review-followup        # 用户决定处理 Findings 时
```

这些调用可以出现 0 次、1 次或多次。

## 什么时候值得 Review

更适合主动 Review 的场景：

- 大型或高风险架构方案；
- Public Contract / persisted schema / migration；
- transaction / concurrency / security / data integrity；
- 跨 package / service 边界；
- 用户明确希望获得第二意见；
- 实现范围大、风险高或验证证据不足。

普通局部重构、小型 Bugfix、低风险文档调整不需要为了流程完整性强制 Review。

## Followup

- `review-followup` 必须先验证 Finding，再决定是否修改；
- Finding 可以是 `Valid / Partially Valid / Invalid / Obsolete`；
- 不需要处理所有 Finding；用户可以选择其中一部分；
- Followup 完成后不自动触发复审；
- 只有当修复显著扩大范围、改变方案、触及新合同或风险时，再次 Review 才更有价值。

## Review 质量

- Review 默认只审查，不修改被审对象；
- Finding 必须有证据和影响，不允许为了“有 Review 价值”强行找问题；
- `0 findings` 是合法结果；
- Review 报告是否持久化由项目/用户决定；需要历史时保留，不需要时可直接输出结构化结论。
