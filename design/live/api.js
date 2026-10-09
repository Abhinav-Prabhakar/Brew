/* brew live — REST client (window.BrewApi).
   Actions never edit state directly: they POST, the backend emits events, the store reduces them.
   Backend errors ({"error": {code, message, details}}) reject with a BrewApiError carrying those fields. */
(() => {
  class BrewApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.name = 'BrewApiError';
      this.status = status;
      this.code = code;
      this.details = details === undefined ? null : details;
    }
  }

  const cfg = { base: '', worldId: null, fetch: null };

  const prefix = '/api/v1';
  const worldPath = (path) => {
    if (path.startsWith('/api/')) return path; // absolute API path (e.g. /api/v1/policies/comparison)
    if (!cfg.worldId) throw new BrewApiError(0, 'no_world', 'no world selected yet', null);
    return prefix + '/worlds/' + encodeURIComponent(cfg.worldId) + (path.startsWith('/') ? path : '/' + path);
  };

  async function request(method, path, body) {
    const f = cfg.fetch || window.fetch.bind(window);
    const url = cfg.base.replace(/\/$/, '') + path;
    let res;
    try {
      res = await f(url, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new BrewApiError(0, 'network_error', String((e && e.message) || e), null);
    }
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) {
      const err = data && data.error;
      throw new BrewApiError(res.status, err ? err.code : 'http_' + res.status, err ? err.message : res.statusText, err ? err.details : null);
    }
    return data;
  }

  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

  window.BrewApi = {
    BrewApiError,
    /** configure({base, worldId, fetch}) — fetch is injectable for tests */
    configure(o) { Object.assign(cfg, o); return cfg; },
    get config() { return cfg; },
    request,
    /** GET a world read model ('/menu') or an absolute API path ('/api/v1/events/schema') */
    get(path) { return request('GET', worldPath(path)); },
    post(path, body) { return request('POST', worldPath(path), body === undefined ? {} : body); },
    /** player / owner action: POST /worlds/{id}/actions {kind, ...payload} */
    act(kind, payload) { return request('POST', worldPath('/actions'), { kind, ...(payload || {}) }); },
    /** trigger a disruption: POST /worlds/{id}/chaos {kind, target?, severity?, duration_min?} */
    chaos(kind, opts) { return request('POST', worldPath('/chaos'), { kind, ...clean(opts || {}) }); },
    /** buy a catalog item: POST /worlds/{id}/invest {catalog_key} */
    invest(key) { return request('POST', worldPath('/invest'), { catalog_key: key }); },
    control(action, step_s) { return request('POST', worldPath('/control'), clean({ action, step_s })); },
    state() { return request('GET', worldPath('/state')); },
    listWorlds() { return request('GET', prefix + '/worlds'); },
    createWorld(spec) { return request('POST', prefix + '/worlds', spec); },
  };
})();
