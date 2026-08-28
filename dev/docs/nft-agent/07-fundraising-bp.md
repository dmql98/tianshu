# Tianshu — Fundraising Pitch Deck (BP) v1

> 版本：v1 草案（2026-08-27）
> 用途：面向海外 VC 的融资 BP。英文为主体，中文要点附后。
> 诚实声明：产品与技术事实基于真实现状；**用户/收入/团队履历等敏感数据一律以 [TBD] 占位，投递前必须由创始团队补齐**。本 BP 不虚构任何数字。
> 配套文档：05-overseas-regulatory.md（海外监管）、06-overseas-fundraising-landscape.md（融资环境与对标）、01~04（国内调研/产品方案/资产格式）。

---

# PART 1 — ENGLISH (Pitch Deck Body)

## 1. Elevator Pitch

**Tianshu turns AI agents into ownable digital assets.**

We are building a desktop AI-agent operating system where characters are not just chatbots — they are composable, runnable, ownable assets made of four layers: **visual skin, personality, capability, and memory**. Users buy, customize, share, and (optionally, in a regulated form) collect these characters like game skins. Creators package and sell their tuned agents, earning a share — a Steam-skin economy × Character.ai ecosystem × Roblox creator economy, built for the agent era.

---

## 2. Problem

1. **Agents are commoditized.** Every LLM vendor ships the same "assistant." Users have no identity, no attachment, no reason to stay.
2. **The "companion" category proved demand but hit a ceiling.** Character.ai validated that people love AI characters, but pure chat subscriptions top out; the platform is already pivoting to serialized content (c.ai Series, July 2026).
3. **Nobody owns the "agent as an asset" layer.** GPT Store sells workflows. Roblox sells worlds. No one sells *the character itself* — the persona + capabilities + memory + skin as a portable, ownable unit.
4. **NFT narratives are dead in the West.** Trading volumes collapsed ~90%+ after 2021's peak; 95% of collections were worthless by 2023. The asset story must be *utility + collectibility*, not speculation. We agree — and design accordingly.

---

## 3. Solution

**Tianshu = a desktop Agent OS where every character is a four-layer asset:**

| Layer | What it is | Why it's valuable |
|---|---|---|
| **Visual** | Portrait, avatar, 6 live animations (idle/thinking/working/speaking/success/error) | Ownership & identity — the "skin" |
| **Personality** | Structured trait params + soul.md persona definition | The "character" — how it talks, judges, works |
| **Capability** | Skill packages, tool bindings, MCP servers, run policy | What it can *actually do* — real productivity |
| **Memory** | Background story, knowledge base, seed memories | Depth & continuity — the "history" |

A character asset is packaged as a portable file (`.tchar` / `.tskin`), importable/exportable, verifiable (content-hash manifest), and bindable to any host runtime. **User-private data (chat logs, learned memories) never enters the asset package** — an important trust & privacy boundary.

---

## 4. Why Now (Market)

- **AI companion/character category is proven.** Character.ai reached a $1B valuation in 2023; Google acquired its founder + tech license in 2024. Replika, Talkie, and others show durable willingness to pay for characters.
- **Digital goods are a massive, proven economy.** Morgan Stanley projected the in-game cosmetic/NFT goods market could reach **$56B by 2030**. CS:GO skins alone sustain a multi-billion-dollar trading economy.
- **Agents need a business model.** Every VC is asking "how do agents make money?" Subscriptions and usage fees are the only answers so far. **Ownable agent assets are the missing layer.**
- **Regulatory window is favorable for the compliant.** EU AI Act transparency (Aug 2026) and US SEC enforcement (Stoner Cats, 2023) both reward the same design: sell a *license*, not a security. We designed for this from day one.

---

## 5. Product (What exists today — built, pre-launch)

**The client is built and feature-complete. It has not yet been distributed to users — we plan one launch: client + marketplace together.**

**Already built (a working desktop client, not a concept):**

- Desktop agent runtime with multi-character support; **7 built-in characters** (executive secretary 小红, tarot reader, Ziwei dou shu, I-Ching, coder, UI designer, worker).
- **Character/Skin decoupling system**: characters bind a `skinId`; skins live in `skin/<id>/` with portrait + avatar + 6 named animations; renderer resolves by active skin.
- **Agent capability framework**: per-character skill packages, tool bindings, MCP server mounts, run policy (steps, strategies, approvals).
- **Data model is asset-ready**: `character.json` (id/name/color/memory/skills/tools/runPolicy/skinId), `soul.md` (persona), `visual.json` + `assets.json` (animation registry) — all already structured for the four-layer asset format.

