import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT = "C:\\Users\\dmql\\Documents\\tianshu\\dev\\融资材料\\天枢AI_Agent融资商业计划书_投资人版.pptx";
const BUILD = "C:\\Users\\dmql\\Documents\\tianshu\\dev\\融资材料\\.ppt_build_tianshu";
const ASSET = "C:\\Users\\dmql\\Documents\\tianshu\\dev\\融资材料";
const ROOT = "C:\\Users\\dmql\\Documents\\tianshu\\dev";

const C = {
  ink: "#111318",
  muted: "#60656F",
  light: "#F2F4F7",
  panel: "#E9EEF3",
  rule: "#C9CED6",
  blue: "#3D8DFF",
  cyan: "#6DCBF4",
  pale: "#EAF5FB",
  green: "#16A36A",
  red: "#D94B54",
  white: "#FFFFFF",
};
const FONT = "Microsoft YaHei";

async function blob(file) {
  const bytes = await fs.readFile(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function textbox(slide, text, x, y, w, h, opts = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name: opts.name,
    position: { left: x, top: y, width: w, height: h },
    fill: opts.fill ?? "none",
    line: { style: "solid", fill: opts.line ?? "none", width: opts.lineWidth ?? 0 },
  });
  shape.text = text;
  shape.text.style = {
    typeface: FONT,
    fontSize: opts.size ?? 24,
    bold: opts.bold ?? false,
    color: opts.color ?? C.ink,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
  };
  return shape;
}

function rect(slide, x, y, w, h, fill = C.light, line = "none", radius = false) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
    ...(radius ? { borderRadius: "rounded-xl" } : {}),
  });
}

function rule(slide, x, y, w, color = C.rule, width = 1) {
  return slide.shapes.add({
    geometry: "straightConnector1",
    position: { left: x, top: y, width: w, height: 0 },
    fill: "none",
    line: { style: "solid", fill: color, width },
  });
}

function notes(slide, items) {
  slide.speakerNotes.textFrame.setText(`[Sources]\n${items.map((x) => `- ${x}`).join("\n")}`);
}

function chrome(slide, index, section) {
  textbox(slide, section.toUpperCase(), 42, 32, 330, 28, { size: 15, bold: true, color: C.blue });
  textbox(slide, String(index).padStart(2, "0"), 1185, 660, 52, 24, { size: 14, color: C.muted, align: "right" });
}

function title(slide, text, subtitle, index, section) {
  chrome(slide, index, section);
  textbox(slide, text, 42, 70, 1196, 62, { size: 38, bold: true });
  if (subtitle) textbox(slide, subtitle, 42, 140, 1110, 54, { size: 19, color: C.muted });
}

function addBulletList(slide, items, x, y, w, size = 21, gap = 46, color = C.ink) {
  items.forEach((item, i) => {
    textbox(slide, "•", x, y + i * gap, 26, 30, { size, bold: true, color: C.blue });
    textbox(slide, item, x + 30, y + i * gap, w - 30, 38, { size, color });
  });
}

const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

// 1. Cover — adapted from Codex Grid slide 08 (half text / half image).
{
  const s = deck.slides.add();
  s.background.fill = C.white;
  textbox(s, "TIANSHU · INVESTOR DECK", 42, 38, 420, 28, { size: 15, bold: true, color: C.blue });
  textbox(s, "让能干活的 Agent，\n成为用户愿意长期拥有的角色", 42, 142, 565, 250, { size: 48, bold: true });
  textbox(s, "天枢 AI Agent", 42, 438, 565, 45, { size: 26, bold: true });
  textbox(s, "Windows 桌面端 MVP 已完成 · 融资商业计划书 · 2026.08", 42, 500, 550, 70, { size: 18, color: C.muted });
  rect(s, 650, 38, 588, 592, C.pale, C.rule, true);
  s.images.add({ blob: await blob(path.join(ASSET, "会话、角色、模型、执行模式、审批与项目目录被统一到一个本地桌面工作环境。.png")), contentType: "image/png", alt: "天枢 Windows 客户端工作台", fit: "contain", position: { left: 670, top: 62, width: 548, height: 544 }, geometry: "roundRect", borderRadius: "rounded-xl" });
  notes(s, ["项目提供的天枢 Windows 客户端截图", "项目融资材料与产品实现说明"]);
}

