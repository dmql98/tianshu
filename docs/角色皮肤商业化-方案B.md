# 角色/皮肤商业化 —— 方案 B(加密分发 + 授权下发)

> 目标:把 tianshu 发给别人运行,靠**售卖角色包与皮肤**盈利。
> 原则:付费内容**不在安装包里**,而是放在你自己的商店服务器上,用户通过 App 内激活/兑换获得授权,再按**内容绑定操作的解密密钥**下发并落盘到本地。

---

## 1. 设计目标与边界(先说清楚)

| 要防的 | 防护等级 | 手段 |
|:--- |:--- |:--- |
| 用户直接把安装包里的角色文件拷走/转发 | ★★★ | 付费内容不随安装包分发 |
| 用户把下载下来的付费包共享给他人换机 | ★★★ | 内容解密钥与 deviceId/账户绑定 + 水印追责 |
| 专业逆向,从内存/磁盘抠出明文素材 | ★☆ | 加解密重排 + 不落明文素材 + 授权令牌短期过期 |
| 离线白嫖(断网后一直用) | ★★ | 授权令牌限时,离线宽限需要定时在线续期 |
| 100% 绝对防护 | — | **做不到**(见 §10)。方案 B 的目标是"抄走的代价 > 购买价格" |

**信任边界**:用户机器上的内容加密一定可以被逆向,这是所有本地软件的天花板。所以方案 B 的商业核心是:
1. **付费内容不从安装包流出**(内容只在你的服务器上);
2. **每个付费包的解密密钥按人/按设备签发**,换机必须重新在线授权;
3. **素材里埋购买者水印**,泄露可抓包查证并封号/追责。

---

## 2. 总体架构

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│       你的商店授权中心        │        │    部署在用户机器上的 tianshu   │
│   (只你有,不发给任何人)        │        │        (完整 App + 无付费内容)  │
│                              │        │                              │
│  Store Server (Hono)         │  HTTPS  │   tianshu server (Hono)       │
│  ├─ 用户/设备身份             │◄───────►├─ store-client ──┐            │
│  ├─ 兑换码/权限组(licenses)   │  /api/v1 │  ├─ 激活/兑换     │            │
│  ├─ 内容包加密下发(S3/磁盘)   │        │  ├─ 下载+解密落地  │            │
│  ├─ 授权签发 JWT(device+内容) │        │  └─ 授权缓存与续期  │            │
│  ├─ 水印注入                 │        ├─ 角色/视觉 store(现状,改造)     │
│  └─ 管理后台/兑换码生成/审计    │        └─ socket.io / providers / llm  │
│                              │        └──────────────────────────────┘
│           ┌─────────────────┴───────────────┐
│           │  内容制作管线(你本地,接入CI)       │
│           │  角色/视觉 → .tianshu-pack 加密打包│
│           │  被推送到 store server 存储       │
└───────────┴────────────────────────────────┘
```

- **你的服务器**是唯一"有货"的地方:角色包、皮肤包、visual 资源、授权、兑换码都在这。
- **用户手里只有**:tianshu 本体(不含付费内容)+ 一个"商店通道"。
- **请求流**:用户 App → app 本机 server→(经 app 内权限校验)→ 你的 store server `/api/v1/...`;下载时 store server 按 `deviceId+license` 签发时效解密密钥并加密下发。

---

## 3. 三个子系统的详细设计

### 3.1 Store / License Server(新工程,独立仓库)

技术栈与 tianshu 一致以便复用:**Node + Hono + better-sqlite3 + jose(JWT)+ S3/本地磁盘存放包体**。可以微服务也可以单体,建议单体起步。

#### 3.1.1 数据模型(SQLite)

```
users             -- 商店账号(可选强于兑换码;用于多设备/订单)
licenses         -- 兑换码 / 授权凭证
  id, code(短码), product_id, kind, status(new/active/revoked/consumed),
  bound_device_id, issued_at, expires_at, order_no
products         -- 可选的可售卖目录(不用路由生成也能用)
  id, kind(character|skin|bundle), name, version, size, store_path,
  preview_asset_ids, price_demo, enabled
