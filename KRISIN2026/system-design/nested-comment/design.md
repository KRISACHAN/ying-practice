# Design Nested Comment System：多层级评论系统与数据模型设计（System Design）

> **版本**：1.0 · 2026-10-28
>
> **定位**：系统设计面试 + PostgreSQL 树形数据建模 + Node.js / Go 工程实践参考
>
> **技术主线**：PostgreSQL（Adjacency List / Recursive CTE / `ltree` / Closure Table）；Node.js + TypeScript + Hono；Go + Gin；按需引入 Redis / NATS JetStream
>
> **边界声明**：本文设计通用的 **Reddit-like Nested Comment System**，不是 Reddit、Hacker News 等产品的真实内部实现。流量数字、SLO、深度限制、排序和表结构都是供学习与验证的设计假设。本文是 [Design Reddit](../reddit/design.md) 的**评论子系统深挖**：MVP 沿用它的 `comments` 邻接表与根评论倒序、子评论正序规则；高级模型是替代/增补方案，不应将几套 DDL 在同一项目中不加区分地叠加部署。

## 阅读路线

1. **业务与约束**：先搞清「评论」「回复」「删除」「排序」「分页」的产品语义。
2. **规模与指标**：估算读写比、热点父评论、树的宽度与深度。
3. **高层架构（HLD）**：从模块化单体、PostgreSQL 开始，而不是从 Redis / Kafka 开始。
4. **数据模型（LLD）**：比较邻接表、物化路径、闭包表、嵌套集合；写出约束和索引。
5. **核心写入**：创建、回复、删除、恢复、编辑及并发竞争。
6. **核心读取**：Keyset、按层懒加载、批量子评论、递归 CTE、避免 N+1。
7. **工程落地**：Hono / Gin 的框架包、模块目录、事务边界、测试。
8. **进阶与面试**：热点计数、缓存、异步消息、子树移动、容量演进与追问。

**建议读法**：先读 1–10、12、16、18、20、23 节。重点回答「如何保证父子关系合法」「为什么不一次读取整棵树」「父评论删除后其回复怎么办」。第 11 节专门比较高级数据模型；先理解，再根据实际查询负载决定是否落地。实践建议 **Go + Gin + PostgreSQL + pgx/sqlc** 优先，Node/Hono 作为对照语言，不必同时实现两套复杂后端。

---

## 1. 需求澄清（Requirements）

### 1.1 角色与核心链路

- **访客**：阅读有权限访问的帖子，按层展开评论与回复。
- **登录用户**：发布顶层评论、回复评论、编辑/删除自己发表的评论。
- **作者/讨论参与者**：关注回复关系和有限的新回复提示。
- **社区审核员**：移除/恢复违规评论，查看必要审计记录。
- **系统**：维护父子关系、帖子归属、计数、游标、权限和故障恢复。

示例树（`depth` 以根评论为 0）：

~~~text
Post P
├── A (depth=0)                 根评论
│   ├── B (depth=1)             回复 A
│   │   └── D (depth=2)         回复 B
│   └── C (depth=1)             回复 A
└── E (depth=0)                 另一个根评论

A.parent_id = NULL
B.parent_id = A.id
D.parent_id = B.id
E.parent_id = NULL
所有节点 post_id = P.id
~~~

这里的「树」是**逻辑数据结构**，不意味着客户端应该一次拿到整个树，也不意味着数据库必须存成嵌套 JSON。

### 1.2 功能需求（Functional Requirements）

| 优先级 | 功能 | 验收条件 |
| --- | --- | --- |
| P0 | 发布顶层评论 | 归属有效帖子，`parent_id = NULL`、`depth = 0` |
| P0 | 回复某条评论 | 父评论存在、属于同一帖子、未超过最大深度 |
| P0 | 根评论分页 | 稳定按 `created_at DESC, id DESC` 读取，不用大 OFFSET |
| P0 | 子评论分页 | 指定父节点，按 `created_at ASC, id ASC` 分页 |
| P0 | 读取指定评论 / 祖先链 | 能定位深层回复及其上下文 |
| P0 | 编辑、删除、审核移除 | 正文/可见性正确，保留关系或明确删除策略 |
| P0 | 鉴权、限流、幂等 | 不能越权回复；网络重试不会重复创建 |
| P0 | 并发正确性 | 删除 vs 回复、双击发送、跨帖引用有确定结果 |
| P1 | 评论投票、回复通知 | 与 Reddit 的投票、Outbox 模块集成 |
| P1 | 点赞/热度排序、折叠、更多回复 | 有明确一致性与游标语义 |
| P2 | 子树移动、跨帖移动、全量导出 | 默认不开放；如开放需迁移与锁协议 |

### 1.3 非功能需求（Non-functional Requirements）

以下均是**练习目标**，不代表真实产品 SLA：

- 正确性优先：**无跨帖父子关系、无环、深度受限、同一个幂等键不能创建两个评论**。
- 根/子评论第一页 API p95 **< 200ms**（同区域服务端处理目标；不含客户端网络与图片）。
- 创建评论 API p95 **< 300ms**；极端热点允许降级或限流，不能牺牲事务正确性。
- 评论主写入的事务提交成功后，刷新接口必须可以从主库读到；只读副本可能存在复制滞后。
- 客户端可以逐层展开、折叠，避免单次返回数千条评论。
- 删除和审核的正文遮罩不依赖缓存按时过期；权限和可见性在交付前必须复核。
- 评论写入/回复通知容错：数据库是真相来源，通知延迟可接受。

### 1.4 面试必须先问的问题

1. 评论允许**无限深**，还是限制到 10/20 层？达到上限如何回应？
2. 主要场景是 Reddit 样式逐层展开，还是需要经常查询**整棵子树**？
3. 根评论、新回复按时间还是分数排序？排序会不会不断变化？
4. 删除父评论是否连带删除所有子孙，还是保留 `[deleted]` 占位？
5. 是否允许改变 `parent_id`（移动整棵子树）、跨帖迁移？
6. 评论数是**累计创建数**、**当前可见数**，还是包含已删/已审核数？

**本文默认约定**：

- 单条评论属于一个帖子，`post_id` 创建后不可修改；`parent_id` 创建后不可修改。
- `depth` 根节点为 0，最大 20；第 20 层不允许继续回复。
- 根评论按新到旧、直接回复按旧到新；初版不提供全局「整棵树 Best 排序」。
- 作者删除/审核移除只改变**该节点**可见性；已存在的子评论不因此删除。
- **只允许回复 VISIBLE 父评论**；之前已经存在的后代仍可阅读（视帖子/社区权限）。
- `posts.comment_count` 默认表示**当前可见评论数**，删除或恢复需要相应变化；编辑不改变计数。
- 单帖子默认可访问权限由帖子/社区模块校验；本题不重复设计完整用户/社区系统。

---

## 2. 容量估算（Back-of-the-envelope Estimation）

> 估算数字为教学假设，目的是识别系统瓶颈；要把「每帖平均」和「极端热点帖子」分开。

假定日新增评论 200 万、日评论列表请求 1 亿、写入峰值为均值 20 倍、读峰值为均值 10 倍、单条持久化评论及正文原始大小粗估 800B：

| 指标 | 算式 | 估算 |
| --- | --- | --- |
| 平均评论写入 QPS | 2,000,000 / 86,400 | 约 23 次/秒 |
| 峰值评论创建 QPS | 23.1 × 20 | **约 463 次/秒** |
| 平均列表请求 QPS | 100,000,000 / 86,400 | 约 1,157 次/秒 |
| 峰值列表请求 QPS | 1,157 × 10 | **约 11,574 次/秒** |
| 评论基础数据 | 2M × 800B | 约 1.6GB/日 |
| 一年基础评论数据 | 1.6GB × 365 | 约 584GB（不含索引/副本/WAL/备份） |
| 单次正常分页 | 每页 20–50 条 | 有界响应与数据库扫描 |
| 极端热点 | 单帖几十万条、单父节点几万条回复 | **不能把整树塞进一个响应** |

**关键不是平均树深，而是树宽与流量偏斜**：最大深度即使限制 20，也可能存在一个根评论拥有 100,000 个直接回复；反过来，一棵深度 20、每层仅 1 个节点的链表对数据库不一定更难。

还应按真实负载继续测量：单帖子根评论数分布、每父节点的子评论数 P99、正文长尾、热点评论写锁等待、缓存命中、每秒删除/审核、游标翻页深度。不能仅用全站平均 QPS 推断某个热点帖是否安全。

---

## 3. 核心设计结论（先给答案）

1. **首选 Adjacency List（邻接表）**：`comments.parent_id` 指向父节点；使用 PostgreSQL 的复合外键保护同帖关系，业务事务保证父节点状态和深度。
2. **用户读的是局部树，不是整树**：根评论与每条评论的直接回复分别 Keyset Pagination；客户端懒加载、折叠并按需批量取子节点。
3. **不要仅靠 `CHECK` 证明整棵树没有环**：`CHECK` 无法验证任意跨行祖先关系；MVP 冻结 parent，即可把图退化成安全的「只向已有节点添加叶子」操作。
4. **删除保留 Tombstone**：正文对外遮罩、关系保留；已有子评论不被破坏。作者删除和审核移除遵循不同权限与恢复策略。
5. **强一致约束在 PostgreSQL**：创建、可见计数、幂等记录、Outbox 由同一事务提交；Redis 不担任评论树的事实来源。
6. **高级模型按访问模式引入**：`WITH RECURSIVE` 用于偶发祖先/子树查询；频繁整子树查询才评估 `ltree` 或 Closure Table；频繁插入时不优先 Nested Set。
7. **从模块化单体起步**：Hono 与 Gin 使用一致的 HTTP 契约和数据库语义；Redis、MQ、独立读模型在实际瓶颈出现后引入。

---

## 4. 高层架构（High-Level Design）

### 4.1 MVP：模块化单体

~~~mermaid
flowchart TB
  U[Web / Mobile 客户端] --> LB[HTTPS / Load Balancer]
  LB --> API[Hono 或 Gin API]
  API --> AUTH[Auth / Post Access]
  API --> C[Comment Module]
  C --> S[Create / Edit / Delete Service]
  C --> Q[Root / Replies / Context Query]
  S --> DB[(PostgreSQL)]
  Q --> DB
  AUTH --> DB
  S -. 同事务 .-> O[Outbox Table in PostgreSQL]