**Honest status — what is NOT done:**
- **No public distribution yet** (0 end users so far); the marketplace layer (wallet, escrow, storefront) is not built.
- **Launch strategy: one launch.** We ship the marketplace and the client together, so users land on a complete product (own → customize → create → trade) instead of a half-product that needs a second push. This avoids two cold-starts and two GTM campaigns; the tradeoff (no user feedback before building the market) is mitigated by a **planned closed beta (50–100 seed users, 3–4 weeks, simulated-balance testing — see plan doc)** that will supply demand signals, quotes, and demo footage before the full launch.

**Roadmap (M0→M3):**
- M0: Asset packaging (`.tchar`/`.tskin` import/export) + asset library UI — in progress
- **M1: Character Store & fiat escrow marketplace (wallet, take-rate, creator payouts) — this round's primary build, ships with the client**
- M2: Creator workbench (4-layer packaging, review flow, creator economy)
- M3 (optional): Regulated lightweight on-chain collectible certificate (metadata hash only, alliance chain / compliant design)

---

## 6. Business Model

**Settlement model: a fiat escrow marketplace** (Steam-market logic — not a token economy), built on a **single fiat wallet**:

| Revenue stream | Share (est.) | Notes |
|---|---|---|
| Marketplace fee (escrow trades) | ~35% | Sliding take rate by cumulative sales: 13% (1–3), 10% (4–6), 8% (7–10), 5% (10+); Steam-market logic |
| Official character/skin sales | ~25% | First-party items + creator revenue share |
| Model API service | ~15% | Tianshu API billed from wallet by usage = upstream cost +5%, no free quota; **BYOK open to all users** — any OpenAI-compatible provider (incl. opencode go/zen), pass-through, never touches the wallet |
| Asset minting fee | ~10% | Creating assets costs fiat wallet balance only (token cost +20%); **first mint free per account** |
| Subscription (optional) | ~10% | Asset library capacity, creator pro tools, cloud backup |
| Enterprise custom characters | ~5% | Branded agents/digital humans for teams |

**Mechanics:** users top up one fiat wallet (RMB via licensed PSPs domestically; USD via Stripe/Adyen abroad). Calling Tianshu's own API (chat, tools, agent runs) deducts from this wallet by usage at **upstream cost +5%** (no free quota). **BYOK is open to all users** — bring any OpenAI-compatible provider key (OpenAI, Anthropic, or aggregator gateways like opencode go/zen); those calls pass through to the external provider and never touch our wallet (transparent pass-through token billing, no markup, no restrictions). **One hard rule: minting tradable assets is payable ONLY from the wallet balance** (anti-arbitrage & compliance closure) at **token cost +20%** — external keys or platform points can never mint assets; each account gets **one free mint** as an acquisition hook. Assets sell as **N-copy usage licenses** through platform-escrowed transactions with a **sliding take rate by cumulative sales (13%→5%)**; creators settle in fiat — **wallet spending is instant, withdrawals are T+1, ¥20 minimum**, tax-handled (anti-money-laundering standard practice). Free listings (¥0) are allowed for community building; no gifting/transfer outside the market.

**Pricing principle:** low-ticket, high-frequency (game-skin logic: $0.2–$20), NOT high-ticket speculation (PFP logic). Explicitly position purchases as **licenses + collectible records — never investment products, no transferable tokens, no resale-value promises.**

---

## 7. Competition & Differentiation

| Player | What they sell | Gap |
|---|---|---|
| Character.ai | Chat with characters (subscription) | Conversation only; no asset ownership, no capability layer |
| Replika / Talkie | Companion chat, virtual gifts | Emotion-centric; no productivity/agent value |
| GPT Store / Coze / Dify | Workflows / bots | No personality-skin-memory package; weak monetization |
| Roblox / Steam | Worlds / skins | Not AI agents; no personality or capability |

**Tianshu's wedge:** "Character.ai sells conversations. Roblox sells worlds. **We sell the characters themselves** — runnable, ownable assets (persona + capability + memory + skin)."

---

## 8. Regulatory Strategy (why we're investable, not exposed)

Designed compliant from day one, per verified regulation:

- **US (SEC)**: We operate a **fiat-escrowed marketplace for licensed digital goods** (Steam-market model) — **no transferable tokens, no token economy, no resale-value promises, no trading royalties, no "earn/appreciate" language** — the exact triggers the SEC found illegal in Stoner Cats (2023-178, settled $1M) and Impact Theory ([verify]). User-to-user sales are escrowed license transfers priced in fiat, keeping us outside the Howey "investment contract" definition.
- **EU (AI Act, in force Aug 2026)**: Chatbot transparency (disclose "you are talking to an AI"), AI-content labelling, no exploitative practices. Built-in.
- **EU (MiCA)**: Unique non-fungible collectibles are outside scope; we avoid fungible token collections and any redeemable/transferable token.
- **China (domestic ops)**: Fiat marketplace only — no virtual currency, no transferable points (per the 2021 PBOC ten-agency notice and the 2022 《数字藏品应用参考》); digital-publishing-product path for any optional on-chain certificate; no financialization. (See companion report.)
- **On-chain (optional M3)**: metadata-hash certificates only — no token economies, no trading.