device_grants    -- 设备级授权(JWT 断言来源)
content_keys     -- 每次下发用的随机包 key 记录(用于审计/吊销)
watermarks      -- 素材水印映射(id, grant_id, package_id, hash)
```

#### 3.1.2 API 摘要(前缀 `/api/v1`)

```
POST /auth/register          -- 建号(可选)
POST /auth/device/sign       -- 把 deviceId + 随机质询 签进 JWT(无账号也可)
POST /redeem                 -- 兑换码激活 {code, deviceId} → 下发授权 JWT
POST /download/package       -- 授权校验 → 加密包体 + 时效密钥 + 水印
POST /verify                 -- 客户端本地授权缓存过期时在线续签
GET  /catalog                -- 商店目录(明文元数据+预览图,用于 UI)
GET  /my/content             -- 我买过的内容列表
Webhook: /webhook/fulfillment -- 支付回调 → 生成/激活兑换码
```

**授权 JWT 结构**(server 用 HS256 签名,不依赖用户机器任何密钥):
```json
{
  "jti": "授权唯一id",
  "deviceId": "u-xxxx",
  "pkgs": ["char-vivi", "skin-vivi-summer"],
  "exp":  now + 14天,        // 在线须每 ≤7 天续签一次
  "gid": "grant-20260901-01"
}
```

#### 3.1.3 包体存储(对象存储或磁盘)

- 每个 `product` 对应一份 `.tianshu-pack`(见 §4),存为一次性文件。
- 下载时 store server:
  1. 校验授权 JWT;
  2. 生成一次性 `content.key`(随机 32B);
  3. 用 `content.key` 对包体做 **XChaCha20-Poly1305**(或 AES-256-GCM)二次加密后传输;
  4. 把 `content.key` 用设备公钥/临时会话密钥包裹后同时交付(见 §4.3);
  5. 在 metadata 落 `watermarkUserId`。

### 3.2 tianshu 服务端集成(改造 `web/server`)

新增目录 `src/store/`,职责单一,不许污染 agent 核心:

```
src/store/
  client.ts         # 对 store server 的 fetch 封装(超时/重试/限流)
  config.ts         # STORE_SERVER_URL / STORE_ENABLED / 离线宽限天数
  license.ts        # 本地授权缓存(签发 deviceId、JWT 存取、续签、离线宽限)
  pack.ts           # .tianshu-pack 解析 + 解密落地
  install.ts        # 把解密后的角色/皮肤落到现有 character 存储的接入层
  watermark.ts      # 从授权数据恢复水印元数据(查证用)
  productSource.ts  # 产品来源标记(product_id / grant_id / license_id)
routes/store.ts     # /api/store/catalog /redeem /download /status
routes/characters.ts  # (改造) GET /:id/export 对"商用内容"拦截或水印化
```

核心决策:
1. **内容入口统一**:`GET /api/store/download?productId=` 服务端先查本地 license 缓存,有权限再回源 store server 拿包,解密后交给 `install.ts` 落地。用户浏览器/UI 只广播"装"/"卸",永远不接触包体本身。
2. **本地落地格式与现有 `characters/` 一致**,这样现有一切(角色卡片、渲染器、revision、会话)不用改。仅新增 `product_source` 标记到 `characterMetaStore`。
3. **导出拦截**:付费角色 `GET /api/characters/:id/export` 拒绝明文导出(继续返回 403),皮肤同理。草根用户自建角色导出不受影响。
4. **删除保护**:已授权内容的 `asset` 生命周期仍走现有 `asset-gc`,但 `product_source` 的资产不能被用户手动删除。
5. **授权缓存**:`license.json` 存 JWT + 设备签名;每次会话校验真实值,失败进"离线宽限"倒计时,到期后限时停用(角色可聊但视觉/语音锁水印)。

### 3.3 前端(改造 `client`)

- **商店页面**(替代现有假 `MarketPage`):从 `/catalog` 拉真实数据,卡片显示价格/已拥有/已安装/更新时间。
  - ❌ 无"角色.json 上传安装"的公开按钮对商店内容(合不提供本地导入导出 UI 的仓库进付费内容)。
- **激活/兑换**:粘贴兑换码 → `POST /api/store/redeem` → 成功后按列表安装。
- **权限状态**:右上角账户抽屉显示设备签名、授权数量、离线宽限期、换机提示。
- **货架内页面**(角色详情):视觉 Tab 增加"商店皮肤"列表,未拥有皮肤显示解锁按钮。

---

## 4. 内容包格式 `.tianshu-pack`(加密)

> 容器头部保持紧凑(JSON 一行),内容体积以加密为主,不动结构。

```
.tianshu-pack (container)
├── header (JSON, 明文, 仅公共信息)
│     version: 2
│     product: { id, kind, name, iconAssetId, previewAssetIds }
│     sha256: <原始未加密包体的哈希>        # 防篡改+签名校验
│     size
│     requiredVersion: ">=0.7"
│     watermark: { algorithm: "png" }        # 声明的下标记
├── body  (payload, 加密)
│     data   = AES-256-GCM(body_raw / sessionKey)
│     tag    = GCM tag
│     iv
└── keywrap
      ek = ECDH: 用「设备会话公钥」逐步包裹 content.key
