# Design Reddit：社区、帖子、投票与信息流系统设计（System Design）

> **版本**：1.0 · 2026-10-28
>
> **定位**：系统设计面试 + 数据建模 + Node.js / Go 工程实践参考
>
> **技术主线**：PostgreSQL；Node.js + TypeScript + Hono；Go + Gin；按需引入 Redis / NATS JetStream / 对象存储 / 搜索引擎
>
> **边界声明**：本文设计的是 **Reddit-like 社区平台**，不是 Reddit 真实内部架构的复刻。Reddit 官方帮助文档用于核对产品概念；数据规模、SLO、数据库表、算法示例及技术选型均属于教学设计假设，不应当成 Reddit 实际使用的架构或推荐算法。

## 阅读路线

1. **业务与约束**：先定义社区、帖子、订阅、投票、评论、排序和权限边界。
2. **容量估算**：识别读多写少、热门帖子写热点、排序与首页聚合成本。
3. **高层架构（HLD）**：解释为什么从模块化单体 + PostgreSQL 起步。
4. **数据模型（LLD）**：重点理解投票唯一约束、计数事务和评论树关系。
5. **五条主链路**：发帖、投票、评论、社区信息流、订阅首页信息流。
6. **系统难点**：Hot/Top/New、游标一致性、热门内容、缓存失效与审核。
7. **工程落地**：TypeScript/Hono 与 Go/Gin 的包、目录、事务和协作契约。
8. **演进与面试**：消息队列、异步排序、指标、故障注入和练习里程碑。

**建议读法**：先读 1–8、13、16、20、23 节，把「投票如何不重计」「首页如何生成」「排序为什么不能靠一条 SQL 解决所有场景」讲清楚；再按第 14、15、18、19 节用 Go/Gin 实现并验证。Node/Hono 作为已有技术栈的对照；缓存、MQ、搜索、个性化推荐按真实瓶颈逐步引入。

---

## 1. 需求澄清（Requirements）

### 1.1 角色和核心链路

- **访客**：浏览公开社区、帖子与公开评论，使用默认排序。
- **注册用户**：加入/退出社区、发帖、评论、投票、查看自己的订阅信息流。
- **社区管理员（Moderator）**：按社区规则隐藏/移除内容、管理成员与禁言。
- **平台管理员**：全站风控、封禁、审计、内容安全策略。
- **系统后台**：更新帖子统计、计算排行榜、发送通知、维护搜索索引。

简化主链路：用户加入社区 → 作者发帖 → 读者看 New/Hot/Top → 读者投票或评论 → 统计与排序变化 → 订阅者在 Home Feed 看到内容。

### 1.2 功能需求（Functional Requirements）

| 优先级 | 功能 | 完成判定 |
| --- | --- | --- |
| P0 | 用户与社区 | 创建公开社区、查询、加入与退出；社区 slug 唯一 |
| P0 | 发帖与查看 | TEXT / LINK 两种帖子；只有符合权限的用户能发布；可读详情 |
| P0 | 投票 | 对同一帖子每用户最多一个当前投票：-1/0/+1；重试不重复计数 |
| P0 | 评论 | 一级与嵌套回复；树关系合法；可读取分页评论 |
| P0 | 社区信息流 | New、Top、简化版 Hot；按游标分页 |
| P0 | 订阅首页 | 汇集所加入社区的公开内容；基本去重、过滤、分页 |
| P0 | 审核与删除 | 已移除内容不能从缓存和首页继续对外展示；权限校验由服务端执行 |
| P1 | 评论投票、通知 | 与帖子投票同类设计；通知最终一致 |
| P1 | 搜索、媒体上传 | PostgreSQL FTS 基线；对象存储与 CDN |
| P2 | Best 个性化、Rising、多模态审核、广告 | 给出演进设计，不在 MVP 落地 |

