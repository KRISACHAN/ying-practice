// 自行编写的合成知识资料，只包含公开技术概念，不复制课程正文或真实业务数据。
export const fixtures = [
  { id: 'rag-basics', title: 'RAG 的作用与适用范围', body: `## RAG 的作用
RAG 在生成答案前检索外部资料，把相关片段放入本轮上下文。RAG 不修改模型参数，也不会自动产生永久记忆。
## 适用范围
私有或经常更新的知识、无法每次完整放入上下文的资料适合检索增强。翻译当前输入通常不需要额外检索。订单编号和账户状态应调用有权限保护的业务接口。` },
  { id: 'index-pipeline', title: '索引更新与文档版本', body: `## 索引链路
索引链路先解析、清理和切块，再生成文档向量并写入存储。后台任务应记录状态、失败与处理版本。
## 更新与删除
文档更新先完整建立新版本，验证后再切换当前版本，最后清理旧向量。删除必须覆盖正文、向量、关键词索引和缓存。重复任务通过稳定 ID 与版本检查保持幂等。` },
  { id: 'chunking', title: '文档切块与上下文完整性', body: `## 文档切块
文档切块应保留标题、表头、否定词、适用条件和结论。块太小会拆散条件与答案；块太大会混入多个主题。
## 切块参数
chunkSize 与 chunkOverlap 需要根据真实问题评测，字符数不能直接当作 Token 数。适量重叠缓解边界问题，过多重叠制造重复候选。父子块用小块召回，再补充父级章节供生成阅读。` },
  { id: 'embedding', title: 'Embedding 模型与向量空间', body: `## Embedding 一致性
文档向量与查询向量必须来自兼容的 Embedding 模型和维度；相同维度不代表语义空间兼容。
## 模型迁移
Embedding 模型迁移需要重建索引，先评测新旧索引再切换。不同模型的向量不能混在同一个检索范围。余弦相似度衡量向量方向接近程度，分数不是答案正确概率。` },
  { id: 'hybrid', title: '混合检索、RRF 与重排', body: `## 混合检索
向量检索适合同义表达，关键词检索适合错误码、API 名称和精确标识。混合检索同时使用两路候选。
## RRF 与重排
RRF 按排名融合不同检索结果，不直接相加不同尺度的原始分数。重排模型对候选与问题共同评分，只能改进已召回资料的顺序，无法找回候选外的文档。` },
  { id: 'pgvector', title: 'PostgreSQL pgvector 距离与索引', body: `## pgvector 余弦距离
pgvector 的 <=> 运算符计算余弦距离，距离越小越接近；余弦相似度可用 1 - 距离计算。
## 向量索引
小知识库可以采用精确扫描。规模增长后可评测 HNSW 或 IVFFlat；近似索引在速度与召回之间取舍，过滤策略也影响候选覆盖。` },
  { id: 'security', title: '权限过滤与检索资料安全', body: `## 权限过滤
租户和访问范围必须来自服务端认证上下文。权限过滤在候选召回前执行，不能先查全库再删除无权内容。
## 不可信资料
检索资料属于不可信数据，文档中的指令不能扩展工具权限。Prompt 约束需要配合最小权限与执行前校验。缓存键需包括租户、权限版本和索引版本。` },
  { id: 'evaluation', title: 'RAG 评测与无答案处理', body: `## 分层评测
Recall@K 看相关资料是否进入候选，MRR 看第一条相关资料的排名。生成阶段另看正确性、忠实度和引用支持度。
## 无答案处理
候选非空不代表资料足够。阈值必须用有答案、相近但无答案和无关问题校准。证据不足应说明无法确认；检索服务不可用应明确提示服务故障。离线评测、影子运行与灰度发布形成质量闭环。` },
];
export const evaluationCases = [
  { question: 'RAG 会修改模型参数吗？', expected: 'rag-basics', tags: ['概念'] },
  { question: '文档更新如何切换版本？', expected: 'index-pipeline', tags: ['版本'] },
  { question: '文档切块为什么保留表头和否定词？', expected: 'chunking', tags: ['结构'] },
  { question: 'Embedding 模型迁移需要重建索引吗？', expected: 'embedding', tags: ['模型迁移'] },
  { question: 'RRF 为什么按排名融合？', expected: 'hybrid', tags: ['精确标识'] },
  { question: 'pgvector 的 <=> 计算什么？', expected: 'pgvector', tags: ['运算符'] },
  { question: '权限过滤应该在召回前还是后？', expected: 'security', tags: ['权限'] },
  { question: 'MRR 评测什么？', expected: 'evaluation', tags: ['指标'] },
  { question: '火星温室番茄种植温度是多少？', expected: null, tags: ['无答案'] },
];
export const samples = evaluationCases.map(c => c.question);