---

## 9. Traction & Milestones

**Honest snapshot: product built (pre-launch), marketplace to build — one launch together.**

| Item | Status |
|---|---|
| Product | Desktop agent client **built & feature-complete** (7 characters, skin system, capability framework) — **not yet distributed** |
| Marketplace | **Not built** — commercial & compliance design done (§6/§8); M1 is the primary build of this round |
| Users / retention | **Closed beta planned (50–100 seed users, 3–4 weeks, simulated-balance) — see plan; results to fill here** |
| Revenue | **[TBD — pre-launch]** |
| Launch | **One launch: client + marketplace together** (complete-product cold start) |
| M2 creator economy | Q? 2027 (target, gated on M1 conversion) |

---

## 10. Team

**[TBD — founder bios, prior exits, advisors to be added by founders.]**
*(Recommendation: highlight any prior startup/engineering leadership, AI/desktop-tool experience, and design/community skills.)*

---

## 11. The Ask

- **Round**: Seed (product built pre-launch; marketplace to build — classic seed profile)
- **Raise**: **[TBD]** (guidance: $1.5M–$5M)
- **Use of funds**:
  - Product: **M1 marketplace** — wallet, escrow engine, storefront, payouts (45%)
  - Creator tools & community (20%)
  - Compliance/legal & **corporate setup (new clean entity)** (15%)
  - GTM & design (20%)
- **Key milestones with funding**: M1 marketplace launch + first paid cohort; creator onboarding; EU/US-ready compliance pass.

---

## 12. Risk & Mitigation

| Risk | Mitigation |
|---|---|
| "NFT = bubble" perception | Lead with utility/license narrative; on-chain only as optional certificate |
| Paid-skin demand unproven for agents | Low-cost pilot store; game-skin pricing; gate M2/M3 on M1 conversion |
| **Product not yet launched (0 users, market not built)** | Client is built & feature-complete (execution risk removed); deliberate **one-launch strategy** (client + market together) to avoid two cold-starts; **closed beta (50–100 users) before full launch to validate demand** (see plan) |
| Big platforms copy | Desktop-native + capability layer is hard to clone; creator ecosystem moat |
| Regulatory drift | Compliance-first design; legal review before any launch |
| Data/privacy | User data never packaged into assets; local-first storage |

---

# PART 2 — 中文导读与说明（给创始团队）

## 一、BP 使用说明
1. **英文主体（PART 1）可直接投递**，共 12 节：定位/问题/方案/时机/产品/商业模式/竞争/合规/进展/团队/融资需求/风险。
2. 投递前必须补齐的 [TBD]：**用户/留存/收入数据（第 9 节）、团队履历（第 10 节）、融资金额与估值（第 11 节）**。
3. 海外 VC 习惯：BP 之外再准备 **1 页 Executive Summary** 和 **3-5 分钟产品录屏**（重点演示角色管理 + 皮肤系统 + 资产打包）。

## 二、叙事红线（务必遵守）
- ❌ 不要以「NFT」为主叙事——海外 VC 对 NFT 已过敏（2021 泡沫崩塌，95% 藏品归零）。
- ✅ 主叙事 =「**AI Agent 即资产**」：可拥有的四层角色（皮肤/人格/能力/记忆），对标 Steam 皮肤经济 × Character.ai × Roblox 创作者经济。
- ✅ 上链只作为「可选收藏凭证」，BP 中一句话带过，绝不承诺交易/升值。
- ✅ 合规前置是加分项：EU AI Act 透明度和 SEC 证券红线（Stoner Cats 案）我们天然规避。

## 三、需要老板补齐/决策的清单
1. **真实运营数据**（哪怕很小：安装量、DAU、留存、任何付费/内测转化）——这是「非虚构 traction」的最强证明。
2. **团队履历**（创始人背景、此前项目、分工、顾问）。
3. **融资额与估值区间**（参考 06 文档：Seed $3-8M pre-money / Pre-A $8-20M，需复核市场均值）。
4. **海外主体架构**（开曼 SPV / Delaware C-Corp 等）——融资前提。
5. **是否面向海外用户运营**：若出海，产品需过 EU AI Act 透明度（角色明示 AI、内容标识）与未成年人保护。

## 四、配套交付物（已就绪）
| 文档 | 内容 |
|---|---|
| 05-overseas-regulatory.md | 海外监管全貌（美/欧/英），来源标注 |
| 06-overseas-fundraising-landscape.md | 融资环境、对标案例、估值锚点、投资人画像 |
| 01~04 | 国内竞品/监管/资产格式/产品方案（BP 支撑材料） |

---

*本 BP 中所有事实性产品描述基于天枢真实现状（已核查 dataDir 结构与代码文档）；所有标注 [TBD] 或 [verify] 的数据必须由创始团队核实后填写。不构成投资建议。*