~~~

- `Comment Module` 是代码内的模块，不是必须单独部署的微服务。
- 写请求默认访问主库；读副本接入后需要考虑读己之写（read-your-writes）。
- MVP 完全可以**不部署** Redis、Kafka、NATS 或搜索引擎。

### 4.2 增长期：读写分离、缓存与事件

~~~mermaid
flowchart LR
  C[客户端] --> API[API Gateway / Comment API]
  API --> W[Comment Write Service]
  API --> R[Comment Read Service]
  W --> PG[(PostgreSQL Primary)]
  PG --> REPL[(Read Replica)]
  R --> REPL
  R --> REDIS[(Redis：列表/计数缓存)]
  PG --> OUT[Transactional Outbox]
  OUT --> PUB[Publisher]
  PUB --> MQ[(NATS JetStream)]
  MQ --> NW[Notification Worker]
  MQ --> CW[Count / Ranking Projector]
  CW --> PG
  CW --> REDIS
~~~

扩容时**数据所有权仍唯一**：`comments` 及父子事实由 PostgreSQL 主库维护；Redis 只是可重建的读缓存。副本延迟和事件重放不会改变已提交的父子关系。

### 4.3 数据归属和一致性矩阵

| 数据 | 事实来源 | 一致性策略 | 故障时如何恢复 |
| --- | --- | --- | --- |
| 评论 ID、帖子、父 ID、深度 | PostgreSQL `comments` | 写事务 + FK + 业务校验 | 主库重读 |
| 内容状态、作者编辑 | PostgreSQL | 事务与权限控制 | 主库重读，审计追踪 |
| 发表请求去重 | PostgreSQL `idempotency_requests` | 唯一键，同事务 | 原响应重放 |
| 可见评论数（MVP） | PostgreSQL `posts.comment_count` | 同事务更新 | 与事实扫描对账 |
| 批量排序/热榜（P1） | PG 投影 / Redis | 最终一致、版本化 | 重建排名 |
| 回复通知 | Outbox → MQ → Worker | 至少一次 + 幂等消费 | 重试、重放 |
| 已缓存的列表 | Redis | 允许过期，但展示前检查安全边界 | 主库查询/旁路 |

---

## 5. 树形数据模型比较（本题核心）

### 5.1 四种模型怎么选？

| 模型 | 核心存储 | 查直接孩子 | 查整棵子树 | 新增回复 | 移动子树 | 典型适用 |
| --- | --- | --- | --- | --- | --- | --- |
| **Adjacency List** | 每行 `parent_id` | 简单索引查询 | 递归 CTE | **O(1) 行级插入** | 递归修改深度/父子关系 | **评论、回复** |
| Materialized Path | 每行存完整祖先路径 | 路径或 parent 查询 | 路径前缀查询 | 路径拼接，约 O(depth) 数据长度 | 修改整子树路径 | 读多、常查子树 |
| Closure Table | 单独存所有祖先-后代对 | distance=1 | 关联表查询 | 写入 O(depth) 条祖先关系 | 批量删除/重建关系 | 复杂祖先/后代查询 |
| Nested Set | `lft/rgt` 区间 | 需区间或 depth | 区间查询 | **需要移动大量区间值** | 很昂贵 | 相对静态的树 |

**不要将复杂度写成绝对常数**：真实成本取决于索引、树宽、树深、页读取、锁竞争和更新放大。邻接表「新增 O(1)」指新增节点关系行的量级，仍需父节点读取、唯一性/权限校验及可选计数事务。

### 5.2 为什么优先选 Adjacency List？

~~~text
comments
┌────┬─────────┬───────────┬───────┐
│ id │ post_id │ parent_id │ depth │
├────┼─────────┼───────────┼───────┤
│ A  │ P       │ NULL      │ 0     │
│ B  │ P       │ A         │ 1     │
│ C  │ P       │ A         │ 1     │
│ D  │ P       │ B         │ 2     │
│ E  │ P       │ NULL      │ 0     │
└────┴─────────┴───────────┴───────┘
~~~

直接孩子：`WHERE post_id = P AND parent_id = A`；根评论：`WHERE post_id = P AND parent_id IS NULL`。这两种查询刚好匹配 Reddit-like UI **按层读取**的访问模式。