**重要区分**：Reddit 官方描述的 Home/Popular、Hot/Top/New、Best 个性化并非同一概念。本文 MVP 中的 Home 默认是**已订阅社区的混合时间流**；Hot 为**自行定义的趋势分**；Best/Recommended 留到扩展阶段，不能把 Hot 简单称为 Reddit 实际推荐算法。参见 [Reddit 内容推荐说明](https://support.reddithelp.com/hc/en-us/articles/23511859482388-Reddit-s-Approach-to-Content-Recommendations) 与 [Home / Popular 帮助页](https://support.reddithelp.com/hc/en-us/articles/360043043552-What-s-the-difference-between-r-all-r-popular-news-and-my-home-feed)。

### 1.3 非功能需求（Non-functional Requirements）

以下为**练习目标**，需根据实际压测调整：

- 公开帖子/社区列表：缓存命中下 p95 < 200ms；数据库回退路径 p95 < 500ms。
- 发帖/投票/评论 API：p95 < 400ms（不含媒体上传和异步排序完成）。
- 数据正确性：一个用户对一个对象的当前投票唯一；删除/禁用权限不能被缓存绕过；评论不跨帖子挂接。
- 一致性：投票事实、订阅事实、审核状态要求数据库事务正确；分数缓存、Hot 排名、通知、搜索索引允许有界延迟。
- 可用性示例：核心读 API 月可用性 99.9%，核心写 API 独立监控；给出降级策略。
- 可扩展性：热门帖子不能导致所有写请求串行阻塞；订阅数量增长不应强迫对每个用户无限制写扩散。
- 安全：防刷票、垃圾信息、权限隔离、SSRF/恶意 URL、Markdown/XSS、频率限制、审计与隐私处理。

### 1.4 面试时先问什么？

1. 只设计社区帖子，还是包括个性化 Home Feed 与搜索？
2. 投票允许撤销和改票吗？显示的 score 是净票数还是某种隐藏分？
3. 评论最多允许几层？需要完整树还是按层加载？
4. Home 只包含已订阅社区吗？需要未订阅内容推荐吗？
5. 排序如何定义：New、Top（时间窗）、Hot，是否要求快照一致？
6. 社区是公开、私有还是审批加入？内容删除/审核多久生效？
7. 哪些数据需强一致，哪些可允许延迟数秒？

**本文默认**：只有公开社区；登录用户可以加入/退出；发帖评论需有权限且未被封禁；帖子有 TEXT/LINK 类型；帖子投票允许 +1、0、-1；评论允许父子关系但不修改 parent；MVP Home 以订阅社区内容合并排序；无复杂推荐模型。

---

## 2. 容量估算（Back-of-the-envelope Estimation）

> 以下是假设规模，**不代表 Reddit 真实数据**。峰值倍率是工作负载假设，不是统一经验常数。

| 指标 | 假设 / 算式 | 结果 |
| --- | --- | --- |
| 日活 | 2,000,000 DAU | 200 万 |
| 列表与详情请求 | 每活跃用户 25 次/日 | 5,000 万次/日 |
| 平均读 QPS | 50M / 86,400 | 约 579 |
| 峰值读 QPS | 平均 × 8 | 约 4,630 |
| 新帖 | 40 万/日 | 平均约 4.6/s，峰值 ×12 ≈ 56/s |
| 评论创建 | 500 万/日 | 平均约 58/s，峰值 ×10 ≈ 579/s |
| 投票操作 | 2,000 万/日 | 平均约 231/s，峰值 ×10 ≈ 2,315/s |
| 原始帖子内容 | 400K × 2KiB | 约 0.8GiB/日 |
| 原始评论内容 | 5M × 1KiB | 约 4.8GiB/日 |
| 原始投票动作 | 20M × 64B | 约 1.2GiB/日（不是当前投票表增长量） |

上述存储**不包括**索引、WAL、MVCC 膨胀、备份、副本、媒体、审计与出站网络；评论/投票字节数仅作数量级估算。投票是 upsert/delete，操作量不等于新增持久行数。

**关键洞察**：

- 读取放大来自首页聚合、热门列表、评论详情，以及每次列表请求中的权限检查。
- 写入热点不一定是全站总 QPS，而是**数万人同时给同一条帖子投票**造成的同一行计数更新竞争。
- 排序是**派生读模型**：New 可直接索引查询；Hot/Top 涉及持续变化的排序分与时间窗，不能简单依赖每次全表排序。
- 热门列表缓存有效，但「已移除帖子仍出现」属于**安全/权限错误**，不能当作普通延迟缓存小问题。

还需估算：社区数量和长尾分布、用户平均订阅数、热点帖子/社区峰值、评论树深度、搜索 QPS、CDN 命中率、缓存 key 数量、通知扇出量。

---

## 3. 核心设计结论（先给答案）

1. **PostgreSQL 是事实来源**：用户、社区、订阅、内容、当前投票和审核状态以 PostgreSQL 为准；缓存与排行榜可以重建。
2. **投票事实和计数必须区分**：`post_votes` 的唯一约束保证「一人一当前投票」；聚合分数是派生值。MVP 同事务维护计数；热点高时转成异步/分片聚合。
3. **New、Top、Hot 不共享一条查询策略**：New 用 B-tree + keyset；Top 用时间窗聚合/预计算；Hot 用版本化排名快照或短周期缓存。
4. **Home Feed 先 Fan-out on Read**：读时从已订阅社区合并候选；当用户规模和个性化需求增加，采用热点候选池、物化与混合 fan-out。
5. **评论树优先邻接表**：`comments(parent_id, post_id)` + 复合外键确保不能跨帖；循环、深度和移动限制由业务层维护。更深入的树模型另见 Nested Comment System 专题。
6. **消息队列不是事务替代品**：需要异步排序/通知/搜索时，采用 PostgreSQL Outbox → 可重试的 worker / JetStream；消费端幂等。
7. **从模块化单体开始**：优先按 `communities / posts / votes / comments / feeds / moderation` 分模块，不把一开始的练习做成十几个微服务。

---

## 4. 高层架构（High-Level Design）

### 4.1 MVP：模块化单体

~~~mermaid
flowchart TB
  C[Web / Mobile] --> CDN[CDN / WAF]
  CDN --> API[Hono 或 Gin API\\n模块化单体]
  API --> AUTH[Auth / Community]
  API --> POST[Posts / Votes / Comments]
  API --> FEED[Feed / Ranking]
  API --> MOD[Moderation]
  AUTH --> PG[(PostgreSQL)]
  POST --> PG
  FEED --> PG
  MOD --> PG
  FEED --> R[(可选 Redis 缓存)]
  API --> MEDIA[可选对象存储 / CDN]
  WORKER[周期排行 / Outbox worker] --> PG
  WORKER --> R
~~~

逻辑模块不等于独立进程；`WORKER` 初期可以是**独立可执行入口但同一代码仓库**，避免把长任务放进请求处理流程。图片上传可在媒体阶段引入，不阻塞核心学习。

### 4.2 增长期：事件驱动 + 读模型

~~~mermaid
flowchart LR
  APP[Clients] --> EDGE[CDN / Gateway]
  EDGE --> API[API / Auth]
  API --> WRITE[Post / Vote / Comment]
  API --> READ[Feed Read API]
  WRITE --> PG[(PostgreSQL\\n事实表 + Outbox)]
  PG --> PUB[Outbox Publisher]
  PUB --> BUS[(JetStream)]
  BUS --> RANK[Ranking Worker]
  BUS --> NOTI[Notification Worker]
  BUS --> SEARCH[Search Indexer]
  RANK --> R[(Redis ZSET / Ranked Snapshot)]
  READ --> R
  READ --> PG
  SEARCH --> IDX[(Search Index)]
  NOTI --> PUSH[Push / Email]
~~~

**权威写入始终通过 PostgreSQL 事务**；推荐和搜索是可延迟、可重建的读模型。只有当独立部署和消费隔离确有收益时才拆服务。Redis Sorted Set 自带按 score 有序的成员集合，适用于排行榜候选池，但并不自动提供跨页稳定快照。[Redis Sorted Sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/)

### 4.3 数据归属与一致性

| 数据 | 事实存储 | 一致性 / 恢复 |
| --- | --- | --- |
| 社区、用户、订阅与封禁 | PostgreSQL | 强一致检查；查询时再校验权限 |
| 帖子/评论内容和审核状态 | PostgreSQL | 已移除/私有权限不能被旧缓存覆盖 |
| 用户当前投票 | PostgreSQL | 强一致，幂等改票 |
| 投票净分及评论数 | MVP PostgreSQL 同事务；扩展后异步投影 | 可重建、定期对账 |
| New Feed | PostgreSQL 索引 | 近实时 |
| Hot/Top 排名 | PostgreSQL 排名快照 / Redis ZSET | 带生成版本与鲜度监控 |
| 搜索、通知 | 独立索引 / 事件消费者 | 最终一致、失败重试 |

---

## 5. 数据模型（PostgreSQL）

### 5.1 核心实体关系

~~~mermaid
erDiagram
  USERS ||--o{ COMMUNITY_MEMBERS : joins
  COMMUNITIES ||--o{ COMMUNITY_MEMBERS : has
  COMMUNITIES ||--o{ POSTS : contains
  USERS ||--o{ POSTS : authors
  POSTS ||--o{ POST_VOTES : receives
  USERS ||--o{ POST_VOTES : casts
  POSTS ||--o{ COMMENTS : contains
  USERS ||--o{ COMMENTS : authors
  COMMENTS ||--o{ COMMENTS : replies
  COMMENTS ||--o{ COMMENT_VOTES : receives
  USERS ||--o{ COMMENT_VOTES : casts
  POSTS ||--o{ OUTBOX_EVENTS : emits
~~~

- `users`：用户主体与账户状态。
- `communities`：社区 slug、公开状态与审核策略。
- `community_members`：订阅关系及可选社区角色。
- `community_bans`：禁止在特定社区发帖、评论、投票的用户。
- `posts`：标题、内容、所属社区、作者、状态和可重建的计数快照。
- `post_votes` / `comment_votes`：每人每对象最多一个当前票值。
- `comments`：同帖子内的邻接表树结构，`parent_id` 指向父评论。
- `outbox_events` / `processed_events`：异步处理、消费去重。
- `idempotency_requests`：创建型命令防重复。
- `feed_generations` / `ranked_feed_entries`：增长期的版本化排序读模型（非所有表都必须 MVP 一次上齐）。

### 5.2 代表性 DDL（教学基线）

> 以下 SQL 着重展示约束、索引和事务边界。实际工程还需迁移版本、身份系统、时间与软删策略、审计/滥用处理、恢复与运维配置。建议先在本地 PostgreSQL 执行 migration，再用集成测试验证。

~~~sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'PUBLIC'
    CHECK (visibility = 'PUBLIC'), -- 本题 MVP 不支持私有社区
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','RESTRICTED','BANNED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_members (
  community_id uuid NOT NULL REFERENCES communities(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'MEMBER'
    CHECK (role IN ('MEMBER','MODERATOR')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX members_by_user_idx
  ON community_members(user_id, community_id);

CREATE TABLE community_bans (
  community_id uuid NOT NULL REFERENCES communities(id),
  user_id uuid NOT NULL REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id),
  author_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('TEXT','LINK')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  body text,
  link_url text,
  status text NOT NULL DEFAULT 'VISIBLE'
    CHECK (status IN ('VISIBLE','REMOVED','DELETED')),
  upvotes bigint NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  downvotes bigint NOT NULL DEFAULT 0 CHECK (downvotes >= 0),
  comment_count bigint NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'TEXT' AND body IS NOT NULL AND link_url IS NULL)
    OR (kind = 'LINK' AND link_url IS NOT NULL AND body IS NULL)
  )
);
CREATE INDEX posts_community_new_idx
  ON posts(community_id, created_at DESC, id DESC)
  WHERE status = 'VISIBLE';
CREATE INDEX posts_global_new_idx
  ON posts(created_at DESC, id DESC)
  WHERE status = 'VISIBLE';
CREATE INDEX posts_by_author_idx
  ON posts(author_id, created_at DESC);

CREATE TABLE post_votes (
  user_id uuid NOT NULL REFERENCES users(id),
  post_id uuid NOT NULL REFERENCES posts(id),
  value smallint NOT NULL CHECK (value IN (-1,1)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX post_votes_by_post_idx ON post_votes(post_id);

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
  UNIQUE (post_id, id),
  FOREIGN KEY (post_id, parent_id) REFERENCES comments(post_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX comments_roots_idx
  ON comments(post_id, created_at DESC, id DESC)
  WHERE parent_id IS NULL;
CREATE INDEX comments_children_idx
  ON comments(post_id, parent_id, created_at ASC, id ASC);

CREATE TABLE comment_votes (
  user_id uuid NOT NULL REFERENCES users(id),
  comment_id uuid NOT NULL REFERENCES comments(id),
  value smallint NOT NULL CHECK (value IN (-1,1)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX comment_votes_by_comment_idx ON comment_votes(comment_id);

CREATE TABLE idempotency_requests (
  actor_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL,
  idem_key text NOT NULL,
  request_hash text NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, operation, idem_key)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending_idx
  ON outbox_events(created_at) WHERE published_at IS NULL;

CREATE TABLE processed_events (
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);
~~~

**注意 4 个关键边界**：

1. `PRIMARY KEY (user_id, post_id)` 约束的是「当前唯一票」，不是「每个人一生只能投一次」；撤销时删除这行，重新投票可再插入。
2. 复合外键 `FOREIGN KEY (post_id, parent_id)` 阻止把 A 帖子的评论作为 B 帖子的父节点；但**不会自动禁止多节点循环**。本题禁止修改 parent，插入时必须校验父节点、深度和帖子状态。
3. `post_votes` 的事实与 `posts.upvotes/downvotes` 是两种数据。必须用一个清晰的写入协议保持同步，或明确宣布计数是异步投影并提供对账。
4. 检查父评论、禁言、社区权限、用户状态是**业务不变量**，不能指望只有外键就能落实；与这些事实竞争的更新要使用事务/行锁或版本检查。

### 5.3 New 查询：稳定的 keyset pagination

~~~sql
-- 首页示例：基于用户订阅社区，按发帖时间倒序。
-- 首次请求 cursor_created_at / cursor_id 为空；下一页传上一页最后一行。
SELECT p.id, p.community_id, p.title, p.created_at
FROM posts p
JOIN communities c ON c.id = p.community_id
WHERE p.status = 'VISIBLE'
  AND c.status = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM community_members m
    WHERE m.user_id = $1 AND m.community_id = p.community_id
  )
  AND (
    $2::timestamptz IS NULL
    OR (p.created_at, p.id) < ($2::timestamptz, $3::uuid)
  )
ORDER BY p.created_at DESC, p.id DESC
LIMIT $4;
~~~

实际可先用社区 ID 列表/`EXISTS` + 组合索引；大订阅量要用 `EXPLAIN (ANALYZE, BUFFERS)` 核查查询计划，不能假定这个 SQL 在任意规模都快。游标必须做签名/验证，并限制 page size。

### 5.4 评论分页：只加载一层，避免无限递归

~~~sql
-- 首屏根评论
SELECT * FROM comments
WHERE post_id = $1 AND parent_id IS NULL
ORDER BY created_at DESC, id DESC LIMIT $2;

-- 点击「展开回复」才取下一层，使用上述 children 索引
SELECT * FROM comments
WHERE post_id = $1 AND parent_id = $2
ORDER BY created_at ASC, id ASC LIMIT $3;
~~~

按层分页通常比一次递归拉取整棵上万节点的树更适合用户界面。递归 CTE、物化路径（`ltree`）、Closure Table、移动子树和排序细节留给独立的 Nested Comment System 深挖。[PostgreSQL 递归 CTE](https://www.postgresql.org/docs/current/queries-with.html)。

---

## 6. API、事件协议与幂等

### 6.1 REST API 草案

| 方法 | 路径 | 核心语义 |
| --- | --- | --- |
| POST | `/v1/communities` | 创建社区（带 Idempotency-Key） |
| GET | `/v1/communities/:slug` | 社区信息与权限 |
| PUT | `/v1/communities/:id/membership` | 加入社区；重试幂等 |
| DELETE | `/v1/communities/:id/membership` | 退出社区；不存在也可视为成功 |
| POST | `/v1/communities/:id/posts` | 发帖（带 Idempotency-Key） |
| GET | `/v1/communities/:id/posts?sort=new|hot|top` | 社区信息流，限制 limit |
| GET | `/v1/posts/:id` | 帖子正文、可见性、计数、我的投票 |
| PUT | `/v1/posts/:id/vote` | 请求体：`{"value":-1|0|1}`；目标状态幂等 |
| GET | `/v1/posts/:id/comments` | 根评论分页 |
| POST | `/v1/posts/:id/comments` | 创建评论（parentId 可空） |
| GET | `/v1/comments/:id/replies` | 子评论分页 |
| PUT | `/v1/comments/:id/vote` | 评论投票，同帖子投票 |
| GET | `/v1/me/feed?sort=new|hot` | 已订阅社区首页 |
| POST | `/v1/moderation/posts/:id/remove` | 审核员移除，服务端鉴权 |
| GET | `/v1/search?q=...` | P1 搜索 |

**统一错误语义**：401 未登录、403 无权/禁言、404 不可见或不存在（依隐私策略统一外观）、409 冲突、422 请求校验失败、429 限流。服务端永远从认证上下文读取 `userId`，不接受客户端伪造作者或票数。

### 6.2 幂等与请求语义

- **创建帖子/评论**：客户端生成稳定 `Idempotency-Key`，相同主体+操作+键+请求哈希返回原结果；不同请求复用键返回 409。
- **投票**：使用 PUT 声明**目标最终状态**，`value = 1/-1/0`，重复同样请求没有新增效果；但网络超时后重试可能与用户后续改票交错。需要严格「旧请求不覆盖新请求」时额外携带投票版本或客户端操作序号，或在 UI 禁用并发写。
- **创建命令事务**：一笔数据库事务写业务对象、Outbox 和幂等响应。不要在事务提交前调用外部 broker。
- **时间边界**：幂等键 TTL 是明确的 API 契约；到期重试已不保证去重，创建请求可带客户端生成且有唯一约束的资源 ID 增强长期去重。

### 6.3 代表性响应

~~~json
{
  "id": "post-uuid",
  "communityId": "community-uuid",
  "title": "How to design a feed?",
  "score": 42,
  "upvotes": 48,
  "downvotes": 6,
  "commentCount": 17,
  "viewerVote": 1,
  "rankingFreshness": "2026-10-28T12:00:00Z"
}
~~~

`score = upvotes - downvotes` 是本文示例；现实社区可能做票数模糊化或使用不同展示规则，不能把此 DTO 等同 Reddit 真实协议。

### 6.4 事件 Envelope

~~~json
{
  "eventId": "uuid",
  "eventType": "post.vote_changed.v1",
  "aggregateType": "post",
  "aggregateId": "post-uuid",
  "aggregateVersion": 15,
  "occurredAt": "2026-10-28T12:00:00Z",
  "payload": { "postId": "post-uuid", "upDelta": 1, "downDelta": 0 }
}
~~~

事件 ID、版本、时间与 payload 在事务里固定，重试不能重新造「看似新事件」。增量事件重复执行会造成计数错误，消费端要么基于 `eventId` 去重，要么从事实表重算投影。

---

## 7. 发帖、投票与评论状态机

### 7.1 内容生命周期

~~~mermaid
stateDiagram-v2
  [*] --> VISIBLE: publish
  VISIBLE --> REMOVED: moderator removes
  VISIBLE --> DELETED: author deletes
  REMOVED --> VISIBLE: moderator restores
  REMOVED --> DELETED: author deletes
  DELETED --> [*]
~~~

- `VISIBLE`：在满足社区/用户权限时对外展示。
- `REMOVED`：审核移除，保留最小审计记录和恢复可能。
- `DELETED`：按产品策略保留 tombstone 与关系、移除正文；实际物理清除按隐私/合规流程处理。
- 被删除评论有回复时保留占位节点可维持树结构，但不再返回原正文。
- 恢复动作必须有 moderator 权限及审计，不能让作者自行恢复违规内容。

### 7.2 投票目标状态

~~~text
old = -1, 0, +1
new = -1, 0, +1
delta = new - old

0 -> +1 : upvotes +1
+1 -> 0 : upvotes -1
+1 -> -1: upvotes -1, downvotes +1
-1 -> +1: downvotes -1, upvotes +1
同值重试: 计数不变
~~~

对于帖子更稳妥的接口是绝对目标状态而非「点赞次数 +1」。对评论投票使用相同抽象但不同事实表。`score` 从两个计数推导，不能允许客户端任意上传新的 score。

---

## 8. 关键流程详细设计（最重要的面试点）

### 8.1 创建帖子

1. HTTP 校验标题、类型、body/url、长度和 Idempotency-Key。
2. 认证并校验用户没有被平台封禁。
3. 在事务中确认社区仍有效、作者可发布且未被禁言；必要时锁住社区/封禁状态对应行，或采用可串行化策略与冲突重试。
4. 写 `posts`，同事务写 `outbox_events` 和幂等响应。
5. 提交后返回 postId；缓存无效化、搜索索引、通知从事件异步推进。
6. New 流直接查询数据库，不能因为排名 worker 未运行就「刚发帖却永远看不见」。

权限与封禁竞争必须定义顺序：如果后台在发帖事务提交后封禁作者，旧帖子是否全部隐藏是**独立产品规则**，不要默认以「封禁=永久删除历史内容」。

### 8.2 投票：MVP 强一致事务（可验证的正确性基线）

先在 PostgreSQL 内实现一个易证明的协议：

1. 开启事务；按 postId 锁目标 `posts` 行（`SELECT ... FOR UPDATE`）。
2. 再检查内容可见、社区状态和用户是否有投票权限。涉及并发禁言/审核时，需与审核流程遵循一致的锁顺序/版本门槛。
3. 读 `post_votes(user_id, post_id)` 的旧值，不存在视为 0。
4. 计算 `upDelta = (new==1) - (old==1)`、`downDelta = (new==-1) - (old==-1)`。
5. 对 0 执行 DELETE，对 ±1 执行 INSERT ... ON CONFLICT DO UPDATE；保持唯一约束。
6. 同事务更新 `posts.upvotes/downvotes/version`，写 Outbox，再提交。
7. 返回**数据库权威计数与 viewerVote**；重复目标值的变更 delta 为 0。

~~~sql
-- 示意：BEGIN 和先锁帖子后的写步骤；不是单条完整投票存储过程
BEGIN;
SELECT id, status, upvotes, downvotes, version
  FROM posts WHERE id = $1 FOR UPDATE;
-- 事务中校验权限并读取旧票（服务层计算 up_delta / down_delta）
SELECT value FROM post_votes WHERE user_id = $2 AND post_id = $1;
-- new=0: DELETE FROM post_votes WHERE user_id=$2 AND post_id=$1;
-- new=1/-1:
INSERT INTO post_votes(user_id, post_id, value)
VALUES ($2,$1,$3)
ON CONFLICT (user_id,post_id)
DO UPDATE SET value=EXCLUDED.value,updated_at=now();
UPDATE posts
SET upvotes = upvotes + $4,
    downvotes = downvotes + $5,
    version = version + 1,
    updated_at = now()
WHERE id = $1
RETURNING upvotes, downvotes, version;
-- INSERT outbox_events(...);
COMMIT;
~~~

**此 SQL 分支必须由业务代码选择**，`$3` 不可为 0（表的 CHECK 仅允许 ±1）。服务端需要保证行锁、查旧值、写票、改计数处于**同一个连接同一个事务**。为防无操作时产生虚假事件，可在 old==new 时直接返回而不增长 version。

此方案通过锁帖子行，将同一帖子的投票按事务顺序串行化，容易推理但存在**热门帖子行锁热点**。是学习正确性的起点，不是高吞吐最终方案。

### 8.3 为什么仅使用 `INSERT ... ON CONFLICT` 还不够？

唯一键只能保证当前投票最多一行，**不能自动正确更新聚合计数**。例如两请求把旧值 +1 同时改成 -1，只写事实表很容易令两条事件都把 upvotes 减一、downvotes 加一。

可选解决方式：

- 初期：锁帖子行 → 查旧值 → 原子维护投票和计数。
- 扩容：投票事实行依旧唯一，改成**带版本的投票变化记录 / outbox 增量**，由按 postId 有序的聚合器/幂等消费者更新统计；须定义并发改票的 old/new 获取与顺序。
- 更高写入量：把计数拆成 **N 个 shard bucket**、追加事件后增量聚合、或周期从事实表对账；接受显示分数短暂延迟。

**不要**把「用 Redis INCR」当作事实表和计数表跨系统原子一致的答案。Redis 挂掉或重复消费会让聚合漂移，必须能重建和核对。

### 8.4 创建评论与父子关系

- 对顶层评论：`parent_id = NULL`、`depth = 0`。
- 对回复：同事务加载父评论并锁定必要状态，检查 `parent.post_id == postId`、父评论尚允许回复、`depth = parent.depth+1 <= 20`。
- 如果父评论已经被删除且不可回复，返回冲突；如果只是正文隐藏但允许继续讨论，要明确产品策略。
- 插入 comments，同事务维护 `posts.comment_count`、写 Outbox；MVP 可以锁帖子行，但与热门投票共享写热点。
- 评论数的定义要明确：**可见评论数**、未删除评论数还是所有曾经评论数？本文默认当前仍存在且可见的评论数；审核移除需要相应补偿/重新聚合，否则必须改成「累计评论数」语义。

**数据库只约束了跨帖和直接自引用**；循环和过深树在本题靠 parent 不变 + 插入检查维护。若允许编辑 parent 或合并帖子，必须专门设计迁移与防环事务。

### 8.5 社区 New 列表与订阅首页

~~~mermaid
sequenceDiagram
  participant U as User
  participant A as Feed API
  participant DB as PostgreSQL
  participant C as Redis / Snapshot
  U->>A: GET /me/feed?sort=new&cursor=...
  A->>DB: Load membership / authorization
  A->>DB: Read posts with keyset pagination
  DB-->>A: Candidates
  A->>A: Filter / hydrate / deduplicate
  A-->>U: Items + nextCursor
  Note over A,C: Hot 时优先查询版本化候选快照
~~~

从「用户订阅了 N 个社区」开始思考：

- **小 N、数据不大**：数据库 `EXISTS` / JOIN 查询即可。
- **中等 N，部分社区热门**：每社区近段时间候选池（Redis ZSET/PG 预计算），服务层合并、去重与过滤。
- **巨大 N / 个性化**：聚合服务做候选生成 → 权限/安全过滤 → 排名 → 多样性 → 曝光跟踪；把机器学习推荐视作独立 P2。

Fan-out on Write = 发帖时向粉丝 inbox 写扩散；Fan-out on Read = 读者打开首页时汇聚候选。对大社区用全量写扩散非常昂贵，实践中常采用**混合方案**：普通社区适当预计算，超大社区读时聚合。

---

## 9. 排序算法与排行榜（Hot / Top / New / Best）

### 9.1 区分产品语义

| 模式 | 本题简化定义 | 实现策略 |
| --- | --- | --- |
| New | 最新发布优先 | PostgreSQL `(created_at DESC,id DESC)` 索引 |
| Top | 指定时间窗内净分最高 | 候选时间过滤 + 排名快照，必要时计数投影 |
| Hot | 高互动且相对新鲜 | 自定义随时间衰减评分 + 定时物化 |
| Best / Recommended | 考虑用户历史、内容、安全、多样性 | 候选生成/过滤/预测/重排，非 MVP |

Reddit 官方对各种排序的产品描述可见 [Reddit 内容推荐方法](https://support.reddithelp.com/hc/en-us/articles/23511859482388-Reddit-s-Approach-to-Content-Recommendations)。本文示例 Hot 公式是**教学自定义公式**，不是声称 Reddit 当前线上公式。

### 9.2 Hot 教学评分公式

可先定义：

~~~text
net = upvotes - downvotes
age_hours = max(0, now - created_at) / 1 hour
hot_score = ln(1 + max(0, net)) - age_hours / 36
~~~

- 对数削弱超大票数的支配力。
- 年龄衰减使新内容有进入窗口的机会。
- `36` 是可调整的示例超参数；只用净票数不能代表真实内容质量。
- 生产时还需抑制作弊、冷启动、敏感内容、语言/地区、社区公平性等因素。
- 热分随时间变化，**不可用 PostgreSQL 依赖 now() 的生成列当作永久静态索引**；应计算并按刷新周期保存。

### 9.3 Top 时间窗易混淆之处

「Top last week」可能解释成：

A. **本周发布的帖子**按当前净票数排序；
B. **本周获得的投票**数量排序，无论帖子何时发布。

两者会产生不同结果。本文 MVP 选择 **A**，使用 `posts.created_at >= window_start` 的候选和截至当前的净分。若要 B，必须保存带时间戳的**投票变化事件历史/周期统计**；只有当前 `post_votes` 绝对状态不能重建「过去一周投过多少票」。一定要在面试中澄清。

### 9.4 排名缓存与稳定游标

错误设计：每次 `ORDER BY hot_score DESC OFFSET 10000`，或在动态 ZSET 上把「第 20 名」作为长期游标。结果会随投票变化，分页产生重复/遗漏，且大 OFFSET 代价高。

可采用**短周期版本化快照**：

~~~sql
CREATE TABLE feed_generations (
  feed_key text PRIMARY KEY,
  active_generation bigint NOT NULL,
  published_at timestamptz NOT NULL
);

CREATE TABLE ranked_feed_entries (
  feed_key text NOT NULL,
  generation bigint NOT NULL,
  rank_position integer NOT NULL CHECK (rank_position > 0),
  post_id uuid NOT NULL REFERENCES posts(id),
  rank_score double precision NOT NULL,
  PRIMARY KEY (feed_key, generation, rank_position),
  UNIQUE (feed_key, generation, post_id)
);
CREATE INDEX ranked_entries_post_idx ON ranked_feed_entries(post_id);
~~~

1. Ranking worker 先写完整的 `generation = G+1` 候选（例如每社区前 1000 条）。
2. 构建成功后**在事务中切换** `feed_generations.active_generation`；旧版本暂留给分页游标。
3. API 游标包含 `feedKey, generation, lastPosition, expiresAt`，做签名，按固定版本翻页。
4. 读取每页时仍需连接 `posts / communities / block/ban` 检查实时可见性；不可见项过滤后继续补取。
5. 过期 generation 返回明确的 `cursor_expired`，客户端从首页重新开始；不要默默退回新版本造成页重复。
6. Redis 可以缓存每个 generation 的 postId 序列，但 `ZSET` 本身的「有序」**不等于**页间不可变；同样应采用新 key 构建、原子指针切换、旧 key 延迟过期。

快照是成本换稳定性，别全站每秒为所有社区全量构建。先用周期和**活跃社区/热门候选的 Top K**，并设置保留期与空闲社区跳过策略。

---

## 10. 信息流缓存、热点与扇出

### 10.1 缓存什么、不缓存什么

| 缓存对象 | 示例 key | 策略 |
| --- | --- | --- |
| 公开帖子内容摘要 | `post:summary:<postId>` | TTL + 事件失效 + 读时权限校验 |
| 社区 New 候选 | `feed:community:<id>:new` | 短 TTL；读时可回 PostgreSQL |
| 社区 Hot 版本 | `feed:community:<id>:hot:<generation>` | 新版本构建、切指针、旧版保留 |
| 全站 Hot | `feed:global:hot:<generation>` | 与社区不同范围独立生成 |
| 用户订阅集合 | `member:communities:<userId>` | 短 TTL；加入/退出主动失效 |
| 用户当前投票 | 不建议直接作为公共帖子缓存字段 | 由私有查询/批量加载获得 |

**核心原则**：公共缓存不能包含来自单个用户的 `viewerVote` 或私人可见性；同一 post 对不同用户的权限不同。不要把带身份的响应无条件放进 CDN 公共缓存。

### 10.2 Cache-aside 与失效

- 读：先查缓存，没有则查 PostgreSQL，再写缓存。
- 写：先提交数据库事务，再通过事件失效/更新缓存。
- 失效事件可能丢失，故设置 TTL、定期重建和读时权限过滤。
- 「已审核移除」不能只等几秒 TTL：对外列表至少再验证权威可见性；涉及私有/封禁策略时应对受保护内容禁用不安全的公共缓存。
- 避免缓存穿透（不存在 ID）、击穿（热门 key 过期）、雪崩（所有 key 同时过期）：负缓存有界 TTL、请求合并、TTL jitter 和退避。

### 10.3 热门帖子写热点

同一帖子 10,000 次投票不一定让应用 CPU 忙，但每次都写同一 `posts` 行会形成长事务锁队列。

分阶段解法：

1. **正确性基线**：第 8.2 节同事务计数，压测先测 p99、锁等待、死锁。
2. **热点解耦**：投票事实保持 PostgreSQL 唯一；同事务记录单条投票状态变化和 Outbox，异步统计服务处理；展示计数允许延迟。
3. **进一步扩容**：按 `postId` 分区事件处理、分片计数器或批量累计；定期从 `post_votes` 对账，保证可恢复。
4. **不能忽略**：如果事实写也被用户对同一对象高频改票打爆，需要速率限制与去重，不能只调大连接池。

---

## 11. 审核、删除、搜索与媒体

### 11.1 内容安全/权限优先于推荐分数

- 校验作者是否被平台/社区限制。
- 内容移除后：社区 New、Hot、Home、搜索都不再展示正文；版本化旧排名允许含旧 postId，但读时过滤。
- 旧通知不能重新暴露删除正文；客户端详情读到 tombstone/404。
- 审核必须写审计（`actor, target, action, reason, occurred_at`），并校验恢复权限。
- 富文本 Markdown 渲染必须进行安全清理；外部链接要防钓鱼与恶意重定向；抓取链接预览防 SSRF（阻断内网地址、限制重定向与出站目标）。

### 11.2 搜索的演进

- MVP：PostgreSQL 全文搜索 `tsvector`、`tsquery`、GIN 索引；注意英语分词和中文分词需要不同配置/扩展。
- 中期：搜索读延迟、排序功能、相关性要求提高时，引入 Meilisearch / OpenSearch 等专用服务。
- 索引更新：Outbox → indexer；消费者按事件版本幂等处理、删除事件要能覆盖旧的创建/更新事件。
- 永远在**查询结果返回前二次校验可见性**；搜索服务不是授权真相来源。

[PostgreSQL Full Text Search](https://www.postgresql.org/docs/current/textsearch.html)。

### 11.3 媒体

用户申请上传 → 后端鉴权/签名短期上传 URL → 客户端直传对象存储 → 异步病毒扫描/尺寸与内容检测 → 服务端确认资源状态 → CDN 分发。不要让长时间大文件上传占满普通 API worker/数据库事务。

---

## 12. 消息队列、Outbox、Inbox、重试

### 12.1 为什么这里需要异步？

一次投票成功不应该同步等待 5 个下游：排名更新、通知、搜索刷新、分析埋点、反作弊。它们可能故障且吞吐差异很大。

MVP 可以只用 PostgreSQL `outbox_events` + polling worker；增长期再采用 NATS JetStream 或 Kafka。**不熟悉 MQ 时先掌握：生产者、主题/subject、消费者、持久化、ACK、重投、消费者组、积压、死信、顺序、幂等。**

### 12.2 Outbox 的事务语义

~~~mermaid
sequenceDiagram
  participant A as Vote API
  participant DB as PostgreSQL
  participant P as Publisher
  participant MQ as JetStream
  participant W as Ranking Worker
  A->>DB: BEGIN: vote + counters + outbox
  DB-->>A: COMMIT
  P->>DB: Read unpublished outbox
  P->>MQ: Publish eventId
  MQ-->>P: Ack
  P->>DB: Mark published
  MQ->>W: Deliver / redeliver
  W->>DB: INSERT processed_events + projection update
  W-->>MQ: Ack
~~~

- DB 提交后 publisher 宕机：恢复后继续发送。
- broker 收到事件但 DB 未标记 published：可能重发。
- worker 更新投影后、ACK 前宕机：可能重投；`processed_events(consumer_name,event_id)` 唯一键防重复处理。
- **Outbox 保证本地事实与「待发事件」同事务**，不保证跨 broker/消费者 exactly once。
- 多实例扫描可用 `FOR UPDATE SKIP LOCKED` 领取短任务；标记和网络发送不能在长事务里无期限持锁，需租约/状态、过期重领、失败重试与监控。
- 分数快照可以选择「收到更新标记为 dirty，周期全量重算」，降低对增量顺序的依赖。

NATS JetStream 支持持久消息、重放、ACK 和至少一次投递；Core NATS 的纯发布订阅不具有相同持久语义。[NATS JetStream](https://docs.nats.io/concepts/jetstream)。

### 12.3 Broker 选型

| 方案 | 适用 | 代价/注意 |
| --- | --- | --- |
| PostgreSQL Outbox + DB Worker | 学习与小规模，简化部署 | DB polling、清理、吞吐与租约治理 |
| NATS JetStream | 轻量持久事件与 worker、Go/TS 共用 | Stream/Consumer、ACK、重试、保留策略需要运维 |
| Kafka | 大规模事件流、长期重放、流处理 | 分区策略、集群成本、跨分区顺序并非全局顺序 |
| Redis Pub/Sub | 在线、可丢的刷新通知 | 不保证持久交付，不能单独承载关键事件 |

默认建议：**第一阶段 PG worker；第二阶段 JetStream**。做完一次故障注入，再引入更重的 Kafka 对照。

---

## 13. 一致性、缓存和故障矩阵

### 13.1 必须成立的 Invariants

1. 对任意用户 U 和帖子 P，`post_votes(U,P)` 最多一行，值只能 ±1；撤销为无行。
2. 对固定时刻的权威投票表，`score = COUNT(value=1) - COUNT(value=-1)`；若采用异步显示计数，必须明确容差/时限并有对账机制。
3. 一条评论只属于一个帖子；父评论若存在，必属于同帖；不允许移动父节点形成循环。
4. 无权访问/已移除内容即使在旧缓存、旧排名或旧搜索索引里存在，也不应返回受保护正文。
5. 创建型操作的重复请求不能制造多条相同资源；事件重试不能重复执行副作用。

### 13.2 典型故障场景

| 场景 | 正确处理 |
| --- | --- |
| 同一用户两个标签页同时改票 | 事实唯一；锁/版本协议确定最终值与正确计数 |
| DB 写成功、HTTP 响应丢失 | PUT 目标状态重试幂等；POST 使用幂等键 |
| 两个用户给同帖投票 | 同事务计数不会丢更新，热点时统计异步 |
| 投票事件重复消费 | Inbox 去重；有版本/增量时序控制 |
| Post 被审核移除但仍在 Hot ZSET | 读时权限过滤和补取，异步失效缓存 |
| 热榜 worker 宕机 | 延续上一个未过期 generation，标记排名滞后；必要时降级 New |
| Redis 失效 | 从 PostgreSQL 读 New/详情；限制回源防 DB 雪崩 |
| 订阅关系刚取消 | 读时成员关系校验，旧缓存不能继续授予权限 |
| 搜索结果索引滞后 | 搜索候选再经数据库可见性验证 |
| 新帖发布成功后 worker 故障 | New 仍可查询，Hot 允许暂时不出现 |

### 13.3 读写的强弱一致边界

**绝不把统计数字的最终一致**偷换成**权限的最终一致**。比如投票数延迟 3 秒可以是产品允许的体验；已删除私人内容泄漏 3 秒不可以当作同级问题。需要建立分开的 SLO、读时检查和告警。

---

## 14. Node.js / TypeScript + Hono 工程方案

### 14.1 包选型与原因

| 分层 | 首选 | 备选与说明 |
| --- | --- | --- |
| HTTP | `hono` + `@hono/node-server` | Node Adapter；类型化路由 |
| 输入校验 | `zod` + `@hono/zod-validator` | 服务端白名单解析/拒绝未知字段 |
| PostgreSQL | `postgres`（postgres.js）或 `pg` + Drizzle | 复杂投票事务可用原生参数化 SQL |
| ORM / Query Builder | `drizzle-orm` + `drizzle-kit` | 便于迁移/类型推断；复杂 CTE 可使用原生 SQL |
| Redis | `ioredis` 或 `redis` | 先不引入缓存，出现读瓶颈再用 |
| MQ | `nats` | JetStream consumer/ack |
| Auth | Hono 内置/标准 JWT 校验中间件 + session 方案 | 认证身份与授权策略分开；秘钥轮换 |
| 测试 | `vitest`、`testcontainers` | PostgreSQL 真库事务并发测试 |
| 观测 | `@opentelemetry/api` + SDK/Exporter、`pino` | Trace / metrics / 结构化日志 |
| 契约 | OpenAPI + `zod-openapi` 类工具 | 两语言共同遵守 HTTP schema |

本题推荐 **Hono + Zod + Drizzle（普通查询）+ 参数化 SQL（事务/排行榜）**。Drizzle 支持 PostgreSQL 的 node-postgres 和 postgres.js 驱动，具体连接池/事务选择应统一，不能在一个业务事务中混用两个独立连接。[Hono Node.js](https://hono.dev/docs/getting-started/nodejs) · [Hono Validation](https://hono.dev/docs/guides/validation) · [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)。

### 14.2 目录组织：按领域模块

~~~text
reddit/
  apps/
    api-hono/
      src/
        app.ts
        server.ts
        middleware/auth.ts
        middleware/error.ts
        modules/
          communities/{routes,service,repository,schema}.ts
          posts/{routes,service,repository,schema}.ts
          votes/{routes,service,repository,schema}.ts
          comments/{routes,service,repository,schema}.ts
          feeds/{routes,service,repository}.ts
          moderation/{routes,service,repository}.ts
        infrastructure/{db,redis,observability}/
    ranking-worker/
      src/{main,rank-community,consume-events}.ts
  packages/
    contracts/      # OpenAPI/事件 schema
    database/       # migrations / typed SQL / seeds
  tests/{integration,concurrency,load}/
  docker-compose.yml
~~~

示意为 TS 学习实现的独立项目结构，不要求与 Go 同时运行。项目内保持单一 schema 版本所有权。

### 14.3 Hono Handler → Service → Repository

~~~typescript
const voteBody = z.object({
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)])
}).strict()

app.put('/v1/posts/:id/vote',
  authMiddleware,
  zValidator('json', voteBody),
  async (c) => {
    const userId = c.get('userId') // 必须来自可信认证中间件
    const postId = c.req.param('id')
    const { value } = c.req.valid('json')
    const result = await voteService.setVote({ userId, postId, value })
    return c.json(result)
  }
)
~~~

Handler 不直接执行 `UPDATE posts`；Service 控制事务和不变量；Repository 使用同一事务连接读取旧票、写入新票与 Outbox。上面是**职责示意，不是可独立运行的完整应用**（`app/authMiddleware/voteService/z` 等需注入）。

### 14.4 Node 特性要点

- Event Loop 适合大量 I/O，但复杂排名计算应交给 worker；同步 CPU 工作会阻塞同一事件循环。
- `Promise.all` 不是无上限并发许可；数据库连接池、搜索调用要有界并发。
- `worker_threads` 适合 CPU 密集任务，不能代替跨实例任务队列。
- 多进程/多容器部署后，内存 Map、Mutex 式状态不再共享；投票唯一性仍由 PostgreSQL 保证。
- HTTP 断连、超时、应用关闭时要避免半事务；任务 worker 要有信号处理、排空和幂等重试。

---

## 15. Go + Gin 工程方案

### 15.1 包选型与原因

| 分层 | 首选 | 其他选择/权衡 |
| --- | --- | --- |
| HTTP | `github.com/gin-gonic/gin` | 标准 `net/http` 同样可用 |
| 请求验证 | Gin Binding + `go-playground/validator/v10` | 自定义 DTO 与业务校验分开 |
| PostgreSQL | `github.com/jackc/pgx/v5/pgxpool` | 原生 `database/sql` 可选 |
| SQL 类型生成 | `sqlc` + pgx/v5 | 学习复杂 SQL 时清晰保留 SQL |
| ORM | `entgo.io/ent` 或 `gorm.io/gorm` | CRUD 场景友好；深度事务/CTE 可直接写 SQL |
| Redis | `github.com/redis/go-redis/v9` | Sorted Sets / 缓存 |
| MQ | `github.com/nats-io/nats.go` | JetStream 和持久消费者 |
| 异步与并发 | `context`、`errgroup`、`sync`、channel | 控制 worker 并发和取消 |
| 测试 | `testing`、`testcontainers-go`、`go test -race` | 对真实 PostgreSQL 验证 |
| 观测 | `go.opentelemetry.io/otel`、`log/slog` | Trace / metrics / 日志 |
| 迁移与契约 | `golang-migrate/migrate`、OpenAPI | 团队统一迁移流程 |

推荐 **Gin + pgx + sqlc + 明确的 SQL 事务**：便于练习行锁、UPSERT、游标和 SQL 计划。ORM 不是必须；当实体关系复杂而业务 CRUD 较多时，可以对比 Ent/GORM。`sqlc` 官方提供 pgx/v5 生成方案。[sqlc + pgx](https://docs.sqlc.dev/en/latest/guides/using-go-and-pgx.html) · [Gin Binding](https://gin-gonic.com/en/docs/binding/binding-and-validation/)。

### 15.2 推荐目录

~~~text
reddit-go/
  cmd/
    api/main.go
    ranking-worker/main.go
  internal/
    platform/
      config/
      postgres/
      redis/
      messaging/
      observability/
    auth/
    communities/
      handler.go
      service.go
      repository.go
      model.go
      dto.go
    posts/
      handler.go
      service.go
      repository.go
    votes/
      handler.go
      service.go
      repository.go
    comments/
    feeds/
    moderation/
    jobs/
      ranking/
      outbox/
  db/
    migrations/
    queries/        # sqlc SQL
    generated/      # sqlc 输出
  api/openapi.yaml
  test/{integration,concurrency}/
  docker-compose.yml
  go.mod
~~~

`internal` 防止被外部 Go module 误用。`cmd/api` 与 `cmd/ranking-worker` 可复用同一个业务包，但部署生命周期独立。避免让 handler 知道 sqlc 的内部事务细节。

### 15.3 Gin Handler 的职责（示例片段）

~~~go
type VoteInput struct {
    Value int `json:"value" binding:"oneof=-1 0 1"`
}

func (h *Handler) SetPostVote(c *gin.Context) {
    var in VoteInput
    if err := c.ShouldBindJSON(&in); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vote"})
        return
    }
    userID := MustAuthenticatedUserID(c) // 认证中间件设置
    result, err := h.votes.SetPostVote(
        c.Request.Context(), userID, c.Param("id"), in.Value,
    )
    if err != nil {
        WriteDomainError(c, err)
        return
    }
    c.JSON(http.StatusOK, result)
}
~~~

这个片段是职责说明；还需实现身份解析、严格 JSON 未知字段处理、UUID 解析与错误映射。`ShouldBindJSON` 不意味着自动拒绝所有额外字段。Service 内通过 `pgxpool.BeginTx` 开事务，`defer tx.Rollback(ctx)`，成功 `tx.Commit(ctx)`；同一事务操作不要绕过 `tx` 使用独立 pool 连接。

### 15.4 Go 并发模型如何服务于 Reddit

- Gin/net/http 利用 goroutine 处理并发请求，但**请求并发不等于数据库无限并发**，pgxpool 应设置容量和等待超时。
- Hot Ranking Worker 可以按社区用**有界 worker pool** 并发计算；数据库扫描、Redis 写入、MQ 消费均需限速。
- 多个 worker 使用 channel 派发任务、`errgroup.WithContext` 传播取消；不能每条投票事件都无上限 `go func()`。
- `sync.Mutex` 只保证单进程内共享数据安全，不能保护多容器中的投票计数。
- `context.Context` 用于请求超时、数据库操作、停止信号与任务取消；goroutine 需要可终止，避免泄漏。
- 按 `postId` 进行稳定分区可降低投票聚合乱序，但**不同分区不存在全局顺序**，消费者必须以幂等和版本约束正确性。
- Go 协程 ≠ 多进程；多实例部署仍需数据库、消息队列和明确的责任边界。

### 15.5 Node.js 和 Go 如何对照、协同？

~~~text
同一 OpenAPI / PostgreSQL schema / 业务不变量
           |
       +---+---+
       |       |
   Hono/TS    Gin/Go
       |       |
   实现相同 API 与并发测试（学习时二选一运行）
           |
      之后可单独抽出 Ranking Worker
           |
  Outbox -> JetStream -> Go worker（可选）
~~~

建议**优先 Go 主实现，Hono 做对照**；不必让两套应用同时写同一业务表。若确实混合部署，明确表写入 owner：如 Hono 只负责 BFF、Gin 负责投票命令与 PostgreSQL 写入；通过 OpenAPI/事件契约协作，而非两端各自实现一套不一致的计数规则。

---

## 16. 模块职责、事务边界与协作

### 16.1 谁负责什么？

| 模块 | 输入/输出 | 不应做的事 |
| --- | --- | --- |
| Communities | 社区、加入、退出、角色 | 不修改帖子票数 |
| Posts | 创建/查看/删除帖子、内容权限 | 不把缓存当事实 |
| Votes | 当前投票、增量、计数、事件 | 不直接相信客户端计数 |
| Comments | 树关系、深度、创建/删除/回复 | 不允许跨帖子父节点 |
| Feeds | 候选、排序、游标、过滤 | 不直接更改投票事实 |
| Ranking Worker | 更新快照/缓存 | 不单独裁定用户权限 |
| Moderation | 状态、禁言/恢复、审计 | 不靠 Redis TTL 保护私有内容 |
| Notifications | 持久事件 → 提醒 | 不影响发帖主事务成功率 |

### 16.2 事务和外部调用法则

- **事务内**：鉴权相关的权威状态读取（必要时锁/版本检查）、内容与投票事实、计数基线、Outbox、幂等结果。
- **事务外**：Redis 写入、搜索索引、对象存储、推送、邮件、计算繁重的排行榜。
- **跨组件**：用 Outbox 连接数据库和异步消费者；用 eventId/版本、Inbox、重试和对账解决重复/乱序。
- **跨语言**：OpenAPI + 事件 JSON Schema；统一 UUID、时间 UTC、排序枚举、错误码、分页游标语义。

---

## 17. 指标、告警与容量演进

### 17.1 最有用的指标

| 类型 | 建议指标 |
| --- | --- |
| API | p50/p95/p99、5xx、429、请求超时、并发数 |
| PostgreSQL | 连接池等待、慢 SQL、行锁等待、死锁、WAL、复制延迟、autovacuum |
| 投票正确性 | 与事实表对账偏差、同用户重复请求、同帖竞争冲突 |
| 内容 | 发帖/评论成功率、非法父节点、删除可见性泄漏数 |
| 信息流 | 命中率、候选不足率、读取源占比、重复/跳页率、rank generation age |
| 缓存 | Redis 内存、命中/失效率、回源 QPS、热 key |
| MQ/Worker | Outbox 最老待投递时长、消费积压、重试、死信、对账修复 |
| 安全 | 垃圾帖、刷票、异常投票速率、审核到不可见延迟 |

### 17.2 分阶段演进，不是先搭微服务

| 阶段 | 触发信号 | 改造 |
| --- | --- | --- |
| Stage 0 | 学习/MVP | Gin/Hono 单体 + PostgreSQL；New / 简化 Hot，事务计数 |
| Stage 1 | 读放大、列表慢 | 组合索引、SQL 优化、CDN、Redis 候选缓存 |
| Stage 2 | 排名耗时、通知拖慢写请求 | PG Outbox + worker，版本化 Ranking Snapshot |
| Stage 3 | 同帖投票行锁严重 | 异步/分片聚合、热点隔离、权威事实表对账 |
| Stage 4 | 大量社区、订阅或个性化 | 混合 fan-out、候选池/多阶段推荐、搜索引擎 |
| Stage 5 | 地域和组织规模变化 | 按域/区域拆写入所有权、只读副本、分区/分片 |

拆服务/拆库前必须拿出压测与可观测证据。PostgreSQL 索引、分区、读副本、连接池配置都有成本；不是看到「千万用户」就必须换成某个 NoSQL 产品。

---

## 18. 测试方案：验证正确性，而不只是 RPS

### 18.1 单元测试

- `setVote(old,new)` 九种状态组合（含 0→0），up/down delta 正确。
- Hot 公式单调性、时间衰减、负分和零票边界。
- 查询游标编码/解码、签名、过期、limit 上限。
- 评论深度、跨帖父节点、已删父节点、最大深度。
- 权限：未登录、被禁言、社区受限、MOD 恢复。

### 18.2 PostgreSQL 并发集成测试

1. 一个用户同时提交 100 次 `PUT vote=1`：只有一票，upvotes 只加 1。
2. 同一用户并发 `+1/-1/0`：最终票状态应与**确定的提交顺序/版本协议**一致，数据库派生计数与事实表一致。
3. 100 个不同用户对同帖投票：分数准确、无负计数；记录行锁等待分布。
4. 事务执行到旧票已读但尚未更新，插入竞争请求并通过同步屏障控制顺序；验证没有丢更新。
5. 删除帖子与投票、评论写入并发：定义谁先提交，禁止产生产品不允许的写入。
6. 插入跨帖回复、超过深度 20、直接自引用：正确拒绝；parent 不允许更新。
7. POST 同一 Idempotency-Key 请求 100 次：只新建一个帖子；不同 payload 复用 key 返回 409。
8. 投票和 Outbox 的提交前失败：必须全部回滚；提交后发布失败必须能恢复。
9. 同一 eventId 重放 3 次：ranking/notification 等有副作用消费者只执行一次。
10. 新 generation 构建一半时宕机：仍使用旧 generation，读不到半成品。
11. 翻页期间新投票改变排序：在有效 generation 内不重复/不跳页；过期返回明确错误。
12. 旧排名和旧搜索命中已移除内容：接口必须不返回正文。
13. 连续多次加入/退出社区：关系正确；不存在的退出仍可幂等处理。

集成测试使用真 PostgreSQL，不要用 SQLite 模拟行锁/事务隔离细节。

### 18.3 故障注入

- Redis 整体失效、热点缓存过期；观察 PostgreSQL 回源与限流。
- Ranking Worker 中途退出、Outbox Publisher 发布成功后崩溃；观察重试是否重复计数。
- 浏览器投票请求超时但服务器已提交；刷新后 viewerVote 与服务端一致。
- PostgreSQL 主库短暂不可用、连接池耗尽；确认失败请求不产生半数据。
- 搜索索引落后 10 分钟且内容被审核移除；依旧不能泄露已移除正文。
- 删帖事件晚于恢复事件到达；有 aggregateVersion 防止旧事件覆盖新状态。

### 18.4 性能压测

- 用 k6/Vegeta 压社区 New、Home、热门帖子详情、投票、评论树加载。
- 分别测试**分散投票**和**单帖热点投票**；对比行锁等待、p99、数据库 CPU。
- 压测 `100/1000` 个订阅社区的 Home 查询；记录执行计划和候选扫描量。
- 对比缓存关闭/开启、排名快照刷新间隔、消息堆积时的用户体验。
- 每次压测结束用 SQL 事实表校验票数；**吞吐达标但分数错误等于失败**。

---

## 19. 建议的实践交付（不是整个 System Design 课程表）

| 里程碑 | 实作范围 | 必须证明 |
| --- | --- | --- |
| A：基础建模 | PostgreSQL migration、users/communities/posts/memberships | schema/唯一键/权限正确 |
| B：投票和评论 | 投票状态事务、计数、嵌套回复与分页 | 并发不重计，跨帖回复失败 |
| C：基本 Feed | 社区 New/Top、Home New、cursor | 索引与 keyset 有效，分页无误 |
| D：Hot 与缓存 | 自定义 Hot、周期 ranking、Redis（可选） | 版本稳定、缓存过滤删除内容 |
| E：可靠异步 | Outbox + worker → JetStream（可选） | 断电重放、重复消费无副作用 |
| F：规模演进 | 热帖异步/分片统计、搜索或个性化 | 对比压测结果和复杂度成本 |
| G：双语言对照 | 用 Hono 重写已完成的 Gin API 路径 | 共同 OpenAPI、相同并发正确性 |

**推荐实作顺序：Go/Gin + PostgreSQL 先完成 A → B → C → D → E**。B 是本题的正确性中心；D 是本题的读性能中心。Node/Hono 在 A/B/C 中选一条典型 API 作对照，不必为练习同步维护两份完整产品。练习完成后，可以将评论模型的复杂问题独立迁入 `nested-comment/design.md` 专题，不重复写两套评论设计。

每个阶段都要交付最小架构图、SQL/代码、一个故障场景、一个可验证的不变量和一张测试/观测结果表。

---

## 20. 面试表达模板（30–45 分钟）

**第 0–5 分钟：澄清范围**。解释公开社区、发帖、订阅、投票、评论、Home；确认 Hot/Top/New 与 Best 的边界。

**第 5–10 分钟：容量估算**。读请求占主导，评论/投票写增长明显；最危险的是热点帖子行锁、订阅首页聚合和动态排行。

**第 10–18 分钟：高层图**。客户端/CDN → API → PostgreSQL；旁边缓存与排名 worker；异步通知/搜索非核心写链路。

**第 18–30 分钟：深挖两个难点**。一是投票旧值/新值和计数的一致性；二是 New/Top/Hot 与 Home 的候选生成、缓存、分页快照。

**第 30–38 分钟：一致性和异常**。幂等、删除权限、重复事件、旧排名过滤、事务 Outbox、异步统计对账。

**第 38–45 分钟：扩容取舍**。锁帖子事务 → 异步聚合；PG keyset → Redis/快照；读时扇出 → 混合扇出；根据测量而非直觉拆分。

### 高频追问与回答抓手

- **为什么不用 Redis 直接记投票？** Redis 可以缓存，但用户当前投票的唯一性、权限与持久化事务以 PostgreSQL 为准；跨系统更新会有丢失/重复窗口。
- **为什么「一人只能投一票」还会统计错？** 唯一约束只管事实行，旧票到新票的差量可能在并发下被重复应用；必须锁/版本或幂等事件。
- **热点帖子 10 万人同时点赞怎么办？** 先测行锁；正确性保留在票事实，计数采用异步聚合与定期对账，不强迫每票都锁同一帖子行。
- **为什么 Hot 不直接 ORDER BY score DESC？** 那是粗略 Top，不含时间衰减；动态分数与大 OFFSET 造成性能和分页一致性问题。
- **为什么不用给每个订阅者写 inbox？** 超大社区的发布事件会写扩散到海量订阅者；大社区更适合读时混合候选。
- **用户取消订阅后为什么还能看到旧帖？** 若 Home 定义为仅订阅内容，需读时校验并失效订阅缓存；个性化推荐若允许未订阅内容，则另有推荐/屏蔽规则。
- **投票表能算出上周获得的票数吗？** 只有当前状态不行；需要保留带时间的变更事件或时间窗聚合。
- **为什么删除帖还出现在排行榜？** 排名是滞后读模型；仍必须读时检查帖子可见性，不能依赖 TTL。
- **PostgreSQL 做不做得了搜索？** MVP 英文内容可用 FTS+GIN；分词、复杂相关性与规模上升再引专用索引。
- **Node 和 Go 选哪个？** Hono 适合已有 TypeScript 全栈生态；Gin + pgx/sqlc 有利于巩固 Go 后端、并发 worker 与显式 SQL；正确性依赖协议，不依赖语言。

---

## 21. 知识点学习清单

- [ ] 功能/非功能需求、容量估算、SLO、p95/p99、读写热点。
- [ ] PostgreSQL 主键/外键/复合键、唯一约束、组合索引、部分索引。
- [ ] 事务、行锁、隔离级别、`ON CONFLICT`、并发改票、锁顺序、死锁。
- [ ] 幂等 PUT、POST Idempotency-Key、请求哈希、事件版本。
- [ ] 投票事实 vs 计数投影、乐观/悲观锁、分片计数和对账。
- [ ] 评论邻接表、跨帖复合外键、递归 CTE、层级分页、软删除。
- [ ] New / Top / Hot / Best 区别、时间衰减、Top 时间窗定义。
- [ ] Keyset pagination、排序快照、generation、游标签名和过期。
- [ ] Fan-out on Read / Write、热点内容、缓存穿透/击穿/雪崩。
- [ ] Redis ZSET、Cache-aside、删除权限即时过滤、CDN 缓存边界。
- [ ] Outbox / Inbox、ACK、至少一次投递、幂等、死信与重放。
- [ ] PostgreSQL FTS/GIN、对象存储签名上传、SSRF/XSS 风险。
- [ ] Go/Gin、pgxpool、sqlc、goroutine、channel、context、worker pool。
- [ ] Node.js/Hono、Zod、Drizzle、Event Loop、worker_threads。
- [ ] Integration / concurrency / chaos testing、Tracing、Metrics、Logs。

---

## 22. 参考资料（优先官方原始来源）

> 官方 Reddit 资料用于确认**产品语义**，不能被解释为本文所有内部技术实现都有 Reddit 官方背书。

1. Reddit Help — [Reddit’s Approach to Content Recommendations](https://support.reddithelp.com/hc/en-us/articles/23511859482388-Reddit-s-Approach-to-Content-Recommendations)：Home、Hot/Top/New、个性化推荐候选/过滤/排序。
2. Reddit Help — [What are home feed recommendations?](https://support.reddithelp.com/hc/en-us/articles/4402284777364-What-are-home-feed-recommendations)：Best 作为个性化排序的产品概念。
3. Reddit Help — [What’s the difference between r/all, r/popular, news and my home feed?](https://support.reddithelp.com/hc/en-us/articles/360043043552-What-s-the-difference-between-r-all-r-popular-news-and-my-home-feed)：不同 Feed 的边界。
4. PostgreSQL — [SELECT / Locking](https://www.postgresql.org/docs/current/sql-select.html)、[INSERT / ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)、[Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)：投票并发和事务。
5. PostgreSQL — [Indexes on Expressions](https://www.postgresql.org/docs/current/indexes-expressional.html)、[Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)、[Multicolumn Indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)：列表索引和约束。
6. PostgreSQL — [WITH RECURSIVE](https://www.postgresql.org/docs/current/queries-with.html)、[ltree](https://www.postgresql.org/docs/current/ltree.html)：评论树和层级遍历。
7. PostgreSQL — [Full Text Search](https://www.postgresql.org/docs/current/textsearch.html)：搜索基线。
8. Redis — [Sorted Sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/)、[Leaderboard](https://redis.io/docs/latest/develop/use-cases/leaderboard/)：排名缓存。
9. NATS — [JetStream](https://docs.nats.io/concepts/jetstream)：持久消息、消费确认、重复投递。
10. Hono — [Node.js Adapter](https://hono.dev/docs/getting-started/nodejs)、[Validation](https://hono.dev/docs/guides/validation)。
11. Gin — [Model Binding / Validation](https://gin-gonic.com/en/docs/binding/binding-and-validation/)。
12. sqlc — [Using Go and pgx](https://docs.sqlc.dev/en/latest/guides/using-go-and-pgx.html)；[pgx](https://github.com/jackc/pgx)；[Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)。
13. Go — [context](https://pkg.go.dev/context)、[database/sql](https://pkg.go.dev/database/sql)、[race detector](https://go.dev/doc/articles/race_detector)。

---

## 23. 一页总结

**Design Reddit 的三个核心难点**：

1. **投票必须正确**：一人一当前票、改票与撤票不重计；MVP 事务内维护事实+计数，扩容后异步统计但必须幂等且可对账。
2. **Feed 必须高效且语义清晰**：New 用索引和 keyset，Hot/Top 用明确排序定义与版本化排名；Home 从订阅合并候选再过滤，增长期采用混合 fan-out。
3. **滞后读模型不能越权**：Redis、排行榜、搜索、通知可以延迟；审核、删除、封禁、社区权限必须在对外返回时得到正确执行。

**核心工程判断**：不要把「Redis + Kafka + 微服务 + 推荐算法」当作 Design Reddit 的标准答案。先证明投票不重计、评论关系正确、分页不乱、旧缓存不会泄露被移除的内容，再根据测量结果引入异步统计、缓存、消息队列与推荐。