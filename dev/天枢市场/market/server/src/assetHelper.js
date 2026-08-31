const { db } = require('./db');

/**
 * 将 assets 表的一行转换为前端期望的资产对象结构。
 * @param {object} row - assets 表行（含 count 等可选字段）
 * @param {number|null} viewUserId - 当前查看者用户 id，用于计算是否已收藏/已安装
 */
function rowToAsset(row, viewUserId = null) {
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch (e) { tags = []; }

  // 类型专属面板数据（characterData/skillData 等）
  let detailData = {};
  try { detailData = JSON.parse(row.detail_data || '{}'); } catch (e) { detailData = {}; }

  const asset = {
    id: row.id,
    cat: row.cat,
    name: row.name,
    author: row.author,
    verified: !!row.verified,
    dl: row.dl,
    rate: row.rate,
    ver: row.ver,
    days: row.days,
    tags,
    desc: row.desc,
    status: row.status,
    note: row.note,
    file_name: row.file_name || '',
    file_size: row.file_size || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...detailData,   // 展开类型专属数据，如 characterData/skillData/themeData 等
  };

  // 关联资产（列表/详情页均使用）
  asset.rel = db.prepare(`SELECT cat,name,ver,ref,rid FROM related_assets WHERE parent_id=? ORDER BY id`).all(row.id)
    .map(r => ({ cat: r.cat, name: r.name, ver: r.ver, ref: r.ref ?? undefined, rid: r.rid ?? undefined }));

  // 该资产是否已安装（需在调用前附加 installed_assets 逻辑，这里通过 viewUserId 查）
  if (viewUserId) {
    asset.is_installed = !!db.prepare('SELECT 1 FROM user_installs WHERE user_id=? AND asset_id=?').get(viewUserId, row.id);
    asset.is_faved = !!db.prepare('SELECT 1 FROM user_favs WHERE user_id=? AND asset_id=?').get(viewUserId, row.id);
  }

  return asset;
}

/** 列表查询（支持分类、搜索、排序） */
function queryAssets({ cat, q, sort, viewUserId }) {
  const where = [];
  const params = {};

  if (cat && cat !== 'rec' && cat !== 'all') {
    where.push('a.cat = @cat');
    params.cat = cat;
  }
  if (q) {
    where.push('(a.name LIKE @q OR a.author LIKE @q OR a.desc LIKE @q OR a.tags LIKE @q)');
    params.q = `%${q}%`;
  }

  // 只展示"上架"资产（live）
  where.push("a.status = 'live'");

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  let orderSql = 'ORDER BY a.dl DESC';
  if (sort === 'new') orderSql = 'ORDER BY a.days ASC, a.updated_at DESC';   // 天数越小越新
  else if (sort === 'rate') orderSql = 'ORDER BY a.rate DESC, a.dl DESC';

  const rows = db.prepare(`SELECT a.* FROM assets a ${whereSql} ${orderSql}`).all(params);
  return rows.map(r => rowToAsset(r, viewUserId));
}

module.exports = { rowToAsset, queryAssets };