// 2. Thesis — adapted from Codex Grid slide 11 (comparison).
{
  const s = deck.slides.add();
  title(s, "现有产品各自只解决一半问题", "天枢把可靠执行与角色资产放进同一个本地工作环境。", 2, "Investment thesis");
  textbox(s, "生产力 Agent", 42, 240, 580, 42, { size: 28, bold: true });
  textbox(s, "能调用工具、写代码、处理文件\n但缺少长期关系、视觉资产与情绪消费", 42, 296, 540, 92, { size: 22, color: C.muted });
  rect(s, 42, 416, 580, 112, C.light, "none", true);
  textbox(s, "结果价值强，拥有感弱", 72, 447, 520, 46, { size: 26, bold: true });
  textbox(s, "陪伴型 AI", 658, 240, 580, 42, { size: 28, bold: true });
  textbox(s, "有人格、记忆与形象\n但不能稳定完成真实工作任务", 658, 296, 540, 92, { size: 22, color: C.muted });
  rect(s, 658, 416, 580, 112, C.light, "none", true);
  textbox(s, "情绪价值强，任务能力弱", 688, 447, 520, 46, { size: 26, bold: true });
  textbox(s, "天枢 = 可恢复的 Agent 运行时 + 可运营的角色资产", 42, 586, 1196, 48, { size: 28, bold: true, color: C.blue, align: "center" });
  notes(s, ["项目产品定位与竞品分析（项目方提供）"]);
}

// 3. Product proof.
{
  const s = deck.slides.add();
  title(s, "MVP 已经是可安装、可运行的 Windows 产品", "会话、角色、模型、执行模式、审批与项目目录被统一到一个桌面工作环境。", 3, "Product proof");
  s.images.add({ blob: await blob(path.join(ASSET, "会话、角色、模型、执行模式、审批与项目目录被统一到一个本地桌面工作环境。.png")), contentType: "image/png", alt: "天枢 Windows 客户端主界面", fit: "contain", position: { left: 42, top: 214, width: 812, height: 414 }, geometry: "roundRect", borderRadius: "rounded-xl" });
  textbox(s, "已完成", 900, 226, 280, 38, { size: 24, bold: true, color: C.blue });
  addBulletList(s, ["EXE 安装包", "多模型与 MCP 接入", "Goal / Plan / RunEvent", "审批、恢复与事件系统", "角色版本与多 Asset"], 900, 286, 320, 20, 58);
  notes(s, ["项目提供的天枢 Windows 客户端截图", "项目代码与 MVP 功能清单"]);
}

// 4. Persistent execution.
{
  const s = deck.slides.add();
  title(s, "差异不在“能回答”，而在“能持续完成”", "长任务先形成计划，再逐步执行；每一步都保留条件、状态与结果证据。", 4, "Execution moat");
  s.images.add({ blob: await blob(path.join(ASSET, "详细计划设计-执行-校验.png")), contentType: "image/png", alt: "详细计划设计、执行与校验界面", fit: "contain", position: { left: 42, top: 210, width: 790, height: 424 }, geometry: "roundRect", borderRadius: "rounded-xl" });
  const ys = [228, 338, 448];
  [["01", "设计", "把目标拆成可验证步骤"], ["02", "执行", "持久记录状态与工具结果"], ["03", "校验", "证据门禁减少“看似完成”"]].forEach((row, i) => {
    textbox(s, row[0], 880, ys[i], 54, 34, { size: 18, bold: true, color: C.blue });
    textbox(s, row[1], 944, ys[i], 200, 34, { size: 26, bold: true });
    textbox(s, row[2], 944, ys[i] + 42, 270, 54, { size: 18, color: C.muted });
  });
  notes(s, ["项目提供的长任务计划—执行—校验截图", "项目执行运行时设计说明"]);
}

