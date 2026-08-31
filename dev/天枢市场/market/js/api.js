/**
 * 天枢市场前端 API 层
 * 统一封装 REST 请求 / token 管理 / 用户会话。
 * 各页面通过 window.MarketAPI 使用。
 * 同源部署时 BASE 为空；若前端与 API 不同源，可设置 window.MARKET_API_BASE。
 */
(function () {
  const BASE = window.MARKET_API_BASE || '';

  // ─────────── token 管理 ───────────
  const TOKEN_KEY = 'tianshu_token';
  const USER_KEY = 'tianshu_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }
  function setUser(u) {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  }
  function getUserCache() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function logout() { setToken(''); setUser(null); }
  function isLoggedIn() { return !!getToken(); }

  // ─────────── 基础请求 ───────────
  async function request(method, path, body, isForm) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body && !isForm) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) {
      opts.body = isForm ? body : JSON.stringify(body);
    }
    const res = await fetch(BASE + path, opts);
    let data = null;
    try { data = await res.json(); }
    catch (e) { data = { ok: false, message: '响应解析失败' }; }
    if (!res.ok || data.ok === false) {
      const err = new Error((data && data.message) || ('请求失败 ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data.data !== undefined ? data.data : data;
  }

  const get = (p) => request('GET', p);
  const post = (p, b) => request('POST', p, b || {});
  const del = (p) => request('DELETE', p);

  // ─────────── 公开 API ───────────
  const api = {
    // 工具
    request, get, post, del,
    getToken, isLoggedIn, logout, getUserCache,

    // 分类与资产
    categories: () => get('/api/categories'),
    assets: (params = {}) => {
      const qs = new URLSearchParams();
      if (params.cat) qs.set('cat', params.cat);
      if (params.q) qs.set('q', params.q);
      if (params.sort) qs.set('sort', params.sort);
      const s = qs.toString();
      return get('/api/assets' + (s ? '?' + s : ''));
    },
    asset: (id) => get('/api/assets/' + id),

    // 认证
    register: (name, email, password) => post('/api/auth/register', { name, email, password }),
    login: (email, password) => post('/api/auth/login', { email, password }),
    me: () => get('/api/auth/me'),

    // 安装 / 收藏
    install: (id) => post('/api/assets/' + id + '/install'),
    uninstall: (id) => del('/api/assets/' + id + '/install'),
    fav: (id) => post('/api/assets/' + id + '/fav'),
    unfav: (id) => del('/api/assets/' + id + '/fav'),

    // 我的
    myInstalls: () => get('/api/me/installs'),
    myFavs: () => get('/api/me/favs'),
    myUploads: () => get('/api/me/uploads'),

    // 上传 / 编辑（multipart）
    uploadAsset: (formData) => request('POST', '/api/assets/upload', formData, true),
    updateAsset: (id, formData) => request('POST', '/api/assets/' + id + '/update', formData, true),
    deleteAsset: (id) => del('/api/assets/' + id),
    // 本地资产导入（.tianshu JSON 包）
    importLocal: (formData) => request('POST', '/api/assets/import-local', formData, true),

    // 管理
    adminStats: () => get('/api/admin/stats'),
    adminReview: () => get('/api/admin/review'),
    adminReviewAction: (id, action, note) => post('/api/admin/review/' + id, { action, note }),
  };

  // 登录/注册成功后统一处理 token 与用户缓存
  api.afterAuth = function (data) {
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  window.MarketAPI = api;
})();