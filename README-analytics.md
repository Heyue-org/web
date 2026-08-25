# Visitor-ID Analytics（Upstash + Vercel）

这是为 Heyue-org/web 提供的最小访问统计实现，使用前端生成的 visitor_id + Upstash Redis 集合做年度去重，部署到 Vercel Serverless。适合日流量 ≤ 1000 的站点[...] 

文件说明
- static/analytics.js — 前端脚本；将 visitor_id 写入 localStorage/cookie/indexedDB，并向 /api/collect 发送一次打点。
- api/collect.js — Vercel Serverless 函数；使用 Upstash Redis 的 REST API 做集合去重与 visitor 元数据更新。

部署步骤概览
1. 注册 Upstash（免费）
   - 访问 https://upstash.com 并使用 GitHub 登录（或邮箱注册）。
   - 在控制台创建一个 Redis 数据库（选择免费层）。
   - 在数据库页面记下两个值：REST URL（例如 https://us1-xxxx.upstash.io）和 REST token。

2. 在 Vercel 中导入仓库并设置环境变量
   - 使用你的 GitHub 账号登录 https://vercel.com 并导入仓库 `Heyue-org/web`。
   - 在项目设置（Settings → Environment Variables）中添加如下变量：
     - UPSTASH_REST_URL = <你的 Upstash REST URL>
     - UPSTASH_REST_TOKEN = <你的 Upstash REST token>
     - UNIQUE_WINDOW_DAYS = 365
   - 部署（Vercel 会自动构建并部署仓库）。

3. 将前端脚本引入你的页面
   - 如果是静态 HTML，在 `</body>` 前加入：
     ```html
     <script src="/static/analytics.js"></script>
     ```
   - 如果使用 Jekyll，将 `static/analytics.js` 放到 `assets` 或 `static`，并在 `_layouts/default.html` 的底部引入。示例：
     ```liquid
     <!-- _layouts/default.html -->
     ...
     {% raw %}{% include heyue-analytics.html %}{% endraw %}
     </body>
     ```

4. 测试
   - 部署完成后打开你的网站，使用浏览器开发者工具查看 Network，确认页面有一次 POST 到 `/api/collect`，返回 JSON：{ok:true, new_unique: true/false, total_unique[...]
   - 在 Upstash 控制台或用 curl 调用 REST API 来查看年度独立集合大小（示例）：
     ```bash
     curl -X POST <UPSTASH_REST_URL> \
       -H "Authorization: Bearer <UPSTASH_REST_TOKEN>" \
       -H "Content-Type: application/json" \
       -d '{"cmd":["SCARD","unique:2026"]}'
     ```
     把 2026 换成当前年。

常见问题与排查
- 如果 /api/collect 返回 401/403：检查 Vercel 环境变量 UPSTASH_REST_TOKEN 是否正确填写并已在正确的环境（Production/Preview/Development）中设置。
- 如果 POST 请求未到达 serverless：检查脚本是否正确引入、路径是否正确（`/api/collect` 在 Vercel 项目根的 `api/collect.js`）以及 Vercel 部署是否成功。
- 并发与一致性：使用 Upstash Redis 可避免 GitHub Contents 的 409 并发冲突；对于你目前的流量（≤1000/day），Upstash 免费 tier 足够。

可选增强（非必须）
- 指纹合并：如果希望对清除存储的用户做一定合并策略，可以在 server 端添加比对逻辑（例如把最近 7 天内 fingerprint 完全相同的记录合并为同一访��[...]
- Dashboard：可以再添加一个简单 dashboard 页面（Vercel serverless +前端）用来展示 SCARD/最近 N 个 visitor 的 last_seen 等。

安全说明
- 不要把 Upstash token 放到前端或仓库公开区域；必须在 Vercel 环境变量里配置。
- analytics.js 仅发送非敏感数据（visitor_id 为 UUID，fingerprint 为非精确散列，ua/path/referrer），遵守隐私原则。如果你希望更隐私友好，可移除 ua/referrer �[...]

如果你同意，我会：
- 把这些文件提交到 `analytics/visitor-id` 分支（我已创建），并发起一个 PR。PR 会包含上述说明与部署步骤。

部署/调试时我可以帮你：
- 指导你创建 Upstash Redis 并拿到 REST URL/token；
- 在 Vercel 配置环境变量并启动部署；
- 验证第一次访问是否成功并帮你读取 Upstash 中的 SCARD 数据。

请回复“请提交并创建 PR”我就把文件提交并创建 PR（如果你已经同意，我现在就继续）。