// 5. Dual value — adapted from Codex Grid slide 13 (four points).
{
  const s = deck.slides.add();
  title(s, "同一个角色同时产生结果价值与情绪价值", "共享角色、记忆、模型和工具基础设施，却形成两类付费动机。", 5, "Dual value engine");
  const blocks = [
    [42, 218, "完成任务", "研究、文件、代码、运营与自动报告\n用户为可靠结果付费"],
    [658, 218, "降低门槛", "专业技能角色包把复杂配置\n变成一键购买的生产力商品"],
    [42, 424, "长期拥有", "人格、记忆、形象与动作形成关系\n用户为喜欢的角色与空间付费"],
    [658, 424, "持续表达", "换肤、主题、限定内容与 IP 联动\n推动复购与分享传播"],
  ];
  blocks.forEach(([x, y, h, b], i) => {
    textbox(s, String(i + 1).padStart(2, "0"), x, y, 50, 28, { size: 16, bold: true, color: i < 2 ? C.blue : C.green });
    textbox(s, h, x, y + 34, 540, 42, { size: 28, bold: true });
    textbox(s, b, x, y + 84, 548, 70, { size: 20, color: C.muted });
  });
  notes(s, ["项目价值主张与商业模式设计（项目方提供）"]);
}

// 6. Role asset strip.
{
  const s = deck.slides.add();
  title(s, "角色不是提示词，而是一套可运营的多状态资产", "现有多 Asset 容器让生成内容直接成为可安装、可使用、可交易的角色商品。", 6, "Agent asset");
  const names = ["交谈", "呼吸", "查询", "工作", "成功", "报错"];
  const labels = ["交谈", "呼吸", "查询", "工作", "成功", "异常"];
  for (let i = 0; i < names.length; i++) {
    const x = 42 + i * 201;
    s.images.add({ blob: await blob(path.join(BUILD, "frames", `${names[i]}.png`)), contentType: "image/png", alt: `${labels[i]}状态角色资产`, fit: "cover", position: { left: x, top: 216, width: 174, height: 278 }, geometry: "roundRect", borderRadius: "rounded-xl" });
    textbox(s, labels[i], x, 510, 174, 32, { size: 19, bold: true, align: "center" });
  }
  textbox(s, "角色状态与 Agent Run 状态绑定：不是装饰，而是执行过程的可视化反馈。", 42, 590, 1196, 40, { size: 24, bold: true, align: "center", color: C.blue });
  notes(s, ["项目提供的 character assets GIF；PPT 使用各 GIF 的首帧以保证兼容性", "项目多 Asset 与动作状态实现"]);
}

// 7. AI generation pricing — adapted from Codex Grid slide 23 (pricing).
{
  const s = deck.slides.add();
  title(s, "角色生成把模型调用转化为数字商品", "文生图设计形象，图生视频生成六种动作，自动打包为可交易角色。", 7, "AI role generation");
  const cols = [42, 453, 864];
  const data = [
    ["模型订阅", "更强模型、更高额度\n构成基础现金流", "59 元", "/ 月"],
    ["六状态动态角色", "交谈、呼吸、查询\n工作、成功、异常", "19 元", "/ 个"],
    ["高级定制 / 商用", "品牌化设计、专属动作\n与商用授权支持", "49 元起", ""],
  ];
  data.forEach((d, i) => {
    rect(s, cols[i], 214, 374, 416, i === 1 ? C.pale : C.light, i === 1 ? C.cyan : "none", true);
    textbox(s, d[0], cols[i] + 26, 250, 322, 42, { size: 25, bold: true });
    textbox(s, d[1], cols[i] + 26, 318, 322, 110, { size: 20, color: C.muted });
    textbox(s, "建议定价", cols[i] + 26, 494, 180, 28, { size: 16, color: C.muted });
    textbox(s, d[2], cols[i] + 26, 536, 210, 54, { size: 34, bold: true, color: i === 1 ? C.blue : C.ink });
    textbox(s, d[3], cols[i] + 230, 552, 90, 30, { size: 17, color: C.muted });
  });
  notes(s, ["角色生成价格为项目方当前商业化假设：六状态动态包 19 元，高级定制 49 元起"]);
}

