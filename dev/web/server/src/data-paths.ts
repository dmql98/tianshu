/**
 * 公共用户数据路径模块（BUILTIN_CONTENT_DEVELOPMENT_PLAN §8 / §2.4）。
 *
 * 唯一可写用户数据根来自 `getDataDir()`（解析、迁移、缓存全部归
 * `web/server/src/config.ts` 管理）。本模块只提供经过命名的子路径，
 * 不重复读取环境变量或 config.json。
 *
 * characters / skills / themes 以及内容状态文件都必须从这里派生，
 * 禁止在各 store/catalog 中散落 `resolve(getDataDir(), ...)`。
 */
import { resolve } from 'path'
import { getDataDir } from './config.js'

/** 可写用户数据根（<dataDir>）。 */
export function dataRoot(): string {
  return getDataDir()
}

/** 轻量配置目录：<dataDir>/config（providers / 主题 / 图标包 / 常用模型计数的落盘处）。 */
export function configDir(): string {
  return resolve(dataRoot(), 'config')
}

/** 用户角色目录：<dataDir>/characters */
export function charactersRoot(): string {
  return resolve(dataRoot(), 'characters')
}

/** 用户技能目录：<dataDir>/skills */
export function skillsRoot(): string {
  return resolve(dataRoot(), 'skills')
}

/** 用户皮肤目录：<dataDir>/skin（SKIN_DECOUPLE_PLAN，角色视觉/动画独立成皮肤）。 */
export function skinRoot(): string {
  return resolve(dataRoot(), 'skin')
}

/**
 * builtin/content 出厂镜像根：<dataDir>/builtin。
 *
 * 启动时把 content/builtin 完整复制到这里，供技能/文件工具在 dataDir 内
 * 读写角色/技能定义文件（技能指南路径统一指向 <dataDir>）。它是**只读镜像**，
 * 不参与双层合并（mergeById 只扫描 characters/ 与 skills/），因此不会把
 * 内置角色标记成 source:'user'。用户真正的修改仍写用户层 characters/ 或
 * skills/ 目录。
 */
export function builtinMirrorRoot(): string {
  return resolve(dataRoot(), 'builtin')
}

/** 出厂镜像角色目录：<dataDir>/builtin/characters */
export function builtinMirrorCharactersRoot(): string {
  return resolve(builtinMirrorRoot(), 'characters')
}

/** 出厂镜像技能目录：<dataDir>/builtin/skills */
export function builtinMirrorSkillsRoot(): string {
  return resolve(builtinMirrorRoot(), 'skills')
}

/** 用户自定义主题目录：<dataDir>/themes（由主题阶段使用，本阶段只提供路径）。 */
export function themesRoot(): string {
  return resolve(dataRoot(), 'themes')
}

/** 用户图标包目录：<dataDir>/iconpacks（ICON_PACK_PLAN §6）。 */
export function iconPacksRoot(): string {
  return resolve(dataRoot(), 'iconpacks')
}

/** 出厂服务商预设目录（D6 single-layer seed）：<dataDir>/providers。 */
export function providersRoot(): string {
  return resolve(dataRoot(), 'providers')
}

/** 内容层状态文件：<dataDir>/content-state.json（builtin 隐藏状态等）。 */
export function contentStateFile(): string {
  return resolve(dataRoot(), 'content-state.json')
}

/** 旧版用户偏好文件：<dataDir>/user-preferences.json（主题/图标包聚合）。
 *  仅作迁移读取源——迁移后主题/图标包选择分别落到 config/theme.json、config/iconpack.json，
 *  本函数随之废弃（见 preferences 各 store 的迁移逻辑）。 */
export function userPreferencesFile(): string {
  return resolve(dataRoot(), 'user-preferences.json')
}

/** 用户服务商配置：<dataDir>/config/providers.json（由 <dataDir>/providers.json 迁移而来）。 */
export function configProvidersFile(): string {
  return resolve(configDir(), 'providers.json')
}

/** 主题选择：<dataDir>/config/theme.json。 */
export function configThemeFile(): string {
  return resolve(configDir(), 'theme.json')
}

/** 图标包选择：<dataDir>/config/iconpack.json。 */
export function configIconPackFile(): string {
  return resolve(configDir(), 'iconpack.json')
}

/** 常用模型计数：<dataDir>/config/model-usage.json。 */
export function configModelUsageFile(): string {
  return resolve(configDir(), 'model-usage.json')
}