为了得到祖先路径或导出整个讨论分支，邻接表可以使用 PostgreSQL `WITH RECURSIVE`，**不等于**必须每次请求都递归。PostgreSQL 官方明确支持递归 CTE、`SEARCH` 和 `CYCLE` 处理层级遍历。[PostgreSQL WITH Queries](https://www.postgresql.org/docs/current/queries-with.html)

### 5.3 为什么「只要有 parent_id」还不够？

必须另外处理：

- **跨帖引用**：A 帖子的评论不得把 B 帖子的评论设成父节点。
- **自引用与环**：节点不能回复自己，更不能产生 A → B → A。
- **深度漂移**：客户端传 `depth=2` 并不可信，应由可信父节点 `depth+1` 计算。
- **状态竞争**：父节点刚被审核移除时，另一个请求还在尝试回复。
- **幽灵重复**：同一次发送因网络重试而多插入一条评论。
- **树结构和读顺序**：`parent_id` 只描述关系，无法替代明确的 `ORDER BY`。

**关键不变量（Invariants）**：

1. `parent_id IS NULL ⇔ depth = 0`。
2. 对非根节点：`parent.post_id = child.post_id`。
3. 对非根节点：`child.depth = parent.depth + 1`，并且 `depth <= 20`。
4. `parent_id`、`post_id` 一经创建不可变（MVP）。
5. 评论的删除/隐藏不能使仍存在的子评论变成孤儿。
6. 同一主体、操作和幂等键下最多执行一次创建命令。

复合 FK 可以直接保护第 2 条；深度正确性、第 4 条和权限/状态需由事务协议与数据库权限共同维护（若允许其他应用直接写表，应用层校验本身不够，需收紧写权限或加入可信触发器）。

---

## 6. PostgreSQL 数据表、约束和索引（LLD）

### 6.1 实体关系（与 Design Reddit 对齐）

~~~mermaid
erDiagram
  USERS ||--o{ POSTS : writes
  POSTS ||--o{ COMMENTS : has
  USERS ||--o{ COMMENTS : authors
  COMMENTS ||--o{ COMMENTS : replies
  COMMENTS ||--o{ COMMENT_VOTES : receives
  USERS ||--o{ COMMENT_VOTES : casts
  USERS ||--o{ IDEMPOTENCY_REQUESTS : owns
  COMMENTS ||--o{ OUTBOX_EVENTS : emits
~~~

这里复用 Reddit 模块的 `users`、`posts`、`comments`、`comment_votes`、`idempotency_requests`、`outbox_events` 和 `processed_events`。实际项目应只有**一套统一迁移**，不能让 Reddit 和 Nested Comment 两个应用独立创建同名业务表。

### 6.2 代表性 DDL（与 Reddit 基线兼容）

下面的 `comments` 表以 [Design Reddit 的 Schema](../reddit/design.md#52-代表性-ddl教学基线) 为基础；假设 `users` 和 `posts` 已由 Reddit 文档创建。为了便于独立审阅，完整列出评论表。**整段在同一个数据库中只执行一次**；不是要求在已存在 `comments` 时再次 `CREATE TABLE`。

~~~sql
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  author_id uuid NOT NULL REFERENCES users(id),
  parent_id uuid,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  status text NOT NULL DEFAULT 'VISIBLE'
    CHECK (status IN ('VISIBLE','REMOVED','DELETED')),
  depth integer NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 20),
  upvotes bigint NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  downvotes bigint NOT NULL DEFAULT 0 CHECK (downvotes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- PostgreSQL 复合 FK 要求被引用列有 UNIQUE/PK。
  UNIQUE (post_id, id),

  -- 同时验证「父 ID 存在」与「父评论属于同一帖子」。
  FOREIGN KEY (post_id, parent_id) REFERENCES comments(post_id, id),

  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (
    (parent_id IS NULL AND depth = 0)
    OR (parent_id IS NOT NULL AND depth > 0)
  )
);

-- 根节点按最新优先；注意不排除 REMOVED/DELETED，
-- 因为保留占位节点可使其已有回复仍被找到。
CREATE INDEX comments_roots_idx
  ON comments(post_id, created_at DESC, id DESC)
  WHERE parent_id IS NULL;

-- 直接回复按旧到新。
CREATE INDEX comments_children_idx
  ON comments(post_id, parent_id, created_at ASC, id ASC);

-- 需要作者的历史记录时再考虑：
CREATE INDEX comments_author_created_idx
  ON comments(author_id, created_at DESC, id DESC);
~~~

解释：

- `UNIQUE(post_id, id)` 看似和 `id PRIMARY KEY` 重复，却允许复合外键 `FOREIGN KEY (post_id, parent_id)` 明确约束**同帖父评论**。
- 非根查询仍会读 tombstone；不能为了节省索引把所有非 VISIBLE 节点提前过滤，否则可能切断讨论链。
- PostgreSQL 的 `CHECK` 不能跨行检查 `depth = parent.depth+1`，也无法用它验证环。[PostgreSQL Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- `ON DELETE CASCADE` **不要**用于这个父子 FK：物理删除父节点会级联破坏回复；删除评论应先走业务状态转换。
- 根节点深度为 0、非根 >0 的 CHECK 是独立文档的增强；如果直接沿用 Reddit 已建表，应通过 migration `ALTER TABLE ... ADD CONSTRAINT` 补齐，而不是重复建表。
- `upvotes/downvotes` 复用 Reddit 的事实/计数策略；本题不重复设计完整投票事务。

**数据保留策略**：兼容基线要求 `body NOT NULL`。作者删除时用占位文本 `[deleted]` 覆写原正文；审核移除可以暂留正文以供有权限的审核恢复，但公共查询必须遮罩。对隐私法规/严格内容安全场景，建议后续迁移到「公开正文可 NULL + 受限审核存储」；不能只在 UI 隐藏却让普通 API 仍返回原文。备份和审计日志的敏感数据保留策略必须另定。

### 6.3 可选增强：显式版本与子节点统计

~~~sql
-- 如果要做乐观并发编辑，版本列需要 migration。
ALTER TABLE comments
  ADD COLUMN version bigint NOT NULL DEFAULT 1
  CHECK (version >= 1);

-- reply_count 可表示「直接可见子节点数」，
-- 不是所有后代数；它是可重建投影，不是关系事实。
-- ALTER TABLE comments ADD COLUMN direct_reply_count bigint ...;
~~~

不要为每次回复无条件更新所有祖先节点的计数：深度越大，写入放大越明显，热门根节点会成为写热点。MVP 可先不保存子节点数量；列表多取一行判断 `hasMore`，在确实需要「还有 N 条回复」时再引入直系计数或异步投影。

### 6.4 索引为何这样排列？

- `comments_roots_idx` 的查询谓词包含 `post_id = ? AND parent_id IS NULL`，排序键为 `(created_at DESC, id DESC)`；这是典型 Partial Index。
- `comments_children_idx` 的过滤前缀为 `(post_id, parent_id)`，随后按 `(created_at ASC, id ASC)` 索引顺序扫描。
- 最后用 `id` 破除同一微秒生成评论时的排序平局；只按 `created_at` 做游标可能漏项。
- 索引提升读性能，但也增加写入、WAL、存储成本；不能每个字段都建一个索引。

真正是否使用索引应依 `EXPLAIN (ANALYZE, BUFFERS)` 验证。PostgreSQL 官方对 Partial Index、复合索引和 `ORDER BY` 的索引行为均有明确说明。[PostgreSQL Indexes](https://www.postgresql.org/docs/current/indexes.html)

---

## 7. HTTP API、DTO 与幂等协议

### 7.1 REST API 草案

| 方法 | URL | 语义 |
| --- | --- | --- |
| GET | `/v1/posts/:postId/comments?cursor=...&limit=...` | 取某帖根评论，倒序分页 |
| POST | `/v1/posts/:postId/comments` | 创建根评论或回复（`parentId` 可空） |
| GET | `/v1/comments/:commentId/replies?cursor=...&limit=...` | 指定父评论的直接子节点，正序分页 |
| GET | `/v1/comments/:commentId/context` | 找祖先链（P0 的深链定位） |
| PATCH | `/v1/comments/:commentId` | 作者编辑（可用 If-Match / version） |
| DELETE | `/v1/comments/:commentId` | 作者软删除，接口目标状态幂等 |
| POST | `/v1/moderation/comments/:id/remove` | 管理员审核移除 |
| POST | `/v1/moderation/comments/:id/restore` | 管理员恢复，受审核策略限制 |
| GET | `/v1/comments/:id/subtree` | **非 MVP**：受限导出或受限查看子树 |
| PUT | `/v1/comments/:id/vote` | 由 Reddit 投票模块提供，非本题核心 |

**权限前置**：所有读取先检查帖子/社区可访问。`GET /comments/:id/replies` 不能因为知道一个评论 ID 就绕过帖子权限。写入同理：用户身份来自认证上下文，不接受客户端发送 `authorId`、`postId` 的另一路信任值或 `depth`。

### 7.2 创建评论请求与响应

~~~json
{
  "parentId": "e5c21baf-f34d-4e9d-8d09-40e4aaf36ca8",
  "body": "我同意，不过还要考虑分页的稳定性。"
}
~~~

请求头：`Idempotency-Key: <client-generated-random-key>`；创建根评论时 `parentId: null`。`postId` 从路由获取，`depth` 由服务器计算。

~~~json
{
  "id": "3105bb71-38a9-4fb5-a4e4-c00413b93a39",
  "postId": "ce8f608c-53d4-4c42-a9d0-ecbf2b727f4b",
  "parentId": "e5c21baf-f34d-4e9d-8d09-40e4aaf36ca8",
  "depth": 2,
  "status": "VISIBLE",
  "createdAt": "2026-10-28T12:00:00Z"
}
~~~

**错误语义**：401 未登录、403 无权/禁言、404 对象不存在或不可访问、409 父评论状态变化/版本冲突/幂等键参数不一致、422 参数错误或最大深度、429 触发限流。是否把深度超限定义为 409 或 422 需契约固定；本文使用 422。不要把数据库外键错误原样暴露给客户端。

### 7.3 游标协议：绑定作用域而非只存时间

响应形式：

~~~json
{
  "items": [],
  "nextCursor": null,
  "hasMore": false
}
~~~

游标内部字段（**概念载荷，不要明文信任客户端**）：`v, postId, parentId, sort, lastCreatedAt, lastId, expiresAt`。由服务端 HMAC 签名（或保存短期服务端游标 ID），验证资源绑定、顺序、有效期和最大 pageSize。

根评论游标不能用于 B 评论的子回复；`nextCursor` 必须对应**最后一条实际返回给客户端**的记录，而非为判断 `hasMore` 多取的第 21/51 条记录。

### 7.4 幂等创建的事务语义

对创建评论，Scope 为 `(actor_id, operation='comment.create', idem_key)`；配套 `request_hash` 含 `postId/parentId/body` 的规范化结果。

沿用 Reddit 的 `idempotency_requests`（`response_body NOT NULL`）时可采用如下协议：

1. `BEGIN`，尝试先 INSERT 预留唯一键，`response_body` 暂写 `{}::jsonb`，`ON CONFLICT DO NOTHING RETURNING`。
2. 插入成功：本事务**尚未提交**，其他请求看不到临时响应；继续锁帖子、检查父节点、插入评论、写计数/Outbox。
3. 用完整的 `response_body` 更新本次幂等行，`COMMIT` 后返回。
4. 唯一键冲突：等待竞争事务结束后，**下一条 SQL** 读取已提交 `request_hash` 和响应。哈希一致就返回原结果，不一致 409；不再创建评论。
5. 事务回滚时预留行也回滚，重试可以重新执行。键 TTL 明确告知客户端；过期后不能承诺永久去重。

只在 HTTP 控制器里「检查 Redis 是否见过请求」无法保证 DB 写入的严格一次性效果；幂等唯一约束和业务写入必须处于**同一事务**。

---

## 8. 评论状态机、并发写入与删除

### 8.1 状态机（一个节点，不是整棵树）

~~~mermaid
stateDiagram-v2
  [*] --> VISIBLE: publish
  VISIBLE --> DELETED: author delete
  VISIBLE --> REMOVED: moderator remove
  REMOVED --> VISIBLE: moderator restore
  REMOVED --> DELETED: author delete
  DELETED --> [*]
~~~

- `VISIBLE`：正常可见、默认可回复。
- `REMOVED`：审核遮罩，不再允许新回复；恢复由管理员操作并有审计。
- `DELETED`：作者删除，正文替换为占位，默认不可恢复/不可新回复。
- **已有后代保留原状态**：比如 A 被删，B/C/D 若可见依旧存在，浏览时显示 `[deleted]` 的 A 作为连接节点。

### 8.2 为什么父评论删除不能直接 `DELETE FROM comments`？

物理删除可能带来三个问题：外键拒绝、`ON DELETE CASCADE` 意外删除整棵子树、客户端已保存的深链 ID 失效。采用 tombstone 可保留上下文和回复关系。

但 tombstone 不等于永远保留个人信息：删除正文、媒体引用、搜索索引、通知摘要、缓存快照，以及过期的审计副本，应通过专门的删除策略和任务落地。

### 8.3 并发竞争必须定义提交顺序

两次请求：

~~~text
T1：用户回复 B
T2：审核员移除 B
~~~

不能让两者都在不加锁的旧快照中看到 `B.status='VISIBLE'`。**MVP 的简单强一致协议**：

- 回复事务：先对 `posts` 目标行 `FOR UPDATE`（兼顾准确 `comment_count`），再对父评论行 `FOR SHARE`，再插入子评论。
- 审核事务：同样先锁帖子行 `FOR UPDATE`，再锁目标评论行 `FOR UPDATE`，条件更新状态与可见计数。
- 谁先获得帖子锁，谁先完成业务状态检查；后者在锁取得后重读**当前**父评论状态。
- 所有写事务遵循「幂等键（若有）→ 帖子 → 评论 → 计数/Outbox」的稳定顺序，尽量避免死锁。

这样把正确性问题化为**单帖内的串行化竞争**，好理解也容易测试，但**热门帖子所有评论写入争同一 `posts` 行锁**。后续第 13 节给出去热点的方法。PostgreSQL 的 `FOR UPDATE/SHARE` 语义见 [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)。

---

## 9. 关键写入流程（Create / Reply / Edit / Delete）

### 9.1 创建/回复：一笔事务完成

~~~mermaid
sequenceDiagram
  participant U as User
  participant A as Hono / Gin API
  participant DB as PostgreSQL
  U->>A: POST /posts/P/comments + Idempotency-Key
  A->>DB: BEGIN + reserve idempotency key
  A->>DB: SELECT post P FOR UPDATE
  A->>DB: SELECT parent B FOR SHARE（若存在）
  DB-->>A: post/parent status + parent.depth
  A->>A: authorization + same post + depth <= 20
  A->>DB: INSERT comments (server-generated parent/depth)
  A->>DB: UPDATE posts.comment_count + 1
  A->>DB: INSERT outbox + save response + COMMIT
  DB-->>A: committed comment
  A-->>U: 201 / identical replay
~~~

服务器代码必须：

1. 认证身份并校验请求长度、XSS/渲染策略、限流与重复请求。
2. 预留幂等键；已有相同命令直接重放响应。
3. 查询并锁定帖子，检查帖子可见、社区权限、作者禁言等。**如果禁言记录可以并发创建，仅「查不到 ban 行」不构成锁定保证**；严格提交顺序需与社区模块共享固定的权限锁定对象/版本协议。
4. 若回复：锁父评论，验证 `post_id` 相同、`status='VISIBLE'`、`depth < 20`。根评论直接 `depth=0`。
5. 插入评论、维护准确可见计数、插入 Outbox 和幂等响应后提交。
6. 网络在 COMMIT 后中断时，客户端重试相同键，返回已保存结果，而不是生成新评论。

SQL 骨架（下面是**事务片段**，并非一条可在不知道业务参数时直接执行的完整存储过程）：

~~~sql
BEGIN;

-- 同一事务内先完成 idempotency key 预留。
-- INSERT INTO idempotency_requests(...) VALUES (...)
-- ON CONFLICT DO NOTHING RETURNING ...;
-- 已存在请求时必须检查 hash 并复用已存响应。

SELECT id, status, comment_count
FROM posts
WHERE id = $1
FOR UPDATE;

-- 根评论不执行这一查询。
SELECT id, post_id, depth, status
FROM comments
WHERE id = $2 AND post_id = $1
FOR SHARE;

-- 应用层验证状态、权限与最大深度，设 new_depth。
INSERT INTO comments(post_id, author_id, parent_id, body, depth)
VALUES ($1, $3, $2, $4, $5)
RETURNING id, post_id, parent_id, depth, status, created_at;

UPDATE posts
SET comment_count = comment_count + 1,
    updated_at = now()
WHERE id = $1;

-- INSERT INTO outbox_events(...)
-- UPDATE idempotency_requests SET response_body = ...
COMMIT;
~~~

**注意**：`$2` 表示父评论 ID，根评论应传 SQL NULL；`$5` 是服务端计算值，不信任前端。示例省略了权限查询/幂等 SQL 的实际参数。生产代码必须把每个 SQL 放到同一个连接/事务里，错误则 `ROLLBACK`。

### 9.2 编辑：乐观并发控制

- 仅作者可编辑 `VISIBLE` 评论；审核/删除后应拒绝正常编辑。
- 编辑**不**修改 `parent_id`、`post_id`、`depth`、`created_at`。
- 使用可选 `version` 字段防止两个设备的最后写入静默覆盖前一次编辑。

~~~sql
UPDATE comments
SET body = $3,
    version = version + 1,
    updated_at = now()
WHERE id = $1 AND author_id = $2
  AND status = 'VISIBLE' AND version = $4
RETURNING id, version, updated_at;
~~~

没有返回行需区分不存在、无权、状态变化、版本冲突；不能一律解释为 500。编辑历史/恢复能力（若需要）建议单独受限存储，严禁将被删除的正文通过历史接口泄漏。

### 9.3 作者删除 / 审核移除

删除事务同样按 `post → comment` 顺序加锁，仅在状态真实发生 `VISIBLE → DELETED` 时将 `posts.comment_count - 1`；重复 DELETE 应返回成功但不重复减一。

~~~sql
-- 前置：已锁住帖子行、完成鉴权，且目标评论属于该帖。
UPDATE comments
SET status = 'DELETED', body = '[deleted]', updated_at = now()
WHERE id = $1 AND post_id = $2
  AND author_id = $3
  AND status IN ('VISIBLE', 'REMOVED')
RETURNING id, status;
~~~

上面语句展示**状态写入候选**，服务层仍需保留修改前的状态：

- old=VISIBLE → DELETED：可见数 -1。
- old=REMOVED → DELETED：可见数不变。
- old=DELETED：无操作，不能重复减。
- 审核 `VISIBLE → REMOVED`：-1；合法 `REMOVED → VISIBLE` 恢复：+1；所有状态转移同事务写 Outbox。
- 管理员不得通过恢复已经 `DELETED` 的正文破坏用户删除意图。

生产应优先使用 `UPDATE ... RETURNING old/new` 的明确协议或先锁行再根据 old 状态更新，并在**同一事务**更新计数。不能用 `UPDATE ... RETURNING status` 得到新状态后假装知道旧状态。这里的 SQL 只是条件更新片段。

### 9.4 为什么不建议初版开放移动评论？

修改 `parent_id` 看起来只是一条 UPDATE，实际上会改变整棵子树的 `depth`，并可能引入**环**或破坏某个帖子的上下文。MVP 直接禁止。第 11.5 节给出如果业务确实需要移动，怎样设计安全事务。

---

## 10. 评论树读取、排序与分页（最重要的读路径）

### 10.1 根评论：Keyset Pagination

~~~sql
-- $1 = post_id
-- $2/$3 = 上页最后一条的 (created_at,id)，首屏均传 NULL
-- $4 = 实际 pageSize + 1，最大值由 API 限制
SELECT id, post_id, parent_id, depth, status, created_at,
       CASE WHEN status = 'VISIBLE' THEN author_id ELSE NULL END AS author_id,
       CASE WHEN status = 'VISIBLE' THEN body ELSE NULL END AS body
FROM comments
WHERE post_id = $1
  AND parent_id IS NULL
  AND ($2::timestamptz IS NULL
       OR (created_at, id) < ($2::timestamptz, $3::uuid))
ORDER BY created_at DESC, id DESC
LIMIT $4;
~~~

若 pageSize=20，查询最多取 21 条。返回前 20 条，若还有第 21 条则 `hasMore=true`，游标取**第 20 条**。无论用户翻到多少页，都不需要 `OFFSET 100000` 逐段跳过旧记录。

### 10.2 直接回复：独立游标、独立排序

~~~sql
-- $1 = post_id，$2 = parent_id
-- $3/$4 = 上页最后一条 (created_at,id)
-- $5 = pageSize + 1
SELECT id, post_id, parent_id, depth, status, created_at,
       CASE WHEN status = 'VISIBLE' THEN author_id ELSE NULL END AS author_id,
       CASE WHEN status = 'VISIBLE' THEN body ELSE NULL END AS body
FROM comments
WHERE post_id = $1
  AND parent_id = $2
  AND ($3::timestamptz IS NULL
       OR (created_at, id) > ($3::timestamptz, $4::uuid))
ORDER BY created_at ASC, id ASC
LIMIT $5;
~~~

对父 ID 要先确定所属帖子与访问权限。不能通过 URL 伪造另一个 `postId`，也不能省略帖子权限检查。

**为什么正序和倒序的游标方向相反？** 根评论从新到旧，下一页要取更小的 `(created_at,id)`；直接回复从旧到新，下一页要取更大的元组。元组比较让时间戳相同也有确定的 ID 次序。

### 10.3 为什么不一次 `JOIN` 拉出 10 万条？

- 直接返回整树会使请求时延、内存与前端 DOM 不可控。
- `JOIN comments children` 容易把根节点和子节点笛卡尔式扩展成重复数据。
- 一次查询根列表再为每个根单独查子节点，会产生 **N+1 查询问题**。
- 尤其对于「加载更多回复」，用户通常只需要**一条父节点的一小页**，而不是整棵树。

更好的前端数据结构：

~~~text
entities: Map<CommentId, Comment>
rootPages[postId]: { ids[], nextCursor }
replyPages[parentId]: { ids[], nextCursor, hasMore }
expanded: Set<CommentId>
~~~

客户端只是一个例子；服务端应返回平坦节点加 `parentId`，不要求数据库把任意深度树递归构造成巨型 JSON。

### 10.4 多个父节点的首屏子评论：批量避免 N+1

页面需要同时展开几十个父节点时，采用批量 `LATERAL` 查询而非 50 次单独往返：

~~~sql
-- $1 为已验证属于帖子、对用户可见的父 ID 数组（数量有上限）
-- $2 为 post_id，$3 为每个父节点需要的条数
WITH parent_ids AS (
  SELECT unnest($1::uuid[]) AS id
)
SELECT p.id AS requested_parent_id,
       c.id, c.parent_id, c.created_at, c.status,
       CASE WHEN c.status = 'VISIBLE' THEN c.body ELSE NULL END AS body
FROM parent_ids p
CROSS JOIN LATERAL (
  SELECT id, parent_id, created_at, status, body
  FROM comments
  WHERE post_id = $2 AND parent_id = p.id
  ORDER BY created_at ASC, id ASC
  LIMIT $3
) c
ORDER BY p.id, c.created_at ASC, c.id ASC;
~~~

这是**每父节点首页批量查询**；不同父节点的「下一页」游标彼此独立，不应试图用一个全局游标替代所有子列表。生产实现可用单语句带 per-parent 游标的 `VALUES / jsonb_to_recordset`，但要限制父节点数量和查询成本。父列表去重与权限检查不可省略。

### 10.5 递归 CTE：找到某个节点的祖先链

~~~sql
-- $1 = post_id, $2 = current comment_id
WITH RECURSIVE ancestors AS (
  SELECT id, parent_id, post_id, depth, status,
         ARRAY[id]::uuid[] AS seen
  FROM comments
  WHERE post_id = $1 AND id = $2

  UNION ALL

  SELECT p.id, p.parent_id, p.post_id, p.depth, p.status,
         a.seen || p.id
  FROM comments p
  JOIN ancestors a
    ON p.id = a.parent_id AND p.post_id = a.post_id
  WHERE NOT p.id = ANY(a.seen)
)
SELECT id, parent_id, depth, status
FROM ancestors
ORDER BY depth ASC;
~~~

返回路径为**根 → 当前评论**，不会因为某个祖先是 tombstone 就丢失结构。`seen` 用于防御已损坏数据造成循环；正常 MVP 因 parent 不可变而不应产生环。读前仍须验证帖子可访问，返回正文时按状态遮罩。

### 10.6 递归 CTE：导出某条评论的子树

~~~sql
-- $1 = post_id, $2 = subtree_root_id
WITH RECURSIVE subtree AS (
  SELECT id, parent_id, depth, ARRAY[id]::uuid[] AS seen
  FROM comments
  WHERE post_id = $1 AND id = $2

  UNION ALL

  SELECT c.id, c.parent_id, c.depth, s.seen || c.id
  FROM comments c
  JOIN subtree s ON c.parent_id = s.id
  WHERE c.post_id = $1 AND NOT c.id = ANY(s.seen)
)
SELECT id, parent_id, depth
FROM subtree
ORDER BY seen;
~~~

`ORDER BY seen` 按 UUID 路径给出**确定的结构性顺序**，**不是**按每层评论 `created_at` 排序的 UI 结果。要做按时间排序的层级展示，应携带每层排序键或由应用组织已有节点。

**禁止把「外层加 LIMIT 500」理解成必然只访问 500 个节点**：递归 CTE 的外层排序、聚合可能仍消费完整结果。应为导出设置独立限额、查询超时、预算与异步任务；在线 UI 优先按层分页。PostgreSQL 文档也明确警告了这个陷阱。[PostgreSQL Recursive Queries](https://www.postgresql.org/docs/current/queries-with.html)

### 10.7 Pagination 不是 Snapshot

Keyset 保证一个固定排序下相对稳定地继续向前，但**不是跨多次 HTTP 请求的数据库快照**：

- 根评论后续新发的内容通常位于前面，不会自动加入当前已经向旧内容翻页的会话。
- 子回复正序分页时，新追加的回复可以出现在后续页。
- 评论被删除后保留位置，但正文会变成 tombstone。
- 需要严格全程不变的「导出快照」时，应单独建立导出任务或有限期的版本化结果，不应该跨 HTTP 请求持有长事务/长时间数据库快照。

---

## 11. 高级模型：Materialized Path、Closure Table、Nested Set 与移动子树

### 11.1 Materialized Path（物化路径）

用路径标识祖先链：

~~~text
A              path = a
  B            path = a.b
    D          path = a.b.d
  C            path = a.c
E              path = e
~~~

PostgreSQL 可启用 `ltree`：

~~~sql
CREATE EXTENSION IF NOT EXISTS ltree;

-- 以下仅是可选模型迁移草案，不要和第 6 节的基线重复执行。
ALTER TABLE comments ADD COLUMN path ltree;
CREATE INDEX comments_path_gist_idx
  ON comments USING GIST (path);

-- UUID 示例：编码为去掉横线的十六进制标签
-- root.path = replace(root.id::text, '-', '')::ltree
-- child.path = parent.path || replace(child.id::text, '-', '')::ltree

-- 已知父节点 path 的情况下查它及所有后代：
SELECT id, depth, status
FROM comments
WHERE post_id = $1 AND path <@ $2::ltree;
~~~

`<@` 包含「自己」；如果只要真正后代，还应排除路径相等或目标节点本身。`ltree` GiST 索引能加速祖先/后代操作，但 GiST 可能进行 lossy recheck。路径是**层级关系**，不会自动表达创建时间或投票分数。[PostgreSQL ltree](https://www.postgresql.org/docs/current/ltree.html)

**需要格外注意**：

- 写入时必须在**同一事务**读取父路径、构造子路径并存储，不能信任客户端路径。
- 如果开启移动子树，原有所有后代路径都需批量改写。
- 若仍保留 `parent_id`，则路径与邻接关系是两份事实/投影，需要同步校验与修复。
- 迁移需要回填、校验、索引、切流；直接加一个 `path` 列并不能自动填充旧数据。
- 增加 `path` 不是无代价优化：它增加每条记录的长度及写入/更新成本。

### 11.2 Closure Table（闭包表）

把所有「祖先 → 后代」关系显式保存。例如 A→B→D：

~~~text
ancestor | descendant | distance
A        | A          | 0
A        | B          | 1
A        | D          | 2
B        | B          | 0
B        | D          | 1
D        | D          | 0
~~~

DDL（**可选模型**，依赖现有 `comments`）：

~~~sql
CREATE TABLE comment_closure (
  post_id uuid NOT NULL,
  ancestor_id uuid NOT NULL,
  descendant_id uuid NOT NULL,
  distance integer NOT NULL CHECK (distance BETWEEN 0 AND 20),
  PRIMARY KEY (post_id, ancestor_id, descendant_id),
  FOREIGN KEY (post_id, ancestor_id) REFERENCES comments(post_id, id),
  FOREIGN KEY (post_id, descendant_id) REFERENCES comments(post_id, id)
);
CREATE INDEX comment_closure_descendant_idx
  ON comment_closure(post_id, descendant_id, distance);
~~~

新插入评论 C，父评论为 B（同一事务中先插入 `comments` C），需从 B 的所有祖先生成继承关系，并加自身：

~~~sql
INSERT INTO comment_closure(post_id, ancestor_id, descendant_id, distance)
SELECT post_id, ancestor_id, $3::uuid, distance + 1
FROM comment_closure
WHERE post_id = $1 AND descendant_id = $2

UNION ALL
SELECT $1::uuid, $3::uuid, $3::uuid, 0;
-- $1: post_id, $2: parent_id, $3: 新评论 id
-- 对根评论：仅插入 (post_id, new_id, new_id, 0)，不执行父分支。
~~~

好处是查询所有祖先/后代不用递归：

~~~sql
SELECT c.id, c.depth, c.status
FROM comment_closure cc
JOIN comments c
  ON c.post_id = cc.post_id AND c.id = cc.descendant_id
WHERE cc.post_id = $1 AND cc.ancestor_id = $2
ORDER BY cc.distance ASC, c.created_at ASC, c.id ASC;
~~~

缺点：每插入一个节点要写入它的所有祖先关系，越深写放大越大；深链若**不限制深度**可能接近 O(N²) 关系数量。本文限制 20 层时，单节点闭包行最多约 21 条，但仍比邻接表显著多。移动子树时要计算并维护跨祖先关系，事务更复杂。

### 11.3 Nested Set（嵌套集合）

示例：

~~~text
A [1,8]
  B [2,5]
    D [3,4]
  C [6,7]
E [9,10]
~~~

节点 A 的后代在其左右端点区间内；一旦在 B 下插入新回复，可能要移动大量节点的 `lft/rgt`，并发写入代价很高。它适合变化很少的目录/分类树，不适合作为高频评论回复系统的默认模型。

### 11.4 决策表：按问题而非按流行程度选型

| 如果主要问题是… | 优先方案 | 为什么 |
| --- | --- | --- |
| 取某帖根评论、展开某条的 20 个直接回复 | 邻接表 + B-tree + Keyset | 简洁、强约束、写入便宜 |
| 偶尔查询祖先链/一小棵子树 | 邻接表 + Recursive CTE | 无需增加另一份关系数据 |
| 大量重复的任意子树/祖先查询 | 评估 `ltree` 或 Closure | 减少重复递归，付出写放大 |
| 静态分类树/只读文档目录 | Nested Set 可评估 | 更适合读多写少 |
| 「根评论 Hot」排序不断变化 | 独立版本化排名读模型 | 树关系模型不能解决动态排名 |
| 经常移动超大子树 | 重新审视产品需求和迁移任务 | 不应靠一条 `UPDATE parent_id` 解决 |

### 11.5 若一定要支持 Move Subtree，如何保证不成环？

**这是 P2，不属于 MVP**。对邻接表允许在**同一个帖子内**将节点 X 挪到新父节点 Y：

1. **先锁定该帖 `posts` 行 `FOR UPDATE`**；创建/删评/其他移动操作也必须遵循同一个帖子锁。此协议阻止遍历期间新的子节点插入或另一笔移动改变结构。
2. 验证 X/Y 属于同一帖子，X 不是根节点限制（如产品不允许），且 Y 不在 X 的整棵子树里；特别禁止 X=Y。
3. 用 Recursive CTE 收集 X 的所有后代与最大 `depth`；计算 `delta = newParent.depth + 1 - X.depth`，验证每个节点的新深度 ≤20。
4. 在一笔事务内同时更新 X 的 `parent_id` 和整棵子树所有 `depth`；维护相关计数（如直接回复数）、审计与 Outbox，再提交。
5. 如果同时使用 `ltree` 或 Closure Table，必须**同事务**同步重建相应路径/闭包关系，不能让两种模型短暂相互矛盾后暴露给读请求。

~~~sql
-- 已锁帖子并验证输入之后收集待移动子树
WITH RECURSIVE subtree AS (
  SELECT id, parent_id, depth, ARRAY[id]::uuid[] AS seen
  FROM comments WHERE post_id = $1 AND id = $2
  UNION ALL
  SELECT c.id, c.parent_id, c.depth, s.seen || c.id
  FROM comments c
  JOIN subtree s ON c.parent_id = s.id
  WHERE c.post_id = $1 AND NOT c.id = ANY(s.seen)
)
SELECT id, depth FROM subtree;
-- 检查 Y 不在返回的 id 集合中，计算最大 depth 和 delta。
-- 在同一事务更新 X.parent_id 与 subtree.depth 后提交。
~~~

**事务边界很关键**：如果创建评论不遵守帖级锁而移动操作遵守，就可能出现遍历后新插入的后代，导致漏更新。大子树迁移占锁时间长，可能需要封禁写入窗口或后台任务，而不是长时间占用普通 HTTP 请求连接。

---

## 12. 审核、删除、权限与内容生命周期

### 12.1 三种不同的「删除」

| 动作 | 关系节点 | 正文 | 后代 | 是否能恢复 |
| --- | --- | --- | --- | --- |
| 作者删除 | 保留 tombstone | 置 `[deleted]` / 依隐私策略清除 | **保留** | 默认不可 |
| 管理员移除 | 保留 tombstone | 普通 API 遮罩 | **保留**，另按规则治理 | 审核员有条件恢复 |
| 依法彻底擦除 | 关系按最小必要形式保留/重建 | 所有允许范围内的数据副本及派生索引清理 | 按法律/产品规则 | 通常不可 |

「删除父节点后让所有子节点 `parent_id=NULL`」会失去原始讨论结构，不是本设计默认方案。批量删树是另一种明确的产品操作，必须独立授权、审计和容量评估。

### 12.2 为什么不能只在缓存里删掉节点？

旧缓存可能仍包含正文或敏感信息；更糟的是另一实例、只读副本或搜索结果仍可被访问。对敏感/私有场景，读请求必须复核帖子权限与内容状态；必要时绕过滞后副本，或者使用一个强一致的可见性门闩/版本校验。

**不能先把原文塞入公开缓存，再期待 TTL 来保证删除立即生效。** 对严格删除 SLA 要提供缓存淘汰、搜索清除、事件重试和对账闭环。

### 12.3 审核权限与状态竞争

审核角色不能简单由客户端输入；必须在服务端依据社区成员关系校验。删除/恢复的条件 UPDATE 和评论数修改要在同一事务，写 Outbox 供通知与读模型失效使用。

最容易忽视的竞争是「审核移除」与「新回复」。第 8.3 节给出的 **post → parent** 锁顺序就是为了有可解释的提交结果：若回复先提交，移除只隐藏父节点但保留回复；若移除先提交，后来的新回复因父节点非 VISIBLE 而失败。

---

## 13. 计数、缓存、热点与异步消息

### 13.1 三类计数不要混为一谈

- `posts.comment_count`：本文是**当前可见**评论总数，根 + 子回复都算，删除/恢复调整。
- `comments.direct_reply_count`（可选）：某一评论的**直接可见孩子数**，不包括孙子。
- `descendant_count`（P2）：整棵子树下可见的后代总数；实时维护可能导致祖先链写放大。

**MVP 推荐**：只维护 `posts.comment_count`，列表取 `limit+1` 判断更多；等产品确实需要数量提示，再引入子计数投影。

### 13.2 帖子级行锁的热点

MVP 用 `posts FOR UPDATE` 保证评论总数精确且权限竞争有确定顺序，代价是**同一帖子写入串行化**。一个超级热门帖子每秒有几百条回复，锁等待可能成为瓶颈，而不是 PostgreSQL 处理普通行插入的能力不足。

**演进方案 A：主写入不再更新帖子计数（读模型最终一致）**：

1. 写入先锁帖子 `FOR SHARE`，再锁目标父节点 `FOR SHARE`；只插入 comments + Outbox，不更新 `posts.comment_count`。
2. `FOR SHARE` 对多个回复事务可共存，但与审核修改帖子/父节点的写锁冲突；审核/权限模块必须遵循同一协议。
3. Count Projector 消费 `comment_created / comment_visibility_changed`，通过 `processed_events(consumer_name,event_id)` 幂等后维护计数。
4. 带 `asOf / freshness` 表达计数滞后，并定期在有边界的数据库快照中对账。
5. **不可只把「帖子锁改成 FOR SHARE」而同时仍 UPDATE 帖子行**：共享锁升级为写锁可能导致并发死锁，也没有消除写热点。

**演进方案 B：分桶计数**：把热点帖的计数分为多个 `(post_id,bucket_id)` 聚合行，写入或投影按稳定分桶更新；读取时求和或异步汇总。它降低单行热点，但使读取、对账和排序更复杂。投票计数/热门排行同理适用「事实 + 可重建投影」。

### 13.3 Redis 缓存什么？

适合：高频根页/子页的 ID 列表、热门帖子只读评论摘要、短期 `hasMore`/计数投影、限流 token。**不适合**：把树结构和父子关系的唯一真实版本放在 Redis，或让缓存绕过已删除/私有内容的可见性检查。

常见 Cache-aside：

1. 读缓存命中 → 仍检查适用的权限/可见性版本 → 返回安全数据。
2. 缓存未命中 → 从数据库取有界页 → 缓存 **ID + 排序位置**，敏感正文按需求重新加载或严格控制版本。
3. 新评论/删除/审核 → 同事务写 Outbox → 缓存失效 worker。
4. 事件延迟期间：不能因为缓存还是旧列表就把已经被移除的正文再次公开。

分页缓存要绑定 `postId/parentId/sort/cursor`，热点列表不要把所有评论 ID 一次写进单个巨大 Key。引入 Redis 只会优化部分读路径，不会修复不合法的 parent 或幂等错误。

### 13.4 Outbox、Inbox 与至少一次投递

~~~mermaid
sequenceDiagram
  participant API as Comment API
  participant PG as PostgreSQL
  participant P as Outbox Publisher
  participant MQ as JetStream
  participant W as Notification/Count Worker
  API->>PG: BEGIN: comment + outbox + COMMIT
  PG-->>API: committed
  P->>PG: 领取未发布事件（可 SKIP LOCKED）
  P->>MQ: publish(eventId)
  MQ-->>P: publish ack
  P->>PG: 标记 published_at
  MQ->>W: deliver(eventId)
  W->>PG: processed_events 去重 + 应用投影（同事务）
  W-->>MQ: ack
~~~

**边界**：

- 如果 MQ 发布成功后、`published_at` 更新前进程崩溃，Publisher 会重发**同一个 eventId**。因此是至少一次，不是天生严格一次。
- Consumer 的 `processed_events` 去重与目标数据库投影必须同事务提交；先 ack 后落库会丢事件。
- 多 Publisher 读取 Outbox 时可以用 `FOR UPDATE SKIP LOCKED`，但应采用有界批量和短事务，不宜持锁跨网络发布。更完整的实现需 claim/lease 字段及超时恢复，或专用 CDC。
- 热榜和回复通知允许滞后；删除权限必须在读取时重新检查。
- NATS Core 是 at-most-once，JetStream 提供持久化与至少一次投递，不要把它们混淆。[NATS JetStream](https://docs.nats.io/concepts/jetstream) · [PostgreSQL SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html)

### 13.5 什么时候应考虑读副本？

当 PostgreSQL 主库读压力、索引页缓存或 IO 显著受限时再加。复制延迟意味着刚发的新评论从副本查询可能暂时不可见；可为**写后首屏**路由到主库、基于一致性令牌/LSN 选择副本，或明确显示刷新延迟。不能承诺「加副本就既可扩展又完全强一致」。

---

## 14. Node.js / TypeScript + Hono 工程方案

### 14.1 包选型：为什么、何时使用？

| 层 | 首选 | 原因 / 可替代 |
| --- | --- | --- |
| HTTP | `hono` + `@hono/node-server` | 轻量路由、中间件、TypeScript；沿用既有 Node 经验 |
| DTO 校验 | `zod` + `@hono/zod-validator` | Body / Query / Path 校验；业务权限仍需 Service 检查 |
| PostgreSQL | `pg`（node-postgres） | 连接池、参数化 SQL、单连接事务可控 |
| ORM / Query Builder | `drizzle-orm` + `drizzle-kit` | 简单 CRUD 和 schema；复杂递归 CTE 可保留原生 SQL |
| 缓存 | `ioredis` 或 `redis` | 读缓存、限流；MVP 可不安装 |
| MQ | `nats` | P1 JetStream 通知/计数 worker |
| 日志 / 追踪 | `pino` / OpenTelemetry | 结构化日志、trace 关联 |
| 测试 | `vitest` / `testcontainers` | 真 PostgreSQL 数据库约束与并发验证 |
| 契约 | OpenAPI + Zod schema | 与 Go 共用 REST 契约，不共享语言运行时实体 |

**推荐组合**：Hono + Zod + `pg`（核心事务/递归 SQL）+ 可选 Drizzle（普通 CRUD）。Drizzle 官方支持 PostgreSQL `pg` 与 postgres.js 驱动。**事务不能跨独立数据库连接**；如果同时用 Drizzle 和原生 SQL，必须确保同一事务使用同一个底层连接。[Hono Validation](https://hono.dev/docs/guides/validation) · [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)

### 14.2 目录组织：按领域组织，不把所有 Service 混在一起

~~~text
nested-comment/
  apps/
    api-hono/
      src/
        app.ts
        server.ts
        modules/
          comments/
            comments.routes.ts
            comments.schemas.ts
            comments.controller.ts
            comments.service.ts
            comments.repository.ts
            comments.types.ts
            comments.errors.ts
          posts/
            post-access.service.ts
          moderation/
            moderation.service.ts
          idempotency/
            idempotency.service.ts
        infrastructure/
          db/
            pool.ts
            transaction.ts
          auth/
          observability/
          cache/               # P1
          messaging/           # P1
      test/
        integration/
        concurrency/
  packages/
    contracts/                 # OpenAPI / 共享 DTO 契约
  db/
    migrations/                # 一套权威 PostgreSQL migration
    queries/
      comments.sql             # 递归/分页等可读 SQL
  docker-compose.yml
~~~

**关键点**：

- `Controller`：读取/校验 HTTP 输入、认证上下文、错误映射；不写复杂 SQL。
- `Service`：事务编排、授权、最大深度、状态机、幂等。
- `Repository`：参数化 SQL、索引友好查询、返回数据行；不擅自创建自己的事务。
- `Transaction`：由 Service 显式管理并向 Repository 传事务 client。
- `Contracts`：Node/Go 协同的标准是 API+事件，不是把某语言的内部实体结构拷贝过去。

### 14.3 Hono Handler → Service → Repository

~~~typescript
// 示意片段：展示职责，不是独立可执行应用。
const createSchema = z.object({
  parentId: z.string().uuid().nullable(),
  body: z.string().trim().min(1).max(10_000)
});

app.post(
  '/v1/posts/:postId/comments',
  authMiddleware,
  zValidator('json', createSchema),
  async (c) => {
    const actorId = c.get('userId');
    const input = c.req.valid('json');
    const postId = c.req.param('postId');
    const key = c.req.header('Idempotency-Key');
    const result = await commentsService.create({
      actorId, postId, ...input, idempotencyKey: key
    });
    return c.json(result, 201);
  }
);
~~~

Service 内通过同一个 `pg.PoolClient` 进行 `BEGIN / COMMIT / ROLLBACK`；不要在 `await` 之间让 Repository 随机切回连接池拿另一个连接。`zValidator` 只验证传入字段是否合法，不能代替「父评论是否属于该帖」的 DB 验证。

### 14.4 Node.js 特性与风险

- Event Loop 适合大量 IO 请求；数据库连接池是有界资源，不应创建无限并发 Promise。
- 递归树大量排序/组装或 HTML sanitize 可能带来 CPU 压力；限制每页节点、考虑 Worker Threads / 独立后台任务。
- 请求中断可传播 AbortSignal，但**不能**把 HTTP 取消当成已提交数据库事务撤销。取消/超时与提交结果需按幂等键查询确认。
- Redis/消息队列消费要有独立的 Worker 进程/部署单元，不能把长任务塞在请求处理函数里。

---

## 15. Go + Gin 工程方案

### 15.1 包选型与选择依据

| 层 | 首选 | 为什么 / 可替代 |
| --- | --- | --- |
| HTTP | `github.com/gin-gonic/gin` | 路由分组、中间件、JSON Binding |
| 输入校验 | Gin `ShouldBindJSON` + `go-playground/validator/v10` | 可自定义错误，不提前写入响应 |
| PostgreSQL | `github.com/jackc/pgx/v5/pgxpool` | 原生 PG 特性、连接池、事务 |
| SQL 生成 | `sqlc` + pgx/v5 | 保留 SQL 本身、生成类型安全 Go 调用 |
| ORM | `entgo.io/ent` / `gorm.io/gorm` | CRUD 可以评估；核心递归与事务仍推荐明确 SQL |
| 缓存 | `github.com/redis/go-redis/v9` | 读模型和限流，按需引入 |
| MQ | `github.com/nats-io/nats.go` | JetStream consumer / ack |
| 任务并发 | `context`、`errgroup`、`sync`、channel | 控制取消、并发和背压 |
| 测试 | `testing`、`testcontainers-go`、`go test -race` | 验证真实数据库并发和 Go data race |
| 观测 | `log/slog` + OpenTelemetry | 结构化日志与 trace |
| 迁移 / 契约 | golang-migrate / Atlas + OpenAPI | 统一 schema 和契约 |

**学习主线建议**：Gin + pgx + sqlc + 事务。尤其是 Recursive CTE、复杂索引和条件更新，自己理解 SQL 比只会调用 ORM 的 `Preload` 更重要。Gin 的 `ShouldBind` 系列支持将参数校验错误交给应用处理；sqlc 官方有 `pgx/v5` 指南。[Gin Binding](https://gin-gonic.com/en/docs/binding/binding-and-validation/) · [sqlc with pgx](https://docs.sqlc.dev/en/latest/guides/using-go-and-pgx.html)

### 15.2 推荐目录：模块化单体

~~~text
nested-comment-go/
  cmd/
    api/
      main.go
    worker/                    # P1 Outbox / notification / count
      main.go
  internal/
    app/
      bootstrap.go
    comments/
      handler.go               # Gin DTO / HTTP mapping
      service.go               # Transaction + invariants
      repository.go            # DB ports / implementations
      model.go
      errors.go
    posts/
      access.go
    moderation/
      service.go
    idempotency/
      service.go
    platform/
      postgres/
        pool.go
        tx.go
      auth/
      telemetry/
      redis/                   # P1
      events/                  # P1
  db/
    migrations/
    queries/
      comments.sql
    sqlc/
      generated/               # 机器生成，勿人工修改
  api/
    openapi.yaml
  test/
    integration/
    concurrency/
  compose.yaml
~~~

**不要过度分层**：起步可以把 `handler/service/repository` 放在同一个 `internal/comments` 包中；只有当依赖与团队职责明确时再拆多个包或微服务。避免 `utils`、`common` 变成没有业务边界的万能目录。

### 15.3 Gin Handler 只负责 HTTP

~~~go
// 示意片段：展示职责，依赖的 Service/DTO 类型省略。
type CreateCommentRequest struct {
    ParentID *string `json:"parentId"`
    Body     string  `json:"body" binding:"required,max=10000"`
}

func (h *Handler) Create(c *gin.Context) {
    var req CreateCommentRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid_input"})
        return
    }

    actorID := authenticatedUserID(c) // 由可信认证 middleware 提供
    result, err := h.service.Create(c.Request.Context(),
        actorID, c.Param("postId"), req.ParentID, req.Body,
        c.GetHeader("Idempotency-Key"))
    if err != nil {
        writeDomainError(c, err)
        return
    }
    c.JSON(http.StatusCreated, result)
}
~~~

需要注意：

- `ShouldBindJSON` 不是所有业务校验；父子同帖、深度、权限必须在 Service/DB 检查。
- `context.Context` 从 HTTP 一路传到 `pgx`，数据库超时要显式设置；不要滥用 `context.Background()`。
- `pgxpool.Pool` 是长生命周期复用资源；不要每请求创建一个新 pool。
- `pgx.Tx` 必须在事务生命周期内传给 Repository；不要写一个「在事务中却又从 pool 查父评论」的 Repository。

### 15.4 Go 并发模型怎么用到本题？

- **Goroutine 不是分布式锁**：多个进程仍需数据库事务和约束保护同一父节点。
- **Worker Pool + Channel** 可用于通知、缓存失效、批量预计算，设置并发上限，避免把 PostgreSQL 连接池打满。
- `errgroup` 可聚合有限并发的**独立只读**请求；同一 `pgx.Tx` 上不要随意启动多个 goroutine 并行执行 SQL。
- 请求取消、worker 关闭、超时要可控；消息消费者必须先持久化成功，再 ack。
- `go test -race` 检查 Go 进程内共享变量的数据竞争；它**不会**发现数据库层面的跨事务写偏差，后者需并发集成测试。

### 15.5 Node.js / Go 如何分工？

建议**先各自可独立实现相同契约**，而不是让两语言同时写入同一套评论树造成双实现逻辑漂移。可选协作方式：

1. 两份独立实现对照学习，使用相同 OpenAPI、迁移和数据库并发测试。
2. 若实际产品需要混合部署：例如 Hono 做 BFF、Gin 做 Comment Domain API；BFF 负责会话与前端聚合，Gin 独占 `comments` 写权限。
3. 异步边界通过有版本的事件 Envelope 通信；避免让两套应用各自发布不兼容的 `comment.created` 消息。

---

## 16. 模块职责、事务边界与协作

### 16.1 模块职责表

| 模块 | 职责 | 不该负责 |
| --- | --- | --- |
| Auth / Post Access | 登录用户、帖子访问、社区权限/禁言 | 评论树的 SQL 排序 |
| Comment Command | 新增/编辑/删除/恢复、深度、不变量、事务 | 在 Handler 内直接访问 Redis 当事实表 |
| Comment Query | 根/子节点分页、祖先链、可见性投影 | 改写业务状态 |
| Moderation | 审核权限与状态转换、审计 | 无条件清空后代 |
| Idempotency | 唯一键、请求哈希、响应重放 | 代替数据库的父子 FK |
| Event / Outbox | 可靠发布业务事件 | 宣称完全 exactly-once |
| Projection / Cache | 评论数、通知、热门列表 | 决定父评论是否真正存在 |
| Contracts | HTTP DTO、事件 schema、版本管理 | 共享 ORM 实体到所有服务 |

### 16.2 事务边界的几条硬规则

- **可用性检查 + 父节点检查 + 创建 + 幂等 + 计数 + Outbox** 需要一个可解释的事务协议。
- 数据库连接池不是事务：只有同一个连接和 Tx 对象中的操作才能共同提交/回滚。
- 不要在持有 `posts FOR UPDATE` 的事务里同步调用外部通知、LLM、文件上传等不确定延迟操作。
- 检查权限时必须考虑**权限变化竞争**；要求强提交顺序的策略，必须使授权检查与相应禁言/审核写操作共享锁或版本化条件。
- 跨语言读写同一张表，依赖的是相同的不变量与迁移版本，而不是两个语言各有一份未经验证的 Service 逻辑。

---

## 17. 观测指标、性能分析与容量演进

### 17.1 应重点监测哪些指标？

| 维度 | 指标 | 用来判断什么 |
| --- | --- | --- |
| 延迟 | root/replies API p50/p95/p99 | 分页和缓存是否有效 |
| 写入 | create/edit/delete latency | 事务是否被锁阻塞 |
| 数据库 | `posts` 行锁等待、deadlock、连接池等待 | 热点与锁顺序问题 |
| 读性能 | EXPLAIN buffers、慢 SQL、每页扫描行数 | 索引与 N+1 |
| 业务 | orphan/cross-post/depth mismatch 检查数 | 关系约束失效 |
| 一致性 | `posts.comment_count` vs 实际可见数差异 | 计数漂移 |
| 异步 | Outbox age、redelivery、consumer lag | 投影/通知滞后 |
| 安全 | 删除后原文可见的 API/缓存事件 | 内容泄漏风险 |

指标名可按团队 OpenTelemetry 规范落地，注意高基数标签：不要把 `commentId` 或 `postId` 作为每个 metrics time series 的无界标签。

### 17.2 三阶段演进路线

**阶段 A：MVP**

`Gin/Hono → PostgreSQL`。邻接表、同帖 FK、按层 keyset、帖级强一致计数、幂等、基础审核和真库测试。

**阶段 B：热门帖读压力**

先核查索引/SQL/连接池 → 批量展开回复避免 N+1 → 只读副本（接受延迟）→ 有界 Redis 列表缓存。不要直接拆 10 个服务。

**阶段 C：热门帖写压力、异步投影**

移除每次写的热点帖子计数更新 → 异步准确可重放计数投影/分桶 → Outbox + JetStream + Inbox → 更严格的状态可见性检查。仅当频繁整树查询成为瓶颈时，再压测 `ltree` 或 Closure Table。

**分库分片并非必选答案**：将评论按 `post_id` 分布可以获得较好的帖子聚合局部性，但全局 `comment_id` 直查、用户评论历史、热门帖单分片热点、跨分片权限/计数都会复杂化。应在单库垂直/水平优化和证据充分后再设计分片键。

---

## 18. 测试方案（先验证正确性）

### 18.1 单元测试：小而确定

- 根评论深度必须为 0；B 回复 A 深度为 1；超过 20 层拒绝。
- 空正文/超长正文/非法 UUID/非法 cursor 必须拒绝。
- 创建时拒绝跨帖父评论；拒绝向 REMOVED/DELETED 节点新增回复。
- 两种游标的比较方向、时间同值时的 `id` 次序正确。
- VISIBLE → REMOVED/DELETED/RESTORE 的计数差量只有一次。
- DTO 映射对 REMOVED/DELETED 不暴露原正文或作者字段。

### 18.2 PostgreSQL 真库集成/并发测试（关键）

| 场景 | 并发输入 | 必须验证 |
| --- | --- | --- |
| 重复提交 | 同 actor + key 同时 20 个 POST | 只插入 1 条评论，响应一致 |
| 幂等键冲突 | 同 key、不同 body | 1 个成功，其他 409，无重复 |
| 跨帖伪造 | 把 P2 评论设为 P1 的 parent | 复合 FK / Service 拒绝 |
| 删除 vs 回复 | 一笔删除 B、一笔回复 B | 明确锁顺序，提交结果符合状态 |
| 热帖计数 | 100 个并发新回复 | 可见计数增加恰好 100 |
| 重复删除 | 20 个并发 DELETE 同一评论 | 计数最多减 1 |
| 深度上限 | 在 depth=20 节点下回复 | 返回 422，未创建 |
| 游标翻页 | 同时间戳、边翻页边插入/删除 | 无相同节点重复，按已定义一致性语义 |
| 移动子树（P2） | 移动 + 新增子节点 | 不产生环、不漏更新深度 |
| 异步事件（P1） | 同 eventId 重发 / 乱序 | 不重复加减计数、可对账 |

**必须在真实 PostgreSQL 上验证**。SQLite 内存测试不能替代复合 FK、PG 锁冲突、`SKIP LOCKED`、`ltree`、事务隔离级别行为。

### 18.3 故障注入

- COMMIT 成功后故意断开 HTTP，使用同一幂等键重试。
- 数据库事务中间报错，确认无孤立评论、无遗留幂等行、无多余计数。
- Outbox 发布后但标记成功前强制退出，消费者对重复事件去重。
- Redis 全部清空，服务仍能从数据库读取正确评论树。
- 强制只读副本滞后，验证「刚发的新评论」的读己之写策略。
- 删除/审核事件延迟，验证缓存不暴露旧正文。

### 18.4 性能压测与查询计划

建议制造三组数据：

1. **宽树**：一个父节点 50,000 个直接回复；看 keyset / 索引性能。
2. **深树**：一条 21 层链（最后一级创建被拒）；看祖先链与边界。
3. **多分支热帖**：10 万评论分布在几千个父节点；看并发写锁与缓存。

记录 p95/p99、`EXPLAIN (ANALYZE, BUFFERS)`、Lock Wait、WAL、连接数、CPU、内存，分别在「有缓存/无缓存」「准确计数/异步投影」下对比，**不要只报最高 RPS**。

---

## 19. 建议实践交付（本题内，不是完整 System Design 学习计划）

| 阶段 | 要写什么 | 必须提交的证据 |
| --- | --- | --- |
| 1. Schema | PG migration、FK、索引、种子数据 | ER 图 + FK 失败测试 |
| 2. Root/Reply API | 创建、按层读取、Keyset cursor | OpenAPI + 分页边界测试 |
| 3. 状态与并发 | 编辑、删除、审核、幂等、准确计数 | 20 并发重复请求与删评竞态 |
| 4. 深链与导出 | 祖先链 / 有界子树查询 | Recursive CTE + EXPLAIN |
| 5. Go 主实现 | Gin + pgx/sqlc + 测试 | `go test -race` + 真 PG 集成测试 |
| 6. Node 对照 | Hono + Zod + PG | 同样契约/测试用例 |
| 7. 演进实验 | `ltree` 或 Closure Table、Outbox/计数（任选） | 写放大、读延迟和正确性对比报告 |

**完成标准**不是「代码跑起来了」，而是你能解释每个关键索引/约束、演示真实数据库并发测试，并指出何时需要离开 MVP。

---

## 20. 面试表达模板（30–45 分钟）

**0–5 分钟：需求澄清**：允许无限深吗？整树还是懒加载？删除保留孩子吗？排序可变吗？

**5–10 分钟：容量估算**：评论平均写 QPS、读取 QPS、热点帖子、极端宽树与深度上限。

**10–18 分钟：HLD**：客户端 → API → Comment Module → PostgreSQL；缓存/队列仅为扩容演进。

**18–28 分钟：LLD（重点）**：邻接表 `post_id/parent_id/depth`、复合 FK、根/子索引、keyset、递归 CTE。

**28–37 分钟：并发与删除（重点）**：post→parent 锁、深度验证、删除/回复竞态、幂等、tombstone、评论数。

**37–45 分钟：Trade-offs**：邻接表 vs `ltree` vs Closure vs Nested Set；热点计数解耦、读模型、压测与故障恢复。

### 高频追问与回答抓手

**Q1：为什么不直接把评论存成嵌套 JSON？**

因为并发新增、删除、单节点更新、按层索引、访问控制和分页会很难管理；关系数据应该有独立标识与约束。嵌套 JSON 适合作为**有界 API 响应**，不是默认的持久化真相。

**Q2：`parent_id` 一列就能保证是合法的树吗？**

不能。普通 FK 只保证父 ID 存在；复合 FK 才能直接保护同帖父子关系。无环、深度、状态和权限需要额外约束或事务协议。MVP 冻结 parent 且只向已存在节点加叶子，能简化无环证明。

**Q3：为什么不直接 `WITH RECURSIVE` 返回整个评论树？**

用户不需要每次加载整个树，热点帖的宽度可能极大；递归结果的排序、聚合、传输与前端渲染都会超预算。正常展示按层 Keyset，递归只用于祖先链/有界导出。

**Q4：删除父评论，下面的孩子呢？**

默认保留孩子，父节点变成 tombstone；新回复父节点被拒绝，已有后代仍显示。整树删除是另一项具有独立权限与合规要求的操作。

**Q5：两个请求同时回复一个父评论会不会错乱？**

都插入新的叶子，不需要争抢单独的「下一个序号」，由 `created_at + id` 稳定排序。MVP 为了准确帖级计数先串行化帖子行锁，热门时再分离计数投影，树关系仍由 PG 约束保证。

**Q6：为什么不一开始用 Closure Table？**

本题主要访问是「直接孩子 + 有界分页」。Closure 为任意祖先/后代查询支付额外写入和存储开销，未必值得。先测量真实查询，再决定是否增补它。

**Q7：加 Redis 能解决帖子行锁热点吗？**

不能。缓存优化读，而热点来自对 `posts.comment_count` 的同步写。要改写入协议与读模型，确保投影可重放、可幂等、可对账。

**Q8：用 Go/Gin 和 Node/Hono 有什么架构差别？**

领域不变量、SQL、索引、API 与事务语义**不变**；变化主要在 HTTP/中间件、DB 驱动、异步并发与错误处理。设计问题不能靠换语言解决。

---

## 21. 知识点学习清单

- [ ] 数据结构：Tree、DAG 与 Cycle；宽度 vs 深度；DFS/BFS。
- [ ] 四种树建模：Adjacency List、Materialized Path、Closure Table、Nested Set。
- [ ] PostgreSQL：自引用/复合 FK、`CHECK`、`UNIQUE`、Partial/Composite B-tree Index。
- [ ] `WITH RECURSIVE`、`SEARCH`、`CYCLE`、`ltree`、GiST、查询计划。
- [ ] Keyset Pagination、稳定排序、Cursor 签名、按父节点独立分页。
- [ ] 事务隔离、`FOR UPDATE`、`FOR SHARE`、锁顺序、死锁与行锁热点。
- [ ] Idempotency-Key、请求哈希、并发重复创建与提交后重试。
- [ ] Tombstone、审核、作者删除、隐私擦除与后代保留。
- [ ] 计数语义、同步计数、异步投影、对账、热点分桶。
- [ ] Cache-aside、缓存失效、读副本滞后与读己之写。
- [ ] Outbox/Inbox、至少一次投递、事件版本与重放。
- [ ] Hono / Zod、`pg` / Drizzle、Node Event Loop、Worker Threads。
- [ ] Gin / `ShouldBindJSON`、pgx、sqlc、Go context、goroutine、race detector。
- [ ] OpenAPI、模块化单体、测试金字塔、真 PG 并发测试、EXPLAIN。
- [ ] 能不用术语堆砌，在 5–10 分钟说明核心取舍。

---

## 22. 参考资料（优先官方原始来源）

> 以下参考资料用于核查 PostgreSQL / 框架 / MQ 的公开技术语义。本文的业务规则、表结构与扩容路线仍是教学设计，并不声称为任何特定平台的实际实现。

1. PostgreSQL — [WITH Queries / Recursive CTE / SEARCH / CYCLE](https://www.postgresql.org/docs/current/queries-with.html)：层级查询、排序与循环检测。
2. PostgreSQL — [ltree — Hierarchical Tree-like Data Type](https://www.postgresql.org/docs/current/ltree.html)：物化路径、`<@`/`@>`、GiST。
3. PostgreSQL — [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)：复合 FK、UNIQUE、CHECK 的边界。
4. PostgreSQL — [Indexes](https://www.postgresql.org/docs/current/indexes.html)、[Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)：按层分页索引。
5. PostgreSQL — [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)、[SELECT / SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html)、[Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)：行锁、事务与并发。
6. PostgreSQL — [EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html)：读路径与性能诊断。
7. Hono — [Node.js Adapter](https://hono.dev/docs/getting-started/nodejs)、[Validation](https://hono.dev/docs/guides/validation)、[Middleware](https://hono.dev/docs/guides/middleware)。
8. Drizzle — [PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)。
9. Gin — [Model Binding and Validation](https://gin-gonic.com/en/docs/binding/binding-and-validation/)、[Middleware](https://gin-gonic.com/en/docs/middleware/)。
10. sqlc — [Using Go and pgx](https://docs.sqlc.dev/en/latest/guides/using-go-and-pgx.html)；[pgx](https://github.com/jackc/pgx)。
11. Go — [context](https://pkg.go.dev/context)、[Data Race Detector](https://go.dev/doc/articles/race_detector)。
12. Redis — [Sorted Sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/)：按分数排序的读模型。
13. NATS — [JetStream](https://docs.nats.io/concepts/jetstream)：持久消息和至少一次投递。
14. 本系列 — [Design Reddit](../reddit/design.md)：评论系统与帖子、投票、社区权限的上层集成。
15. 本系列 — [Design Uber](../uber/design.md)：跨系统一致性、Outbox 与工程架构的对照练习。

---

## 23. 一页总结

**Nested Comment System 的三个核心问题**：

1. **树关系正确**：邻接表 + 同帖复合 FK + 创建时计算深度 + 冻结 parent + 合理事务锁顺序；不让跨帖引用、环与删除竞争破坏数据。
2. **树读取高效**：根和直接回复分别 Keyset Pagination、按需展开、批量查询防 N+1；递归 CTE 用于特定上下文/有界导出，而不是每次把整棵树拉给前端。
3. **删除与故障可解释**：保留 tombstone 和后代、敏感正文不回传、幂等请求与计数同事务、缓存/消息可失效重建、测试真实并发。

**最重要的架构选择**：针对「频繁写入 + 局部展开」的 Reddit-like 评论，**Adjacency List 往往比更复杂的树模型更合适**。如果访问模式转向「大量任意子树查询」，再用实际压测论证 `ltree` 或 Closure Table；不要把复杂技术本身当成系统设计的成绩单。