// 8. Marketplace loop.
{
  const s = deck.slides.add();
  title(s, "每个用户既是买家，也可能成为角色创作者", "生成—使用—上架—交易形成比单次模型订阅更长的收入链。", 8, "Creator marketplace");
  const steps = [
    [70, "01", "免费工具获客", "降低首次使用门槛"],
    [365, "02", "付费生成角色", "19 / 49 元价格带"],
    [660, "03", "自用或上架", "角色、技能、皮肤、场景"],
    [955, "04", "交易持续分成", "创作者 80% · 平台 20%"],
  ];
  rule(s, 110, 344, 1030, C.rule, 2);
  steps.forEach(([x, n, h, b], i) => {
    rect(s, x, 242, 230, 206, i === 3 ? C.pale : C.light, "none", true);
    textbox(s, n, x + 24, 264, 50, 28, { size: 16, bold: true, color: C.blue });
    textbox(s, h, x + 24, 306, 185, 58, { size: 24, bold: true });
    textbox(s, b, x + 24, 382, 185, 44, { size: 17, color: C.muted });
  });
  textbox(s, "平台提供分发、支付、安全、审核与评价；内容供给反过来降低获客成本。", 150, 520, 980, 62, { size: 25, bold: true, align: "center", color: C.blue });
  notes(s, ["项目平台交易与创作者分成假设：平台标准抽成 20%，创作者 80%"]);
}

// 9. Business model.
{
  const s = deck.slides.add();
  title(s, "OpenCode 验证模型订阅，天枢继续延伸角色经济", "免费工具获客之后，同一用户可以订阅模型、购买生成、消费内容并参与交易。", 9, "Business model");
  const rows = [
    ["流量层", "免费工具与免费模型", "免费", "搜索、社区、分享与口碑"],
    ["收入 1", "官方模型订阅", "59–99 元/月", "更强模型、额度与稳定服务"],
    ["收入 2", "AI 角色生成", "19 元 / 49 元起", "文生图 + 图生视频 + 自动打包"],
    ["收入 3", "官方技能 / 角色包", "29–299 元", "直接交付专业任务结果"],
    ["收入 4", "创作者 Marketplace", "平台抽成 20%", "用户上架，平台持续分成"],
    ["增量", "皮肤、IP、Team / Enterprise", "消费 / 席位 / 授权", "复购、组织治理与行业渠道"],
  ];
  const xs = [42, 178, 538, 765];
  const ws = [136, 360, 227, 473];
  ["收入层", "产品形态", "定价", "增长逻辑"].forEach((h, i) => textbox(s, h, xs[i] + 10, 212, ws[i] - 20, 32, { size: 17, bold: true, color: C.muted }));
  rows.forEach((r, ri) => {
    const y = 258 + ri * 62;
    if (ri % 2 === 0) rect(s, 42, y - 8, 1196, 56, C.light);
    r.forEach((v, ci) => textbox(s, v, xs[ci] + 10, y, ws[ci] - 20, 40, { size: ci === 0 ? 17 : 18, bold: ci === 0, color: ci === 0 ? C.blue : C.ink }));
  });
  textbox(s, "OpenCode Go：首月 5 美元，之后 10 美元/月，验证“免费工具 → 模型订阅”。", 42, 648, 1120, 28, { size: 14, color: C.muted });
  notes(s, ["OpenCode Go 官方页面（访问于 2026-08-11）：https://opencode.ai/go", "项目方商业模式与建议定价"]);
}

