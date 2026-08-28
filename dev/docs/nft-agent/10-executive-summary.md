# Tianshu — Executive Summary (One-Pager)

> 用途：投递邮件附件 / 首次会议前背景材料。一页英文，投递给海外 VC。
> 状态：v1（2026-08-27）。**标注 [TBD] 处投递前由创始团队补齐**；产品现状如实描述（客户端已建、未分发，市场待建，一次发布策略，封闭内测计划见 11 文档）。

---

## Tianshu — Ownable AI Characters: The Missing Business Layer for Agents

**One-liner.** Tianshu turns AI agents into ownable, runnable digital assets — characters with four layers (visual skin, personality, capability, memory) that users can buy, sell, and customize, and creators can package and monetize. A Steam-skin economy × Character.ai ecosystem × Roblox creator economy, built for the agent era.

**Problem.** Agents are being commoditized. Every LLM vendor ships the same assistant; users have no attachment and no reason to stay. Character.ai proved people love AI characters but hit a ceiling on pure chat subscriptions (it is already pivoting to serialized content). GPT Store sells workflows, Roblox sells worlds — **no one sells the character itself as an ownable asset**. Meanwhile, "NFT" as a speculation story is dead in the West; the winning design is *utility + collectibility* with a license, not a security.

**Solution.** A desktop Agent OS where every character is a portable four-layer asset (`.tchar`/`.tskin`): **visual** (portrait/avatar/6 live animations), **personality** (structured traits + persona definition), **capability** (skills, tools, MCP, run policy), **memory** (background, knowledge, seeds). User-private data never enters the asset package — a trust and privacy boundary competitors don't have.

**Status (honest).** The desktop client is **built and feature-complete** (multi-character runtime, 7 built-in characters, character/skin decoupling, skill/tool/MCP capability framework, asset-ready data model) but **not yet distributed to users**. The marketplace layer (wallet, escrow, storefront) is **not built** — that is this round's primary build. **Launch strategy: one launch** — client + marketplace ship together as a complete product (own → customize → create → trade), avoiding two cold-starts; demand is validated ahead of launch via a **planned closed beta (50–100 users, simulated-balance testing)**. Full commercial/compliance design is already done (below).

**Business model — fiat escrow marketplace (Steam logic, no token economy).** Single fiat wallet; users buy/sell licensed assets through platform-escrowed trades; sliding take rate by cumulative sales (13% → 5%); creators withdraw in fiat (¥20 min, T+1; instant in-wallet spending). Minting tradable assets is payable **only from the wallet balance** (anti-arbitrage & compliance closure) at token cost +20%; first mint free. Tianshu API billed at upstream +5% (no free quota); **BYOK open to all users** — any OpenAI-compatible provider (incl. opencode go/zen) passes through, never touching our wallet.

**Market.** AI characters are a proven category (Character.ai $1B valuation; Google acquired its founder + tech license in 2024). Digital goods are proven at scale (Morgan Stanley: in-game cosmetic/NFT goods could reach **$56B by 2030**). Every VC is asking "how do agents make money?" — ownable agent assets are the missing answer.

**Competition.** Character.ai sells conversations; Replika/Talkie sell emotion; GPT Store/Coze sell workflows; Roblox/Steam sell worlds/skins. **We sell the characters themselves** — the only player combining personality + capability + memory + skin as a portable, ownable, monetizable unit on a desktop agent runtime.

**Compliance (designed-in, a selling point).** Fiat-only, no transferable tokens, no resale-value promises — the exact triggers the SEC found illegal in Stoner Cats (2023, $1M settlement). EU AI Act transparency (chatbots must disclose they're AI, Aug 2026) built in. MiCA: unique collectibles out of scope. Designed to be investable, not exposed.

**Milestones with funding.** M1 marketplace launch (wallet, escrow, storefront, payouts) + first paid cohort; creator onboarding; EU/US-ready compliance pass.

**Ask.** Seed round, **[TBD amount, guidance $1.5M–$5M]**, primarily to build the marketplace layer and launch the complete product (client + market). **[TBD — users/retention (pre-launch), team, valuation]**.

**Contact.** **[TBD — founder name/email/calendly]**

---

*配套材料：完整 BP（07-fundraising-bp.md）、产品录屏（待补）、投资人清单（09）、合规报告（05/02）、资产格式设计（03）。*