```

**为何不直接把 key 写进包?** 因为包会被复制。`content.key + grantId` 都由 store server 按 deviceId 签发,拿到包但没有授权,没有用。

### 4.3 每次下载的动态 key 流程

```
1. tianshu 第一次激活时: 生成本机持久密钥对 (private.pem 存本地, public.pem 注册到 store)
2. 下载某包时:
   store 生成 content.key 随机 32B
   → 用设备公钥包裹 content.key
   → 返回 {packBody, wrappedKey}
3. 本地:
   content.key = 设备私钥解包 wrappedKey    // 每包一次,不持久化
   decrypted   = AES-GCM(content.key, packBody)
   sha256 校验 → 落地到角色目录
4. 换机/换账号:
   deviceKey 在旧机器本地,新机器必须重新在线激活 → 旧内容无法迁移
   水印落新 userId → 行为可追溯
```

> 意义:同一份 `.tianshu-pack` 只存在于服务端,用户无法跨设备迁移。

---

## 5. 皮肤模型

皮肤的本质上:同一角色的一套替换 `visual.json + assets`。

方案:皮肤 = 独立 `product`(kind=skin),本体不复制角色内容(角色 base + skin 覆写)。

```
install → characters/{charId}/skins/{skinId}/visual.json + assets/
挂载 → 现有 visual-store 增 read with skin:session → 临时在 skins/{skinId} 上合并 manifest
```

为避免改动现有渲染系统,皮肤落地为一个 **新 character 目录** 内含 `skinOf: <charId>` 的引用:
- `characters/charId-sk-summer/character.json` 里 `baseCharacterId` = 原角色,视觉与对话都沿用原角色;
- 前端把 `skinOf` 的角色在卡片上显示为"该角色的皮肤",切换时替换。

这个做法复用 100% 现有 `characterStore → rendering → presence`,改动最小,先验证复用性。

---

## 6. 免费内容 vs 付费内容(版本演进)

| 阶段 | 免费 | 付费 |
| --- | --- | --- |
| v1 冷启动 | 预置 4-6 个免费角色(现有 taro/yi/... ) | 上架 2-3 个先发套装 + 案例皮肤 |
| v2 | 开放用户自建导入(现状保留) | 商店 + 兑换码 + 锁定 |
| v3 | 创作中心|创作者上传 → 审核 → 分成 |

---

## 7. 里程碑与验收(Phase 0→4)

### Phase 0(本周基线,不改业务代码)
- [ ] 把所有角色从 `.Tianshu/characters/*` 与代码隔离与否审计:确认哪些是自有 IP,哪些要下架。
- [ ] 定一个 `DATA_DIR` 分离:本地数据(用户自造)与 store 内容分离目录。
- [ ] 审计 `export/import` 路由与 `asset-gc` 的现有边界(已读,本阶段只留笔记)。

### Phase 1(商店后端壳) 验收门槛:纯后端可跑通
- 新 repo `tianshu-store`(独立工程)。实现 users/licenses/devices/watermark 表 + JWT + `/redeem`+`/packages`。
- 单测:授权生命周期(兑换→续→吊销→换机)。
- CLI 生成/吊销兑换码。

### Phase 2(tianshu 商店集成) 验收:用户能装一款购买内容
- `src/store/*` + `routes/store` + 本地安装到现有 `characters/`。
- `GET /api/characters/:id/export` 对 store 内容 403。
- 前端:商店页真实目录+兑换码+安装/卸载。

### Phase 3(皮肤 + 水印) 
- skin product、skin install、skin rendering 切换。
- PNG watermark 实现(把 userId 焍进 PNG ancillary chunk 或 LSB,最低成本)。
- 内容版本升级(同 product 新版本覆盖)。

### Phase 4(支付接入 + 运营工具)
- Stripe/(或国内支付)回调 → 兑换码自动产码。
- 后台:兑换码批量生成/吊销、销售额、日志审计、内容上架工具(录制 `.tianshu-pack`,可用 CLI)。
- 吊销=本地授权缓存随后续签被拒 -> 角色退回锁定。

---

## 8. 代码改动清单(可见文件)

### Store Server(新工程 `tianshu-store/`)
```
src/
  index.ts             # Hono app 入口
  crypto/
    keys.ts            # 设备密钥、会话密钥工厂
    pack.ts            # 加密打包/解析 .tianshu-pack
    watermark.ts       # PNG/音频水印
  auth/device.ts       # deviceId 绑定 & deviceToken
  auth/license.ts      # 兑换/吊销/续签
  routes/              # /redeem /catalog /packages /my /license(webhook)
  db/schema.ts
tests/                 # vitest
scripts/make-code.mjs  # 后台 CLI
scripts/build-pack.mjs # 打包发布
```

### tianshu server(改造)
```
src/store/{config,license,pack,install,watermark,productSource}.ts
src/routes/store.ts
src/routes/characters.ts        # export 拦截 add 403
src/db/characterStore.ts        # product_source 字段
src/character/visual-store.ts   # skin 目录感知(Phase 3)
src/character/asset-refs.ts      # store 资产保护的例外处理
```

### tianshu client(改造)
```
src/api/store.ts
src/pages/StorePage.tsx          # 新的真商店页(替换假 MarketPage 数据)
src/pages/CharacterDetailPage.tsx # 皮肤 tab(P3)
src/stores/licenseStore.ts        # 授权状态管理
src/components/…(兑换码弹窗/锁卡片)
```

---

## 9. 加密细节(交给实现但先定死)

- 哈希与篡改:每个 `pack` 在 store 侧签名(`Ed25519` 服务器私钥),tianshu 内置服务器公钥,装前验签。
- 非对称:设备用 `X25519` 会话包裹 content.key;无 RSA 大 blob 更安全。
- 对称:`AES-256-GCM`,用随机 IV,不重用。
- JWT:HS256 由 store 签名;tianshu 只存验签公钥,不持任何可发新授权的密钥。
- 时间敏感:JWT 2h 内必须在线续签,小时级过期节奏反相使共享码价值大降。

---

## 10. "为什么不能完全防住" —— 开放立场

任何本地程序都能被逆向(密钥总在进程内存里,有人可以下 hook)。方案 B 是**提高成本**而不是**天衣无缝**:

> 破解路径成本 ≈ 需要逆向 Node/AES + 伪造设备 + 写下发客户端软件 + 维护更新,所有破解活跃持续消耗;
> 而花不到 10 元一次购买的成本 << 破解成本。

当体量大到有人专门破解时再加:内容在线流式、渲染端加壳、硬件指纹、设备黑名单。

---

## 11. 后续一个月排期(建议)

```
Week1  Phase0-1  商店后端壳 + .tianshu-pack 打包器 + 兑换/JWT 单测
Week2  Phase2   tianshu 端 client+install+frontend 商店页/兑换
Week3  Phase3   皮肤模型 + 水印 + 换机重绑
Week4  Phase4   支付回调 + 运营后台 + 上线免费角色,试点售卖 1-2 个付费套装
```
每阶段结束跑:server 构建 + client 构建 + 目标测试(做法与 `rebuild-run.bat` 一致)。

---

## 12. 你要现在拿些什么决定

1. **你的 store server 部署在哪?**(个人的 VPS / Docker / 云函数 / CF Workers)
   → 影响 store server 的持久层选型(本地 SQLite / 云数据库)。
2. **支付渠道**:后期 Stripe / 国内微信支付 / 支付宝,或先手工收款 + 兑换码。
3. **是否开放内容创作者(creator)** —— 决定 v3 是否开放创作。

先把第 1 项定下来,Phase 0+1 即可开工。