// 10. Market evidence.
{
  const s = deck.slides.add();
  title(s, "情绪价值已经被独立付费验证", "陪伴、记忆、语音、形象与换肤并非附属功能，而是成熟的消费动机。", 10, "Market evidence");
  const comps = [
    [42, "Character.AI", "c.ai+ 将更强模型、记忆、语音与聊天定制纳入订阅。"],
    [452, "Kindroid", "订阅覆盖长期记忆、语音、视频头像与自拍等角色体验。"],
    [862, "Codex Dream Skin", "主题库、在线 Studio 与社区投稿证明工具换肤可传播"],
  ];
  comps.forEach(([x, h, b], i) => {
    textbox(s, `0${i + 1}`, x, 232, 70, 30, { size: 16, bold: true, color: C.blue });
    textbox(s, h, x, 286, 360, 52, { size: 27, bold: true });
    rule(s, x, 354, 330, C.rule, 1);
    textbox(s, b, x, 382, 350, 124, { size: 20, color: C.muted });
  });
  textbox(s, "天枢的不同：情绪资产与真实任务执行共享同一个角色。", 42, 570, 1196, 44, { size: 28, bold: true, align: "center", color: C.blue });
  notes(s, ["Character.AI c.ai+ 官方订阅页（访问于 2026-08-11）：https://character.ai/subscribe", "Kindroid 官方订阅说明（更新于 2026-07-07）：https://kindroid.ai/docs/article/subscriptions/", "Codex Dream Skin GitHub：https://github.com/Fei-Away/Codex-Dream-Skin"]);
}

// 11. Open ecosystem / MCP.
{
  const s = deck.slides.add();
  title(s, "开放适配降低切换成本，把价值留在编排层", "用户可扫描并一键导入 OpenCode、Claude、Cursor 等主流工具的现有 MCP 配置。", 11, "Technology moat");
  s.images.add({ blob: await blob(path.join(ASSET, "mcp接入.png")), contentType: "image/png", alt: "天枢 MCP 服务导入界面", fit: "contain", position: { left: 42, top: 214, width: 756, height: 416 }, geometry: "roundRect", borderRadius: "rounded-xl" });
  addBulletList(s, ["多模型 Provider", "MCP 服务管理", "技能与角色工具解析", "本地工作区与审批", "避免模型与工具锁定"], 850, 246, 350, 21, 66);
  notes(s, ["项目提供的 MCP 接入截图", "项目开放适配与本地优先架构说明"]);
}

// 12. Roadmap — adapted from Codex Grid slide 17 timeline.
{
  const s = deck.slides.add();
  title(s, "18 个月完成付费、市场与生态三次跃迁", "生成能力和交易市场按阶段验证，避免一次性承担全部平台风险。", 12, "Roadmap");
  rule(s, 70, 360, 1100, C.ink, 2);
  const ms = [
    [70, "M0–M3", "稳定", "安装升级、崩溃恢复\n真实 Provider E2E\n3 个设计伙伴"],
    [355, "M4–M6", "付费", "模型订阅\n文生图角色生成 Beta\n验证 19 / 49 元价格带"],
    [640, "M7–M12", "市场", "图生视频与动态打包\n用户角色上架\n平台 20% 抽成"],
    [925, "M13–M18", "生态", "换肤体系、SDK、IP 联名\n生成—使用—交易闭环\n形成下一轮数据"],
  ];
  ms.forEach(([x, label, h, b], i) => {
    rect(s, x, 352, 14, 14, C.blue, "none", true);
    textbox(s, label, x, 300, 180, 32, { size: 18, bold: true, color: C.blue });
    textbox(s, h, x, 402, 180, 38, { size: 26, bold: true });
    textbox(s, b, x, 454, 240, 130, { size: 18, color: C.muted });
  });
  notes(s, ["项目方 18 个月产品与商业化路线图"]);
}

// 13. Conservative financial model — chart evidence inspired by Codex Grid slide 21.
{
  const s = deck.slides.add();
  title(s, "保守模型只计算订阅与皮肤，仍可形成千万元收入", "未计入 AI 角色生成、技能包、市场抽成、企业客户和 IP 联名。", 13, "Financial model");
  s.charts.add("bar", {
    position: { left: 42, top: 214, width: 730, height: 388 },
    categories: ["第 1 年", "第 2 年", "第 3 年"],
    series: [
      { name: "模型订阅收入", values: [35.4, 212.4, 708], fill: C.blue },
      { name: "皮肤消费收入", values: [18, 108, 360], fill: C.cyan },
    ],
    barOptions: { direction: "column", grouping: "stacked", gapWidth: 70 },
    hasLegend: true,
    legend: { position: "bottom", overlay: false, textStyle: { fontSize: 14, fill: C.muted } },
    dataLabels: { showValue: true, position: "inEnd", textStyle: { fontSize: 13, fill: C.ink, bold: true } },
    yAxis: { title: "万元", majorGridlines: { style: "solid", fill: C.light, width: 1 }, textStyle: { fontSize: 12, fill: C.muted } },
    xAxis: { textStyle: { fontSize: 14, fill: C.ink }, line: { style: "solid", fill: C.rule, width: 1 } },
    chartFill: C.white,
    chartLine: { style: "solid", fill: C.white, width: 0 },
    plotAreaFill: { type: "none" },
    plotAreaLine: { style: "solid", fill: C.white, width: 0 },
  });
  textbox(s, "1,068 万元", 842, 252, 330, 68, { size: 38, bold: true, color: C.blue });
  textbox(s, "第 3 年个人用户年度收入", 842, 330, 330, 42, { size: 19, color: C.muted });
  textbox(s, "1,602 万元", 842, 426, 330, 68, { size: 38, bold: true });
  textbox(s, "第 3 年期末个人 ARR", 842, 504, 330, 42, { size: 19, color: C.muted });
  textbox(s, "口径：59 元/月模型订阅 + 30 元/月皮肤消费；按期初、期末用户均值计算。", 42, 636, 1120, 30, { size: 14, color: C.muted });
  notes(s, ["项目方保守财务模型：月 ARPU 89 元，年化 1,068 元", "期末付费个人用户假设：1,000 / 5,000 / 15,000；平均付费用户：500 / 3,000 / 10,000"]);
}

// 14. Funding ask — adapted from Codex Grid slide 19 metric-led layout.
{
  const s = deck.slides.add();
  title(s, "本轮融资 500 万元，验证四项商业闭环", "资金周期 18 个月；目标不是继续堆功能，而是把已成型底座转化为可复制收入。", 14, "Funding ask");
  const stats = [[42, "500 万", "融资额"], [453, "18 个月", "资金周期"], [864, "四项", "商业验证"]];
  stats.forEach(([x, v, l], i) => {
    rect(s, x, 316, 374, 220, i === 0 ? C.pale : C.light, "none", true);
    textbox(s, v, x + 32, 356, 310, 70, { size: 42, bold: true, color: i === 0 ? C.blue : C.ink });
    textbox(s, l, x + 32, 458, 310, 38, { size: 20, color: C.muted });
  });
  textbox(s, "模型订阅 · 角色生成 · 官方内容 · 创作者市场", 42, 578, 1196, 44, { size: 28, bold: true, align: "center" });
  notes(s, ["项目方本轮融资需求与 18 个月商业化目标"]);
}

// 15. Closing — adapted from Codex Grid slide 26.
{
  const s = deck.slides.add();
  textbox(s, "TIANSHU · INVESTMENT OPPORTUNITY", 42, 42, 460, 30, { size: 15, bold: true, color: C.blue });
  textbox(s, "下一代 Agent 不只替用户工作，\n也会成为用户愿意长期拥有、\n装扮和共同成长的数字角色。", 42, 160, 1120, 300, { size: 52, bold: true });
  textbox(s, "免费工具获客 → 模型订阅 → 角色生成 → 用户交易 → 平台抽成", 42, 540, 1130, 46, { size: 27, bold: true, color: C.blue });
  textbox(s, "天枢 AI Agent · 融资商业计划书 · 机密资料", 42, 630, 600, 28, { size: 15, color: C.muted });
  notes(s, ["项目价值主张与商业闭环总结"]);
}

await fs.mkdir(path.join(BUILD, "rendered"), { recursive: true });
for (const [i, s] of deck.slides.items.entries()) {
  const png = await deck.export({ slide: s, format: "png", scale: 1 });
  await fs.writeFile(path.join(BUILD, "rendered", `slide-${String(i + 1).padStart(2, "0")}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await s.export({ format: "layout" });
  await fs.writeFile(path.join(BUILD, "rendered", `slide-${String(i + 1).padStart(2, "0")}.layout.json`), await layout.text());
}
const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(path.join(BUILD, "montage.webp"), new Uint8Array(await montage.arrayBuffer()));
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(OUT);
console.log(OUT);
