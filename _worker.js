// ====== 基础配置区 ======
let AdminUser = 'admin';  // 后台登录用户名 (可在环境变量中设置 ADMIN_USER)
let AdminPass = '123456'; // 后台登录密码 (可在环境变量中设置 ADMIN_PASS)

let mytoken = 'auto';
let guestToken = '';
let BotToken = '';
let ChatID = '';
let TG = 0;
let FileName = 'CF-Workers-SUB';
let SUBUpdateTime = 6;
let total = 99;              // 保留原变量，避免外部引用报错
let timestamp = 4102329600000;

let MainData = `
https://cfxr.eu.org/getSub
`;

let urls = [];
let subConverter = "SUBAPI.cmliussss.net";
let subConfig = "https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini";
let subProtocol = 'https';

// ====== 【节点处理配置对象】（保持与原项目完全一致的结构，兼容旧 EDIT_CONFIG.json） ======
const DEFAULT_NODE_EDIT_CONFIG = {
    retainProtocols: [], dropProtocols: [],
    retainNameRegex: '', dropNameRegex: '',
    replaceTarget: '', replaceWith: '',
    globalRename: '', addPrefix: '', addSuffix: '',
    autoEmoji: true, deepDeduplicate: true, sortNodes: true, dropInvalidNodes: true,
    specificRules: {} // 专属节点的特殊前后缀规则
};

// ====== 【新增：全局配置快照】 ======
// Cloudflare KV 不支持事务，因此"保存所有配置"只写一个键（单次 put 天然原子），
// 旧键（LINK.txt / CUSTOM_NODES.txt / EDIT_CONFIG.json）作为兼容镜像最后写入。
const KV_SNAPSHOT_KEY = 'CONFIG_V2.json';
const CONFIG_VERSION = 3;
const HISTORY_MAX_STEPS = 10;      // 撤销/重做各最多 10 步
const LIMIT_MAX = 20000;           // 数量限制合理上界
const LINKS_MAX_LEN = 512 * 1024;  // 抓取源长度上界，防止误覆盖

export default {
    async fetch(request, env) {
        const userAgentHeader = request.headers.get('User-Agent');
        const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : "null";
        const url = new URL(request.url);
        const token = url.searchParams.get('token');

        AdminUser = env.ADMIN_USER || AdminUser;
        AdminPass = env.ADMIN_PASS || AdminPass;
        mytoken = env.TOKEN || mytoken;
        BotToken = env.TGTOKEN || BotToken;
        ChatID = env.TGID || ChatID;
        TG = env.TG || TG;
        subConverter = env.SUBAPI || subConverter;
        if (subConverter.includes("http://")) {
            subConverter = subConverter.split("//")[1];
            subProtocol = 'http';
        } else {
            subConverter = subConverter.split("//")[1] || subConverter;
        }
        subConfig = env.SUBCONFIG || subConfig;
        FileName = env.SUBNAME || FileName;

        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        const timeTemp = Math.ceil(currentDate.getTime() / 1000);
        const fakeToken = await MD5MD5(`${mytoken}${timeTemp}`);
        guestToken = env.GUESTTOKEN || env.GUEST || guestToken;
        if (!guestToken) guestToken = await MD5MD5(mytoken);
        const 访客订阅 = guestToken;
        SUBUpdateTime = env.SUBUPTIME || SUBUpdateTime;

        // ====== 【实时预览接口：真实抓取 + 真实规则处理 + 真实数量限制】 ======
        if (request.method === 'POST' && url.pathname === '/preview') {
            const previewSessionToken = await MD5MD5(AdminUser + AdminPass + "CF-SUB-SECURE");
            if (getCookie(request, 'admin_session') !== previewSessionToken) {
                return jsonResponse({
                    ok: false,
                    error: '未登录或登录已过期，请重新登录后台'
                }, 401);
            }

            let data;
            try {
                data = await request.json();
            } catch (e) {
                return jsonResponse({ ok: false, error: '请求体不是合法 JSON' }, 400);
            }

            let cfg;
            try {
                cfg = normalizeIncoming(data);
            } catch (e) {
                return jsonResponse({ ok: false, error: e.message }, 400);
            }

            try {
                // 1. 真实抓取（明文节点 + 全部远程订阅并发）
                const fetched = await resolveLinksToNodes(cfg.links || '', request, userAgentHeader);

                // 2. 规则处理
                const stats = createStats();
                let baseNodes = processNodes(fetched.text, cfg.rules, stats);

                // 3. 自定义输出节点（保持原项目设计：不受普通过滤规则限制）
                let customNodes = processNodes(
                    cfg.customNodes || '',
                    Object.assign({}, cfg.rules, { isCustom: true }),
                    stats
                );

                // 4. 合并 + 收藏标记 + 数量限制
                const merged = mergeNodes(baseNodes, customNodes);
                const favInfo = applyFavorites(merged, cfg.favorites);
                const limitInfo = selectByLimit(merged, cfg.output, favInfo.idSet, dailySeed());

                // 5. 输出
                return jsonResponse({
                    ok: true,
                    seed: dailySeed(),
                    sources: fetched.report,
                    plainCount: fetched.plainCount,
                    nodes: serializeNodes(baseNodes),
                    customNodes: serializeNodes(customNodes),
                    stats: Object.assign({}, stats, {
                        baseCount: baseNodes.length,
                        customCount: customNodes.length,
                        mergedCount: merged.length,
                        favorites: favInfo.matched,
                        favoritesUnmatched: favInfo.unmatched,
                        limit: limitInfo
                    })
                }, 200);
            } catch (e) {
                console.error("Preview Error:", e);
                return jsonResponse({
                    ok: false,
                    error: e.message || '解析或抓取异常'
                }, 400);
            }
        }

        // 【拦截管理后台独立路由】
        if (
            url.pathname === '/admin' ||
            url.pathname === '/login' ||
            url.pathname === '/logout' ||
            url.pathname === '/'
        ) {
            const sessionToken = await MD5MD5(
                AdminUser + AdminPass + "CF-SUB-SECURE"
            );

            return await handleAdminUI(
                request,
                env,
                sessionToken,
                AdminUser,
                AdminPass,
                guestToken,
                url,
                mytoken,
                FileName,
                subProtocol,
                subConverter,
                subConfig,
                userAgentHeader
            );
        }

        // ================= 原有订阅分发逻辑 =================
        if (!(
            [mytoken, fakeToken, 访客订阅].includes(token) ||
            url.pathname == ("/" + mytoken) ||
            url.pathname.includes("/" + mytoken + "?")
        )) {
            if (
                TG == 1 &&
                url.pathname !== "/" &&
                url.pathname !== "/favicon.ico"
            ) {
                await sendMessage(
                    `#异常访问 ${FileName}`,
                    request.headers.get('CF-Connecting-IP'),
                    `UA: ${userAgent}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`
                );
            }

            if (env.URL302) {
                return Response.redirect(env.URL302, 302);
            } else if (env.URL) {
                return await proxyURL(env.URL, url);
            } else {
                return new Response(await nginx(), {
                    status: 200,
                    headers: { 'Content-Type': 'text/html; charset=UTF-8' }
                });
            }
        } else {
            // ====== 读取"最近一次全局保存成功"的正式配置 ======
            const cfg = await loadConfig(env, false);

            if (env.KV) {
                await 迁移地址列表(env, 'LINK.txt');

                if (userAgent.includes('mozilla') && !url.search) {
                    return Response.redirect(`${url.origin}/admin`, 302);
                }
            } else {
                cfg.links = env.LINK || cfg.links || MainData;
                if (env.LINKSUB) urls = await ADD(env.LINKSUB);
            }

            // 获取基础裸节点（明文 + 远程订阅）
            const fetched = await resolveLinksToNodes(
                (cfg.links || '') + '\n' + urls.join('\n'),
                request,
                userAgentHeader
            );
            const req_data = fetched.text;

            const isSubConverterRequest =
                request.headers.get('subconverter-request') ||
                request.headers.get('subconverter-version') ||
                userAgent.includes('subconverter');

            let 订阅格式 = 'base64';

            if (!(
                userAgent.includes('null') ||
                isSubConverterRequest ||
                userAgent.includes('nekobox') ||
                userAgent.includes(('CF-Workers-SUB').toLowerCase())
            )) {
                if (
                    userAgent.includes('sing-box') ||
                    userAgent.includes('singbox') ||
                    url.searchParams.has('sb') ||
                    url.searchParams.has('singbox')
                ) {
                    订阅格式 = 'singbox';
                } else if (
                    userAgent.includes('surge') ||
                    url.searchParams.has('surge')
                ) {
                    订阅格式 = 'surge';
                } else if (
                    userAgent.includes('quantumult') ||
                    url.searchParams.has('quanx')
                ) {
                    订阅格式 = 'quanx';
                } else if (
                    userAgent.includes('loon') ||
                    url.searchParams.has('loon')
                ) {
                    订阅格式 = 'loon';
                } else if (
                    userAgent.includes('clash') ||
                    userAgent.includes('meta') ||
                    userAgent.includes('mihomo') ||
                    url.searchParams.has('clash')
                ) {
                    订阅格式 = 'clash';
                }
            }

            if (
                url.searchParams.has('b64') ||
                url.searchParams.has('base64')
            ) {
                订阅格式 = 'base64';
            }

            let 订阅转换URL =
                `${url.origin}/${await MD5MD5(fakeToken)}?token=${fakeToken}`;

            if (env.WARP) {
                订阅转换URL += "|" + (await ADD(env.WARP)).join("|");
            }

            // ====== 节点统一处理与重组（与预览共用同一套算法） ======
            let nodeArray = [];
            let customArray = [];

            try {
                nodeArray = processNodes(req_data, cfg.rules, createStats());
                customArray = processNodes(
                    cfg.customNodes || '',
                    Object.assign({}, cfg.rules, { isCustom: true }),
                    createStats()
                );
            } catch (e) {
                // 规则异常时退化为"仅解析不加工"，保证订阅地址永远可用
                console.error('规则处理异常，降级为基础解析:', e);
                const fallback = Object.assign({}, DEFAULT_NODE_EDIT_CONFIG, {
                    retainNameRegex: '', dropNameRegex: '',
                    replaceTarget: '', globalRename: '',
                    addPrefix: '', addSuffix: ''
                });
                nodeArray = processNodes(req_data, fallback, createStats());
                customArray = processNodes(
                    cfg.customNodes || '',
                    Object.assign({}, fallback, { isCustom: true }),
                    createStats()
                );
            }

            const merged = mergeNodes(nodeArray, customArray);
            const favInfo = applyFavorites(merged, cfg.favorites);

            // 【关键】数量限制必须在订阅生成环节真正执行，而不是只在预览里截断
            selectByLimit(merged, cfg.output, favInfo.idSet, dailySeed());

            const finalNodes = merged.filter(n => n.selected);
            const finalOutput = buildSubString(finalNodes);

            let base64Data;

            try {
                base64Data = btoa(finalOutput);
            } catch (e) {
                base64Data = encodeBase64(finalOutput);
            }

            const responseHeaders = {
                "content-type": "text/plain; charset=utf-8",
                "Profile-Update-Interval": `${SUBUpdateTime}`,
                "Profile-web-page-url": request.url.includes('?')
                    ? request.url.split('?')[0]
                    : request.url,
            };

            if (订阅格式 == 'base64' || token == fakeToken) {
                return new Response(base64Data, { headers: responseHeaders });
            } else {
                let subConverterUrl =
                    `${subProtocol}://${subConverter}/sub?target=${订阅格式}` +
                    `&url=${encodeURIComponent(订阅转换URL)}` +
                    `&insert=false` +
                    `&config=${encodeURIComponent(subConfig)}` +
                    `&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false`;

                if (
                    订阅格式 == 'clash' ||
                    订阅格式 == 'singbox' ||
                    订阅格式 == 'surge'
                ) {
                    subConverterUrl += '&new_name=true';
                }

                if (订阅格式 == 'quanx') {
                    subConverterUrl += '&udp=true';
                }

                try {
                    const subConverterResponse = await fetch(subConverterUrl, {
                        headers: { 'User-Agent': userAgentHeader }
                    });

                    if (!subConverterResponse.ok) {
                        return new Response(base64Data, { headers: responseHeaders });
                    }

                    let subConverterContent = await subConverterResponse.text();

                    if (订阅格式 == 'clash') {
                        subConverterContent = await clashFix(subConverterContent);
                    }

                    if (!userAgent.includes('mozilla')) {
                        responseHeaders["Content-Disposition"] =
                            `attachment; filename*=utf-8''${encodeURIComponent(FileName)}`;
                    }

                    return new Response(subConverterContent, {
                        headers: responseHeaders
                    });
                } catch (error) {
                    return new Response(base64Data, { headers: responseHeaders });
                }
            }
        }
    }
};


// ================= 统一 JSON 响应 =================
function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: {
            "Content-Type": "application/json;charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate"
        }
    });
}


// ================= 【配置快照：读取 / 保存 / 兼容迁移】 =================
function defaultConfig() {
    return {
        version: 0,
        savedAt: '',
        links: '',
        customNodes: '',
        rules: Object.assign({}, DEFAULT_NODE_EDIT_CONFIG),
        output: { limitEnabled: false, limit: 0 },
        favorites: [],
        preview: { keyword: '', onlyFav: false }
    };
}


// 读取正式生效配置：优先快照，其次旧版三个 KV 键（新旧数据完全兼容）
async function loadConfig(env, migrate) {
    const cfg = defaultConfig();

    if (!env || !env.KV) {
        cfg.links = (env && env.LINK) || MainData || '';
        return cfg;
    }

    let snapshotText = null;
    try {
        snapshotText = await env.KV.get(KV_SNAPSHOT_KEY);
    } catch (e) {
        snapshotText = null;
    }

    if (snapshotText) {
        try {
            const snap = JSON.parse(snapshotText);
            if (snap && typeof snap === 'object') {
                cfg.version = Number(snap.version) || 0;
                cfg.savedAt = snap.savedAt || '';
                cfg.links = typeof snap.links === 'string' ? snap.links : '';
                cfg.customNodes = typeof snap.customNodes === 'string' ? snap.customNodes : '';
                if (snap.rules && typeof snap.rules === 'object') {
                    cfg.rules = mergeRules(cfg.rules, snap.rules);
                }
                if (snap.output && typeof snap.output === 'object') {
                    cfg.output = normalizeOutput(snap.output);
                }
                if (Array.isArray(snap.favorites)) {
                    cfg.favorites = normalizeFavorites(snap.favorites);
                }
                if (snap.preview && typeof snap.preview === 'object') {
                    cfg.preview = {
                        keyword: typeof snap.preview.keyword === 'string' ? snap.preview.keyword : '',
                        onlyFav: !!snap.preview.onlyFav
                    };
                }
                return cfg;
            }
        } catch (e) {
            console.error('配置快照解析失败，回退旧版 KV:', e);
        }
    }

    // ====== 旧版 KV 兼容读取 ======
    try {
        cfg.links = (await env.KV.get('LINK.txt')) || '';
        cfg.customNodes = (await env.KV.get('CUSTOM_NODES.txt')) || '';

        const kvCfg = await env.KV.get('EDIT_CONFIG.json');
        if (kvCfg) {
            try {
                cfg.rules = mergeRules(cfg.rules, JSON.parse(kvCfg));
                cfg.version = CONFIG_VERSION;
            } catch (e) { }
        }

        // 首次读取旧数据时，静默生成一份快照，后续保存才有版本号可比对
        if (migrate && !snapshotText && (cfg.links || cfg.customNodes)) {
            cfg.version = CONFIG_VERSION;
            cfg.savedAt = new Date().toISOString();
            try {
                await env.KV.put(KV_SNAPSHOT_KEY, JSON.stringify(snapshotFor(cfg)));
            } catch (e) {
                console.error('旧配置迁移失败:', e);
            }
        }
    } catch (e) {
        console.error('读取 KV 异常:', e);
    }

    return cfg;
}


function snapshotFor(cfg) {
    return {
        version: cfg.version,
        savedAt: cfg.savedAt,
        links: cfg.links,
        customNodes: cfg.customNodes,
        rules: cfg.rules,
        output: cfg.output,
        favorites: cfg.favorites,
        preview: cfg.preview
    };
}


// ================= 【入参规范化 + 校验】 =================
function mergeRules(base, incoming) {
    const out = Object.assign({}, base);
    if (!incoming || typeof incoming !== 'object') return out;

    const boolKeys = ['autoEmoji', 'deepDeduplicate', 'sortNodes', 'dropInvalidNodes'];
    const strKeys = ['retainNameRegex', 'dropNameRegex', 'replaceTarget', 'replaceWith',
        'globalRename', 'addPrefix', 'addSuffix'];

    for (const k of boolKeys) {
        if (incoming[k] !== undefined) out[k] = !!incoming[k];
    }
    for (const k of strKeys) {
        if (incoming[k] !== undefined) out[k] = incoming[k] === null ? '' : String(incoming[k]);
    }
    if (incoming.retainProtocols !== undefined) out.retainProtocols = toProtocolList(incoming.retainProtocols);
    if (incoming.dropProtocols !== undefined) out.dropProtocols = toProtocolList(incoming.dropProtocols);

    if (incoming.specificRules && typeof incoming.specificRules === 'object') {
        const safe = {};
        for (const key of Object.keys(incoming.specificRules)) {
            const r = incoming.specificRules[key];
            if (!r || typeof r !== 'object') continue;
            const item = {};
            if (r.prefix) item.prefix = String(r.prefix);
            if (r.suffix) item.suffix = String(r.suffix);
            if (item.prefix || item.suffix) safe[key] = item;
        }
        out.specificRules = safe;
    }

    return out;
}


function toProtocolList(v) {
    if (Array.isArray(v)) {
        return [...new Set(v.map(x => String(x).trim().toLowerCase()).filter(Boolean))];
    }
    if (typeof v === 'string') {
        return [...new Set(v.split(/[,，\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];
    }
    return [];
}


function normalizeOutput(v) {
    const out = { limitEnabled: false, limit: 0 };
    if (v === undefined || v === null) return out;

    if (typeof v === 'number' || typeof v === 'string') {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) {
            out.limitEnabled = true;
            out.limit = Math.min(n, LIMIT_MAX);
        }
        return out;
    }

    if (typeof v === 'object') {
        out.limitEnabled = !!v.limitEnabled;
        const n = parseInt(v.limit, 10);
        out.limit = Number.isFinite(n) && n > 0 ? Math.min(n, LIMIT_MAX) : 0;
        if (out.limitEnabled && out.limit < 1) out.limitEnabled = false;
    }
    return out;
}


function normalizeFavorites(v) {
    const out = [];
    const seen = new Set();
    if (!Array.isArray(v)) return out;

    for (const item of v) {
        let id = '';
        let name = '';
        if (typeof item === 'string') {
            id = item.trim();
        } else if (item && typeof item === 'object') {
            id = String(item.id || item.fingerprint || '').trim();
            name = String(item.name || '');
        }
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id: id, name: name });
    }
    return out;
}


// 校验正则是否可编译；保存阶段拦截，避免坏规则进入 KV 影响订阅输出
function assertRegex(pattern, flags, label) {
    if (!pattern) return;
    try {
        new RegExp(pattern, flags);
    } catch (e) {
        throw new Error(`${label} 正则表达式无效：${e.message}`);
    }
}


function normalizeIncoming(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('配置数据格式错误');
    }

    const cfg = defaultConfig();

    // 兼容旧前端字段 config
    const rawRules = data.rules || data.config || {};

    cfg.links = typeof data.links === 'string' ? data.links : '';
    cfg.customNodes = typeof data.customNodes === 'string' ? data.customNodes : '';

    if (cfg.links.length > LINKS_MAX_LEN || cfg.customNodes.length > LINKS_MAX_LEN) {
        throw new Error('抓取源或自定义节点内容过长，已拒绝保存');
    }

    cfg.rules = mergeRules(cfg.rules, rawRules);
    cfg.output = normalizeOutput(data.output !== undefined ? data.output : data.limit);
    cfg.favorites = normalizeFavorites(data.favorites);

    if (data.preview && typeof data.preview === 'object') {
        cfg.preview = {
            keyword: typeof data.preview.keyword === 'string' ? data.preview.keyword : '',
            onlyFav: !!data.preview.onlyFav
        };
    }

    // 保存前把正则全部检查一遍
    assertRegex(cfg.rules.retainNameRegex, 'i', '正则保留');
    assertRegex(cfg.rules.dropNameRegex, 'i', '正则剔除');
    assertRegex(cfg.rules.replaceTarget, 'gi', '查找关键字');

    if (cfg.output.limitEnabled) {
        if (!Number.isInteger(cfg.output.limit) || cfg.output.limit < 1) {
            throw new Error('节点数量必须是大于 0 的整数');
        }
    }

    return cfg;
}


// ================= 核心工具函数：真实拉取远程节点（分类 + 逐条上报） =================
async function resolveLinksToNodes(text, request, userAgentHeader) {
    const allLines = await ADD(String(text || ''));
    const subLinks = [];
    const plainLines = [];

    for (let x of allLines) {
        const line = (x || '').trim();
        if (!line) continue;
        if (/^https?:\/\//i.test(line)) subLinks.push(line);
        else plainLines.push(line);
    }

    const uniqLinks = [...new Set(subLinks)];
    const plainText = plainLines.join('\n');

    let remoteText = '';
    let report = [];

    if (uniqLinks.length > 0) {
        const res = await fetchSubscriptions(uniqLinks, request, userAgentHeader);
        remoteText = res.text;
        report = res.report;
    }

    return {
        text: plainText + (plainText && remoteText ? '\n' : '') + remoteText,
        report: report,
        plainCount: plainLines.length
    };
}


// ====== 多订阅源并发抓取与解析（单条失败不影响其他） ======
async function fetchSubscriptions(sources, request, userAgentHeader) {
    const list = [...new Set((sources || []).filter(s => typeof s === 'string' && s.trim()))];
    const report = [];
    let newapi = '';

    if (list.length === 0) return { text: '', report: report };

    const responses = await Promise.allSettled(
        list.map(async (apiUrl) => {
            // 每个订阅源独立超时，避免一个慢源拖垮全部
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const response = await getUrl(request, apiUrl, 'v2rayn', userAgentHeader, controller.signal);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return await response.text();
            } finally {
                clearTimeout(timer);
            }
        })
    );

    responses.forEach((response, index) => {
        const srcUrl = list[index];
        let host = srcUrl;
        try { host = new URL(srcUrl).host; } catch (e) { }

        if (response.status !== 'fulfilled') {
            const reason = response.reason;
            const msg = reason && reason.name === 'AbortError'
                ? '请求超时（12 秒）'
                : (reason && reason.message) || String(reason || '未知错误');
            console.warn('订阅源抓取失败:', srcUrl, msg);
            report.push({ url: srcUrl, host: host, ok: false, error: msg, nodes: 0 });
            return;
        }

        const content = String(response.value || '')
            .replace(/^\uFEFF/, '')
            .trim();

        if (!content) {
            report.push({ url: srcUrl, host: host, ok: false, error: '返回内容为空', nodes: 0 });
            return;
        }

        // Clash YAML / sing-box JSON：无法直接当节点列表解析，明确上报
        if (
            content.includes('proxies:') ||
            (content.includes('outbounds"') && content.includes('inbounds"'))
        ) {
            report.push({
                url: srcUrl, host: host, ok: false,
                error: '返回的是 Clash/sing-box 配置，不含明文节点，请改填节点订阅地址',
                nodes: 0
            });
            return;
        }

        if (content.includes('://')) {
            // 明文节点
            const count = countNodeLines(content);
            newapi += content + '\n';
            report.push({ url: srcUrl, host: host, ok: true, error: '', nodes: count });
            return;
        }

        // Base64 订阅
        const compact = content.replace(/\s/g, '');
        if (/^[A-Za-z0-9+/_=-]+$/.test(compact)) {
            try {
                const decoded = base64Decode(compact);
                if (!decoded || !decoded.includes('://')) {
                    throw new Error('Base64 解码后不含节点');
                }
                const count = countNodeLines(decoded);
                newapi += decoded + '\n';
                report.push({ url: srcUrl, host: host, ok: true, error: '', nodes: count });
            } catch (error) {
                console.warn('订阅 Base64 解码失败:', srcUrl, error);
                report.push({
                    url: srcUrl, host: host, ok: false,
                    error: 'Base64 解码失败: ' + (error.message || error),
                    nodes: 0
                });
            }
        } else {
            report.push({
                url: srcUrl, host: host, ok: false,
                error: '无法识别的返回格式（既不是节点列表也不是 Base64）',
                nodes: 0
            });
        }
    });

    return { text: newapi, report: report };
}


function countNodeLines(text) {
    let n = 0;
    for (const line of String(text || '').split('\n')) {
        if (line.includes('://')) n++;
    }
    return n;
}


// 兼容旧调用（原项目 getSUB 返回值结构）
async function getSUB(api, request, 追加UA, userAgentHeader) {
    const res = await fetchSubscriptions(api, request, userAgentHeader);
    return [await ADD(res.text), ''];
}


// ================= 统计对象 =================
function createStats() {
    return {
        parsed: 0,          // 解析出的节点行数
        valid: 0,           // 有效节点数
        invalid: 0,         // 无效节点数
        droppedProtocol: 0, // 被协议规则剔除
        droppedName: 0,     // 被名称正则剔除
        deduped: 0,         // 被深度去重剔除
        infoNodes: 0,       // 信息节点（流量/到期）
        renamed: 0,         // 名称被修改的节点数
        replaceHits: 0      // 被"查找替换"命中并修改名称的节点数
    };
}


// ================= 节点处理核心引擎（返回结构化对象数组，支撑预览与输出） =================
function processNodes(content, config, stats) {
    stats = stats || createStats();
    const cfg = Object.assign({}, DEFAULT_NODE_EDIT_CONFIG, config || {});
    const isCustom = !!cfg.isCustom;

    const retainProtocols = toProtocolList(cfg.retainProtocols);
    const dropProtocols = toProtocolList(cfg.dropProtocols);

    // 正则预编译：错误时抛出可读信息，绝不静默失败
    const retainRe = compileRegex(cfg.retainNameRegex, 'i', '正则保留');
    const dropRe = compileRegex(cfg.dropNameRegex, 'i', '正则剔除');
    const replaceRe = compileRegex(cfg.replaceTarget, 'gi', '查找关键字', true);

    let lines = String(content || '').split('\n');
    let parsedNodes = [];

    const EMOJI_MAP = [
        { regex: /香港|HK|Hong Kong/i, emoji: '🇭🇰' },
        { regex: /台湾|TW|Taiwan|新北|台北/i, emoji: '🇹🇼' },
        { regex: /日本|JP|Japan|东京|大阪/i, emoji: '🇯🇵' },
        { regex: /新加坡|SG|Singapore|狮城/i, emoji: '🇸🇬' },
        { regex: /美国|US|America|United States|洛杉矶|硅谷|波特兰/i, emoji: '🇺🇸' },
        { regex: /韩国|KR|Korea|首尔/i, emoji: '🇰🇷' },
        { regex: /英国|UK|United Kingdom|伦敦/i, emoji: '🇬🇧' },
        { regex: /德国|DE|Germany|法兰克福/i, emoji: '🇩🇪' },
        { regex: /法国|FR|France|巴黎/i, emoji: '🇫🇷' },
        { regex: /土耳其|TR|Turkey/i, emoji: '🇹🇷' },
        { regex: /印度|IN|India|孟买/i, emoji: '🇮🇳' },
        { regex: /阿根廷|AR|Argentina/i, emoji: '🇦🇷' }
    ];

    const INFO_NODE_REGEX =
        /流量|剩余|到期|过期|时间|Expire|Traffic|官网|更新|群|公告/i;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        stats.parsed++;

        let node = parseSingleNode(line);

        if (node && node.valid) {
            stats.valid++;
            parsedNodes.push(node);
        } else if (line.includes('://')) {
            stats.invalid++;
            parsedNodes.push({
                valid: false,
                raw: line,
                isInfoNode: INFO_NODE_REGEX.test(line),
                name: line,
                protocol: line.split('://')[0].toLowerCase(),
                fingerprint: '',
                identifier: ''
            });
        }
    }

    let finalNodes = [];
    let uniqueIdentifiers = new Set();

    for (let node of parsedNodes) {
        // 无效节点处理
        if (!node.valid) {
            if (node.isInfoNode) {
                stats.infoNodes++;
                finalNodes.push(node);
            } else if (!cfg.dropInvalidNodes) {
                finalNodes.push(node);
            }
            continue;
        }

        // 白名单保护：信息节点原样放行
        if (INFO_NODE_REGEX.test(node.name)) {
            node.isInfoNode = true;
            stats.infoNodes++;
            finalNodes.push(node);
            continue;
        }

        // 正则过滤（自定义节点不受普通过滤规则限制，保持原项目设计）
        if (!isCustom) {
            if (retainProtocols.length > 0 && !retainProtocols.includes(node.protocol)) {
                stats.droppedProtocol++;
                continue;
            }

            if (dropProtocols.length > 0 && dropProtocols.includes(node.protocol)) {
                stats.droppedProtocol++;
                continue;
            }

            if (retainRe && !retainRe.test(node.name)) {
                stats.droppedName++;
                continue;
            }

            if (dropRe && dropRe.test(node.name)) {
                stats.droppedName++;
                continue;
            }

            // 深度去重
            if (cfg.deepDeduplicate) {
                const dedupeId = node.fingerprint || `${node.protocol}:${node.address}:${node.port}:${node.id}`;
                if (uniqueIdentifiers.has(dedupeId)) {
                    stats.deduped++;
                    continue;
                }
                uniqueIdentifiers.add(dedupeId);
            }
        }

        if (!isCustom) {
            // 查找替换核心算法
            if (cfg.replaceTarget) {
                const nameBeforeReplace = node.name;
                if (replaceRe) {
                    replaceRe.lastIndex = 0;
                    node.name = node.name.replace(replaceRe, cfg.replaceWith || '');
                } else {
                    node.name = node.name
                        .split(cfg.replaceTarget)
                        .join(cfg.replaceWith || '');
                }
                if (node.name !== nameBeforeReplace) stats.replaceHits++;
            }

            if (cfg.globalRename) {
                node.name = cfg.globalRename;
            }

            // 自动 Emoji
            if (
                cfg.autoEmoji &&
                !/(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff]|[\u0023-\u0039]\ufe0f?\u20e3|\u3299|\u3297|\u303d|\u3030|\u24c2|\ud83c[\udd70-\udd71]|\ud83c[\udd7e-\udd7f]|\ud83c\udd8e|\ud83c[\udd91-\udd9a]|\ud83c[\udde6-\uddff])/.test(node.name)
            ) {
                for (const item of EMOJI_MAP) {
                    if (
                        item.regex.test(node.name) ||
                        item.regex.test(node.originalName)
                    ) {
                        node.name = `${item.emoji} ${node.name}`;
                        break;
                    }
                }
            }

            // 应用前台传入的个别专属前后缀
            if (cfg.specificRules && node.identifier && cfg.specificRules[node.identifier]) {
                let sRule = cfg.specificRules[node.identifier];

                if (sRule.prefix) {
                    node.name = sRule.prefix + node.name;
                }

                if (sRule.suffix) {
                    node.name = node.name + sRule.suffix;
                }
            }

            if (cfg.addPrefix) {
                node.name = cfg.addPrefix + node.name;
            }

            if (cfg.addSuffix) {
                node.name = node.name + cfg.addSuffix;
            }

            if (node.name !== node.originalName) stats.renamed++;
        }

        if (!node.isInfoNode) node.isInfoNode = false;
        finalNodes.push(node);
    }

    if (!isCustom) {
        // 重名自增
        const nameFrequencies = {};

        finalNodes.forEach(n => {
            if (!n.isInfoNode && n.valid) {
                nameFrequencies[n.name] = (nameFrequencies[n.name] || 0) + 1;
            }
        });

        const nameIndex = {};

        finalNodes.forEach(n => {
            if (!n.isInfoNode && n.valid && nameFrequencies[n.name] > 1) {
                nameIndex[n.name] = (nameIndex[n.name] || 0) + 1;
                const countStr = nameIndex[n.name].toString().padStart(2, '0');
                n.name = `${n.name} ${countStr}`;
            }
        });

        // 智能排序
        if (cfg.sortNodes) {
            finalNodes.sort((a, b) => {
                if (a.isInfoNode && !b.isInfoNode) return -1;
                if (!a.isInfoNode && b.isInfoNode) return 1;
                if (!a.valid || !b.valid) return 0;
                return a.name.localeCompare(b.name, 'zh-CN');
            });
        }
    }

    finalNodes.forEach(n => { n.selected = true; });

    return finalNodes;
}


function compileRegex(pattern, flags, label, silent) {
    if (!pattern) return null;
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        if (silent) return null;
        throw new Error(`${label} 正则表达式无效：${e.message}`);
    }
}


// ================= 【新增：合并 / 收藏 / 数量限制】 =================
function mergeNodes(baseNodes, customNodes) {
    const out = (baseNodes || []).slice();
    for (const n of (customNodes || [])) {
        n.isCustom = true;
        out.push(n);
    }
    return out;
}


// 收藏标记：使用稳定指纹（协议|地址|端口|ID），与节点名称无关
function applyFavorites(nodes, favorites) {
    const list = normalizeFavorites(favorites);
    const idSet = new Set(list.map(f => f.id));
    const matchedIds = new Set();
    let matched = 0;

    for (const n of nodes) {
        if (n.fingerprint && idSet.has(n.fingerprint)) {
            n.favorite = true;
            matched++;
            matchedIds.add(n.fingerprint);
        } else {
            n.favorite = false;
        }
    }

    const unmatched = list
        .filter(f => !matchedIds.has(f.id))
        .map(f => f.name || f.id);

    return { idSet: idSet, matched: matched, unmatched: unmatched };
}


// 数量限制 + 随机筛选：收藏节点永远优先保留，普通节点按日种子随机补足
function selectByLimit(nodes, output, favIdSet, seed) {
    const opt = normalizeOutput(output);

    let favCount = 0;
    let infoCount = 0;
    const normalIdx = [];

    nodes.forEach((n, i) => {
        if (n.isInfoNode) {
            n.selected = true;
            infoCount++;
            return;
        }
        if (n.favorite) {
            n.selected = true;
            favCount++;
            return;
        }
        n.selected = false;
        normalIdx.push(i);
    });

    const available = favCount + normalIdx.length;
    let exceeded = false;

    if (!opt.limitEnabled || opt.limit < 1) {
        // 未启用数量限制：全部输出
        normalIdx.forEach(i => { nodes[i].selected = true; });
    } else if (favCount >= opt.limit) {
        // 收藏数量已达到或超过上限：保留全部收藏，不删除任何收藏节点
        exceeded = favCount > opt.limit;
    } else {
        const remain = opt.limit - favCount;
        const picked = seededShuffle(normalIdx, seed).slice(0, remain);
        picked.forEach(i => { nodes[i].selected = true; });
    }

    const outputCount = nodes.filter(n => n.selected).length;

    return {
        enabled: opt.limitEnabled && opt.limit >= 1,
        limit: opt.limit,
        available: available,
        favorites: favCount,
        info: infoCount,
        output: outputCount,
        exceeded: exceeded
    };
}


// 按天固定的随机种子：同一天内多次请求结果一致，避免客户端反复刷新导致节点跳动
function dailySeed() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `SUB-LIMIT-${y}-${m}-${day}`;
}


function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}


function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}


function seededShuffle(arr, seed) {
    const out = arr.slice();
    const rnd = mulberry32(hashSeed(seed));
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
}


// 预览输出用：剥离 urlObj / config 等不可序列化的重型字段
function serializeNodes(nodes) {
    return nodes.map(n => ({
        identifier: n.identifier || '',
        fingerprint: n.fingerprint || '',
        name: n.name || '',
        originalName: n.originalName || n.name || '',
        protocol: n.protocol || '',
        valid: !!n.valid,
        isInfoNode: !!n.isInfoNode,
        isCustom: !!n.isCustom,
        raw: n.raw || '',
        favorite: !!n.favorite,
        selected: !!n.selected
    }));
}


// 数组反转为字符串订阅
function buildSubString(nodeArray) {
    return nodeArray.map(n => {
        if (!n.valid) return n.raw;
        return rebuildSingleNode(n);
    }).join('\n');
}


// 单节点解析与包装
function parseSingleNode(line) {
    try {
        let node = { valid: false, raw: line };

        if (line.startsWith('vmess://')) {
            let b64Str = line.substring(8).replace(/-/g, '+').replace(/_/g, '/');

            while (b64Str.length % 4 !== 0) {
                b64Str += '=';
            }

            let jsonStr = base64Decode(b64Str);
            let cfg = JSON.parse(jsonStr);

            node = {
                valid: !!cfg.add && !!cfg.port,
                protocol: 'vmess',
                name: cfg.ps || 'vmess',
                originalName: cfg.ps || 'vmess',
                address: cfg.add || '',
                port: cfg.port || '',
                id: cfg.id || '',
                config: cfg,
                raw: line
            };
        } else {
            // 规避 V8 引擎对于非标准协议 (vless/trojan/ss 等) 丢失 host/port 的 URL 解析 bug
            let match = line.match(/^([a-zA-Z0-9+\-.]+):\/\/(.*)$/);
            if (!match) return node;

            let proto = match[1];
            let rest = match[2];
            let urlObj;
            try {
                // 借用 http 协议强制 V8 正确解析出 hostname 和 port
                urlObj = new URL(`http://${rest}`);
            } catch (e) {
                urlObj = new URL(line); // 降级处理
            }

            let name = '';
            try {
                name = decodeURIComponent(urlObj.hash.slice(1) || '');
            } catch (e) {
                name = urlObj.hash.slice(1) || '';
            }

            node = {
                valid: !!urlObj.hostname && !!urlObj.port,
                protocol: proto.toLowerCase(),
                name: name,
                originalName: name,
                address: urlObj.hostname,
                port: urlObj.port,
                id: urlObj.username || '',
                urlObj: urlObj,
                raw: line
            };
        }

        // 生成唯一标识符用于前台精准勾选控制（保持与原项目一致）
        node.identifier =
            `${node.protocol}://${node.address}:${node.port}#${node.originalName}`;

        // 【新增】稳定指纹：不含节点名称，改名 / 加前后缀都不会让收藏关系错位
        node.fingerprint = node.valid
            ? `${node.protocol}|${String(node.address || '').toLowerCase()}|${node.port}|${node.id || ''}`
            : '';

        return node;
    } catch (e) {
        return { valid: false, raw: line, fingerprint: '', identifier: '' };
    }
}


function rebuildSingleNode(node) {
    if (node.protocol === 'vmess') {
        node.config.ps = node.name;
        return 'vmess://' + encodeBase64(JSON.stringify(node.config));
    } else {
        let urlObj = node.urlObj;
        urlObj.hash = '#' + encodeURIComponent(node.name);
        // 重新将 http:// 还原为原始的节点协议（如 vless://）
        let out = urlObj.toString();
        return out.replace(/^http:/i, node.protocol + ':');
    }
}


// ================= UI 与后台验证逻辑 =================
function getCookie(request, name) {
    let cookieString = request.headers.get('Cookie');
    if (!cookieString) return null;

    let cookies = cookieString.split(';');

    for (let cookie of cookies) {
        let [cName, cVal] = cookie.split('=').map(c => c.trim());
        if (cName === name) return cVal;
    }

    return null;
}


function escHtml(str) {
    return String(str === undefined || str === null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


function safeJSON(obj) {
    return JSON.stringify(obj)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}


async function handleAdminUI(
    request,
    env,
    sessionToken,
    AdminUser,
    AdminPass,
    guest,
    url,
    mytoken,
    FileName,
    subProtocol,
    subConverter,
    subConfig,
    userAgentHeader
) {
    const currentCookie = getCookie(request, 'admin_session');
    const isAuthenticated = currentCookie === sessionToken;

    if (url.pathname === '/') {
        return Response.redirect(`${url.origin}/admin`, 302);
    }

    if (url.pathname === '/logout') {
        return new Response(null, {
            status: 302,
            headers: {
                'Location': '/login',
                'Set-Cookie': `admin_session=; HttpOnly; Path=/; Max-Age=0`
            }
        });
    }

    if (request.method === 'POST' && url.pathname === '/login') {
        const formData = await request.formData();

        if (
            formData.get('username') === AdminUser &&
            formData.get('password') === AdminPass
        ) {
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/admin',
                    'Set-Cookie': `admin_session=${sessionToken}; HttpOnly; Path=/; Max-Age=864000; SameSite=Lax`
                }
            });
        } else {
            return new Response(renderLoginHTML(true), {
                headers: { 'Content-Type': 'text/html;charset=utf-8' }
            });
        }
    }

    if (!isAuthenticated) {
        return new Response(renderLoginHTML(), {
            headers: { 'Content-Type': 'text/html;charset=utf-8' }
        });
    }

    // ====== 【统一保存接口：一次提交，全部生效】 ======
    if (request.method === 'POST' && url.pathname === '/admin') {
        if (!env || !env.KV) {
            return jsonResponse({ ok: false, error: '未绑定 KV，配置无法保存' }, 400);
        }

        const contentType = request.headers.get('content-type') || '';
        let rawData;

        try {
            if (contentType.includes('application/json')) {
                rawData = await request.json();
            } else {
                // 兼容旧版纯文本保存
                const txt = await request.text();
                rawData = { links: txt };
            }
        } catch (e) {
            return jsonResponse({ ok: false, error: '请求体解析失败：' + e.message }, 400);
        }

        let cfg;
        try {
            cfg = normalizeIncoming(rawData);
        } catch (e) {
            return jsonResponse({ ok: false, error: e.message }, 400);
        }

        let current;
        try {
            current = await loadConfig(env, false);
        } catch (e) {
            current = defaultConfig();
        }

        let warning = '';
        const baseVersion = Number(rawData.version) || 0;
        if (current.version && baseVersion && current.version !== baseVersion) {
            warning = `检测到配置已在其他页面被修改（当前版本 ${current.version}，本次基于 ${baseVersion} 提交），已按本次内容覆盖。`;
        }

        cfg.version = (Number(current.version) || 0) + 1;
        cfg.savedAt = new Date().toISOString();

        try {
            // 单键写入 = 原子提交，杜绝"部分模块成功、部分失败"却报全部成功
            await env.KV.put(KV_SNAPSHOT_KEY, JSON.stringify(snapshotFor(cfg)));
        } catch (e) {
            return jsonResponse({ ok: false, error: '写入 KV 失败：' + e.message }, 500);
        }

        // 兼容旧键镜像（失败不影响已生效的快照）
        try {
            await env.KV.put('LINK.txt', cfg.links);
            await env.KV.put('CUSTOM_NODES.txt', cfg.customNodes);
            await env.KV.put('EDIT_CONFIG.json', JSON.stringify(cfg.rules));
        } catch (e) {
            console.error('兼容键镜像写入失败（不影响正式配置）:', e);
        }

        return jsonResponse({
            ok: true,
            version: cfg.version,
            savedAt: cfg.savedAt,
            warning: warning
        }, 200);
    }

    // ====== 页面渲染：读取正式生效配置 ======
    const hasKV = !!(env && env.KV);
    let cfg;

    if (hasKV) {
        cfg = await loadConfig(env, true);
    } else {
        cfg = defaultConfig();
        cfg.links = (env && env.LINK) || '';
    }

    return new Response(
        renderDashboardHTML({
            cfg: cfg,
            guest: guest,
            url: url,
            mytoken: mytoken,
            FileName: FileName,
            hasKV: hasKV,
            subProtocol: subProtocol,
            subConverter: subConverter,
            subConfig: subConfig
        }),
        {
            headers: {
                "Content-Type": "text/html;charset=utf-8",
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        }
    );
}


// ================= 全局样式 =================
const globalCSS = `<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
        background: #080d18;
        background-image:
            radial-gradient(900px 420px at 8% -6%, rgba(34, 211, 238, 0.10), transparent 60%),
            radial-gradient(760px 380px at 96% 0%, rgba(168, 85, 247, 0.10), transparent 62%);
        background-repeat: no-repeat;
        color: #e6edf7;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none; }
    .topbar {
        position: sticky; top: 0; z-index: 60;
        background: rgba(8, 13, 24, 0.88);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border-bottom: 1px solid #1a2740;
    }
    .topbar-in {
        max-width: 1440px; margin: 0 auto; padding: 10px 20px;
        display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-mark {
        width: 30px; height: 30px; border-radius: 9px;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #0ea5e9, #6366f1);
        box-shadow: 0 0 18px rgba(14, 165, 233, 0.35);
        font-size: 15px;
    }
    .brand-name { font-size: 14px; font-weight: 700; letter-spacing: 0.06em; }
    .brand-sub { font-size: 10px; color: #64748b; letter-spacing: 0.16em; text-transform: uppercase; }
    .clocks { display: flex; gap: 18px; margin-left: auto; }
    .clock { display: flex; flex-direction: column; line-height: 1.25; }
    .clock b { font-size: 9px; color: #64748b; letter-spacing: 0.16em; font-weight: 600; }
    .clock span {
        font-size: 12.5px; color: #cfe0f5; letter-spacing: 0.02em;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-variant-numeric: tabular-nums;
    }
    .top-actions { display: flex; align-items: center; gap: 10px; }
    .gstatus { font-size: 11px; color: #94a3b8; }
    .gstatus.warn { color: #fbbf24; }
    .gstatus.ok { color: #34d399; }
    .gstatus.error { color: #f87171; }
    .gstatus.busy { color: #60a5fa; }

    .wrap {
        max-width: 1440px; margin: 0 auto; padding: 18px 20px 60px;
        display: grid; grid-template-columns: minmax(0, 1fr) 348px; gap: 16px;
        align-items: start;
    }
    @media (max-width: 1180px) { .wrap { grid-template-columns: minmax(0, 1fr); } }
    main { min-width: 0; }
    aside { min-width: 0; }

    .card {
        background: #0d1526;
        border: 1px solid #1b2740;
        border-radius: 14px;
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.22);
        overflow: hidden;
    }
    .card + .card { margin-top: 16px; }
    .card-head {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        padding: 11px 14px;
        background: #111b2e;
        border-bottom: 1px solid #1b2740;
    }
    .card-head h2 { margin: 0; font-size: 14.5px; font-weight: 700; letter-spacing: 0.02em; }
    .card-body { padding: 14px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 10px #22d3ee; }
    .chip {
        font-size: 9.5px; padding: 2px 7px; border-radius: 999px;
        border: 1px solid #2b3d5c; color: #7f93b3; letter-spacing: 0.1em; text-transform: uppercase;
    }
    .card-actions { margin-left: auto; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .mod-status { font-size: 10.5px; color: #64748b; margin-right: 3px; white-space: nowrap; }
    .mod-status.ok { color: #34d399; }
    .mod-status.warn { color: #fbbf24; }
    .mod-status.info { color: #60a5fa; }
    .mod-status.error { color: #f87171; }
    .mod-status.busy { color: #a78bfa; }

    .btn {
        appearance: none; -webkit-appearance: none;
        border: 1px solid #26364f; background: #16233a; color: #d7e5f8;
        font-family: inherit; font-size: 12px; font-weight: 600;
        padding: 6px 11px; border-radius: 8px; cursor: pointer;
        transition: background .15s, border-color .15s, transform .1s, filter .15s;
        white-space: nowrap;
    }
    .btn:hover:not(:disabled) { background: #1d2d47; border-color: #3d5a86; }
    .btn:active:not(:disabled) { transform: translateY(1px); }
    .btn:disabled { opacity: .35; cursor: not-allowed; }
    .btn.green { background: linear-gradient(135deg, #0ea5e9, #22d3ee); border-color: transparent; color: #04111f; font-weight: 700; }
    .btn.green:hover:not(:disabled) { filter: brightness(1.08); }
    .btn.primary { background: linear-gradient(135deg, #4f46e5, #06b6d4); border-color: transparent; color: #f2fbff; }
    .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
    .btn.accent { background: #10263f; border-color: #2f5378; color: #7dd3fc; }
    .btn.danger { background: #2a1420; border-color: #6d2740; color: #fda4af; }
    .btn.ghost { background: transparent; border-color: #24334c; color: #9fb3cf; }
    .btn.sm { padding: 4px 9px; font-size: 11px; border-radius: 7px; }

    .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .field > label { font-size: 10.5px; color: #7f93b3; letter-spacing: 0.02em; }
    input[type="text"], input[type="number"], input[type="password"], textarea, select {
        width: 100%; background: #0a1220; border: 1px solid #22314a; border-radius: 8px;
        color: #e6edf7; font-family: inherit; font-size: 12.5px; padding: 7px 10px;
        outline: none; transition: border-color .15s, box-shadow .15s;
    }
    input[type="text"]:focus, input[type="number"]:focus, input[type="password"]:focus, textarea:focus, select:focus {
        border-color: #22d3ee; box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12);
    }
    textarea { resize: vertical; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    input::placeholder, textarea::placeholder { color: #465b78; }
    input[type="checkbox"] { accent-color: #22d3ee; width: 14px; height: 14px; cursor: pointer; }

    .mt8 { margin-top: 8px; }
    .mt10 { margin-top: 10px; }
    .mt12 { margin-top: 12px; }
    .mt14 { margin-top: 14px; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .hint { font-size: 10.5px; color: #64748b; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; }
    .check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #c2d3e8; cursor: pointer; user-select: none; }
    .act-row { display: flex; gap: 7px; align-items: stretch; }
    .act-row > input { flex: 1 1 auto; min-width: 0; }
    .act-row > .btn { flex: 0 0 auto; }
    .divider { height: 1px; background: #1b2740; margin: 12px 0; }

    .src-report { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
    .src-item {
        display: flex; gap: 8px; align-items: flex-start;
        font-size: 11px; padding: 6px 9px; border-radius: 8px;
        background: #0a1220; border: 1px solid #1e2c45; color: #9fb3cf;
        word-break: break-all;
    }
    .src-item.bad { border-color: #5a2130; background: #180d13; color: #fca5a5; }
    .src-item.good { border-color: #1c4136; background: #0a1a16; color: #86efac; }
    .src-tag { flex: 0 0 auto; font-weight: 700; font-size: 9.5px; letter-spacing: 0.08em; padding: 1px 6px; border-radius: 5px; background: #1c2b44; color: #93a9c8; }
    .src-item.bad .src-tag { background: #4a1a26; color: #fda4af; }
    .src-item.good .src-tag { background: #14372b; color: #6ee7b7; }

    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 7px; margin-bottom: 10px; }
    .stat { background: #0a1220; border: 1px solid #1e2c45; border-radius: 9px; padding: 6px 9px; }
    .stat b { display: block; font-size: 15px; color: #7dd3fc; font-variant-numeric: tabular-nums; line-height: 1.25; }
    .stat span { font-size: 10px; color: #64748b; }
    .stat.warn b { color: #fbbf24; }

    .opbar {
        display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
        font-size: 11px; color: #9fb3cf; background: #0a1220;
        border: 1px dashed #24344f; border-radius: 9px; padding: 7px 10px; margin-bottom: 10px;
    }

    .nodelist {
        list-style: none; margin: 0; padding: 0;
        max-height: 560px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 5px;
    }
    .node {
        display: flex; gap: 8px; align-items: flex-start;
        padding: 8px 10px; border: 1px solid #1e2c45; border-radius: 9px;
        background: #0a1220; transition: border-color .15s, background .15s;
    }
    .node:hover { border-color: #2f4670; background: #0c1727; }
    .node.is-fav { border-color: #8a6414; background: #17130a; }
    .node.is-off { opacity: .4; }
    .node-main { min-width: 0; flex: 1 1 auto; }
    .node-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 3px; }
    .badge {
        font-size: 9px; padding: 1px 5px; border-radius: 4px;
        border: 1px solid #2b3d5c; color: #9bb0cc;
        text-transform: uppercase; letter-spacing: 0.06em; background: #101c30;
    }
    .badge.custom { border-color: #6b2a63; color: #f0abfc; background: #1c1020; }
    .badge.info { border-color: #2f5378; color: #7dd3fc; }
    .badge.fav { border-color: #8a6414; color: #fcd34d; background: #1c1508; }
    .badge.off { border-color: #3a2a2a; color: #b08080; }
    .node-old { font-size: 10.5px; color: #5c708c; text-decoration: line-through; word-break: break-all; }
    .node-name { font-size: 12.5px; font-weight: 600; color: #eaf4ff; word-break: break-all; }
    .node-raw {
        font-size: 9.5px; color: #3f5570; margin-top: 3px; word-break: break-all;
        max-height: 0; overflow: hidden; transition: max-height .18s ease;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .node:hover .node-raw { max-height: 46px; }
    .star { background: none; border: none; cursor: pointer; font-size: 15px; line-height: 1; color: #3d4f6b; padding: 1px 3px; flex: 0 0 auto; }
    .star:hover { color: #fbbf24; }
    .star.on { color: #fbbf24; text-shadow: 0 0 9px rgba(251, 191, 36, 0.55); }
    .pick { margin-top: 3px; flex: 0 0 auto; }

    .empty { padding: 26px 12px; text-align: center; color: #5c708c; font-size: 12px; }

    .collapse-head { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
    .collapse-head h2 { margin: 0; font-size: 13.5px; font-weight: 700; }
    .collapse-arrow { margin-left: auto; font-size: 10px; color: #64748b; border: 1px solid #24334c; border-radius: 6px; padding: 1px 7px; }
    .collapse-body { display: none; margin-top: 12px; }
    .card.open .collapse-body { display: block; }

    .subgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .subcard {
        background: #0a1220; border: 1px solid #1e2c45; border-radius: 10px;
        padding: 8px; cursor: pointer; transition: border-color .15s, background .15s;
        display: flex; flex-direction: column; gap: 6px; min-width: 0;
    }
    .subcard:hover { border-color: #22d3ee; background: #0c1a2a; }
    .subcard-tag { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: #7dd3fc; }
    .subcard-qr { align-self: center; background: #fff; padding: 3px; border-radius: 5px; line-height: 0; }
    .subcard-url { font-size: 8.5px; color: #465b78; word-break: break-all; text-align: center; font-family: ui-monospace, Menlo, Consolas, monospace; }
    .kv { display: flex; gap: 6px; font-size: 11px; color: #8fa1bd; word-break: break-all; }
    .kv b { color: #a78bfa; flex: 0 0 auto; }

    .toast-wrap { position: fixed; top: 62px; right: 18px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
    .toast {
        min-width: 190px; max-width: 380px;
        background: #101c30; border: 1px solid #22d3ee; border-left-width: 3px;
        color: #e6edf7; font-size: 12px; font-weight: 600;
        padding: 9px 13px; border-radius: 9px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
        transform: translateX(120%); opacity: 0;
        transition: transform .25s ease, opacity .25s ease;
        word-break: break-word;
    }
    .toast.show { transform: translateX(0); opacity: 1; }
    .toast.error { border-color: #ef4444; }
    .toast.warn { border-color: #f59e0b; }

    .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .login-card {
        width: 100%; max-width: 372px; background: #0d1526;
        border: 1px solid #1b2740; border-radius: 16px; padding: 28px 26px 24px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    }
    .login-title { font-size: 19px; font-weight: 700; letter-spacing: 0.06em; margin: 0 0 4px; }
    .login-sub { font-size: 10.5px; color: #64748b; letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 22px; }
    .login-err {
        background: #2a1420; border: 1px solid #6d2740; color: #fda4af;
        font-size: 12px; padding: 8px 11px; border-radius: 8px; margin-bottom: 14px;
    }
    .login-btn {
        width: 100%; margin-top: 18px; padding: 10px; border: none; border-radius: 9px;
        background: linear-gradient(135deg, #4f46e5, #06b6d4); color: #f2fbff;
        font-family: inherit; font-size: 12.5px; font-weight: 700; letter-spacing: 0.1em;
        cursor: pointer; transition: filter .15s;
    }
    .login-btn:hover { filter: brightness(1.1); }

    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #0a1220; }
    ::-webkit-scrollbar-thumb { background: #26364f; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #3d5a86; }
</style>`;


function renderLoginHTML(isError = false) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>系统后台登录</title>
    ${globalCSS}
</head>
<body>
    <div class="login-wrap">
        <div class="login-card">
            <h1 class="login-title">NODE <span style="color:#22d3ee">HUB</span></h1>
            <p class="login-sub">Secure Aggregation Console</p>

            ${isError ? '<div class="login-err">账号或密码错误，请重试</div>' : ''}

            <form action="/login" method="POST">
                <div class="field">
                    <label>用户名</label>
                    <input type="text" name="username" placeholder="请输入用户名" required>
                </div>
                <div class="field mt12">
                    <label>密码</label>
                    <input type="password" name="password" placeholder="请输入密码" required>
                </div>
                <button type="submit" class="login-btn">授权登录</button>
            </form>
        </div>
    </div>
</body>
</html>`;
}


function renderDashboardHTML(ctx) {
    const cfg = ctx.cfg;
    const guest = ctx.guest;
    const url = ctx.url;
    const mytoken = ctx.mytoken;
    const FileName = ctx.FileName;
    const hasKV = ctx.hasKV;
    const subProtocol = ctx.subProtocol;
    const subConverter = ctx.subConverter;
    const subConfig = ctx.subConfig;

    const rules = Object.assign({}, DEFAULT_NODE_EDIT_CONFIG, cfg.rules || {});
    const output = cfg.output || { limitEnabled: false, limit: 0 };
    const previewState = cfg.preview || { keyword: '', onlyFav: false };

    const boot = {
        version: cfg.version || 0,
        savedAt: cfg.savedAt || '',
        hasKV: hasKV,
        seed: dailySeed(),
        config: {
            links: cfg.links || '',
            customNodes: cfg.customNodes || '',
            rules: rules,
            output: output,
            favorites: cfg.favorites || [],
            preview: previewState
        }
    };

    const subItems = [
        { name: '自适应', path: `/${mytoken}?sub`, tag: 'AUTO' },
        { name: 'Base64', path: `/${mytoken}?b64`, tag: 'BASE64' },
        { name: 'Clash', path: `/${mytoken}?clash`, tag: 'CLASH' },
        { name: 'Singbox', path: `/${mytoken}?sb`, tag: 'SINGBOX' }
    ];

    const subCard = (item, prefix) => `
        <div class="subcard" data-copy="${escHtml(url.origin + item.path)}" title="点击复制订阅地址">
            <span class="subcard-tag">${item.tag}</span>
            <div class="subcard-qr" id="${prefix}_${item.name}"></div>
            <div class="subcard-url">${escHtml(item.path)}</div>
        </div>
    `;

    const guestItems = subItems.map(item => ({
        name: item.name,
        tag: item.tag,
        path: `/sub?token=${guest}${item.path.split('?')[1] ? '&' + item.path.split('?')[1] : ''}`
    }));

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escHtml(FileName)} - Node Console</title>
    <script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
    ${globalCSS}
</head>
<body>
<div class="toast-wrap" id="toastWrap"></div>

<header class="topbar">
    <div class="topbar-in">
        <div class="brand">
            <div class="brand-mark">⚡</div>
            <div>
                <div class="brand-name">${escHtml(FileName)}</div>
                <div class="brand-sub">Node Console</div>
            </div>
        </div>

        <div class="clocks">
            <div class="clock"><b>CN 时间</b><span id="clockCN">----</span></div>
            <div class="clock"><b>UTC 时间</b><span id="clockUTC">----</span></div>
        </div>

        <div class="top-actions">
            <span class="gstatus" id="globalStatus">未修改</span>
            <button class="btn primary" id="btnGlobalSave">保存所有配置</button>
            <a href="/logout" class="btn ghost">登出</a>
        </div>
    </div>
</header>

<div class="wrap">
    <main>

        <!-- ============ 模块 1：节点抓取源 ============ -->
        <section class="card" id="card-links">
            <div class="card-head">
                <span class="dot"></span>
                <h2>节点抓取源</h2>
                <span class="chip">Sub Links</span>
                <div class="card-actions">
                    <span class="mod-status" id="st-links">未修改</span>
                    <button class="btn sm" data-act="undo" data-mod="links" disabled>撤销</button>
                    <button class="btn sm" data-act="redo" data-mod="links" disabled>重做</button>
                    <button class="btn sm" data-act="revert" data-mod="links">取消恢复</button>
                    <button class="btn sm accent" data-act="module-save" data-mod="links">保存配置</button>
                </div>
            </div>
            <div class="card-body" id="body-links">
                ${hasKV ? `
                <textarea id="ta_links" rows="5" spellcheck="false" placeholder="每行一个订阅链接，或直接粘贴明文节点&#10;https://example.com/sub?token=xxx&#10;vless://...#香港01">${escHtml(cfg.links || '')}</textarea>
                <div class="row mt10">
                    <button class="btn green" id="btnFetch">抓取并预览</button>
                    <span class="hint">明文节点与远程订阅可混填；逐个链接独立抓取，单条失败不影响其他</span>
                </div>
                <div class="src-report" id="srcReport"></div>
                ` : '<div class="empty" style="color:#f87171">未绑定 KV，配置无法读取与保存</div>'}
            </div>
        </section>

        <!-- ============ 模块 2：节点二次编辑规则 ============ -->
        <section class="card" id="card-rules">
            <div class="card-head">
                <span class="dot"></span>
                <h2>节点二次编辑规则</h2>
                <span class="chip">Rules</span>
                <div class="card-actions">
                    <span class="mod-status" id="st-rules">未修改</span>
                    <button class="btn sm" data-act="undo" data-mod="rules" disabled>撤销</button>
                    <button class="btn sm" data-act="redo" data-mod="rules" disabled>重做</button>
                    <button class="btn sm" data-act="revert" data-mod="rules">取消恢复</button>
                    <button class="btn sm accent" data-act="module-save" data-mod="rules">保存配置</button>
                </div>
            </div>
            <div class="card-body" id="body-rules">

                <div class="checks">
                    <label class="check"><input type="checkbox" id="chk_autoEmoji" ${rules.autoEmoji ? 'checked' : ''}> 自动地区 Emoji</label>
                    <label class="check"><input type="checkbox" id="chk_deepDeduplicate" ${rules.deepDeduplicate ? 'checked' : ''}> 深度去重（同 IP 端口）</label>
                    <label class="check"><input type="checkbox" id="chk_sortNodes" ${rules.sortNodes ? 'checked' : ''}> 智能排序（信息置顶）</label>
                    <label class="check"><input type="checkbox" id="chk_dropInvalidNodes" ${rules.dropInvalidNodes ? 'checked' : ''}> 剔除无效节点</label>
                </div>

                <div class="divider"></div>

                <div class="grid2">
                    <div class="field">
                        <label>只保留协议（逗号分隔，留空不限制）</label>
                        <input type="text" id="in_retainProtocols" value="${escHtml((rules.retainProtocols || []).join(','))}" placeholder="vmess,vless,trojan">
                    </div>
                    <div class="field">
                        <label>剔除协议（逗号分隔，留空不限制）</label>
                        <input type="text" id="in_dropProtocols" value="${escHtml((rules.dropProtocols || []).join(','))}" placeholder="ssr,http">
                    </div>
                </div>

                <div class="divider"></div>

                <div class="field">
                    <label>查找关键字（仅临时筛选预览显示，不修改节点）</label>
                    <div class="act-row">
                        <input type="text" id="in_keyword" value="${escHtml(previewState.keyword || '')}" placeholder="输入关键字，如 香港">
                        <button class="btn accent" id="btnSearch">查找</button>
                        <button class="btn ghost" id="btnClearSearch">清除</button>
                    </div>
                </div>

                <div class="grid2 mt10">
                    <div class="field">
                        <label>替换：查找内容</label>
                        <input type="text" id="in_replaceTarget" value="${escHtml(rules.replaceTarget || '')}" placeholder="如 @clashV8">
                    </div>
                    <div class="field">
                        <label>替换：替换为（留空即删除）</label>
                        <div class="act-row">
                            <input type="text" id="in_replaceWith" value="${escHtml(rules.replaceWith || '')}" placeholder="如 星链">
                            <button class="btn accent" id="btnReplace">替换</button>
                        </div>
                    </div>
                </div>

                <div class="divider"></div>

                <div class="grid2">
                    <div class="field">
                        <label>正则保留（节点名称）</label>
                        <div class="act-row">
                            <input type="text" id="in_retainNameRegex" value="${escHtml(rules.retainNameRegex || '')}" placeholder="如 香港|日本">
                            <button class="btn accent" id="btnApplyRetain">执行保留</button>
                        </div>
                    </div>
                    <div class="field">
                        <label>正则剔除（节点名称）</label>
                        <div class="act-row">
                            <input type="text" id="in_dropNameRegex" value="${escHtml(rules.dropNameRegex || '')}" placeholder="如 过期|流量">
                            <button class="btn accent" id="btnApplyDrop">执行剔除</button>
                        </div>
                    </div>
                </div>

                <div class="grid3 mt10">
                    <div class="field">
                        <label>全局重命名</label>
                        <div class="act-row">
                            <input type="text" id="in_globalRename" value="${escHtml(rules.globalRename || '')}" placeholder="如 专属节点">
                            <button class="btn accent" id="btnApplyRename">执行重命名</button>
                        </div>
                    </div>
                    <div class="field">
                        <label>统一前缀</label>
                        <div class="act-row">
                            <input type="text" id="in_addPrefix" value="${escHtml(rules.addPrefix || '')}" placeholder="如 🚀">
                            <button class="btn accent" id="btnApplyPrefix">添加前缀</button>
                        </div>
                    </div>
                    <div class="field">
                        <label>统一后缀</label>
                        <div class="act-row">
                            <input type="text" id="in_addSuffix" value="${escHtml(rules.addSuffix || '')}" placeholder="如 [Pro]">
                            <button class="btn accent" id="btnApplySuffix">添加后缀</button>
                        </div>
                    </div>
                </div>

                <div class="row mt12">
                    <button class="btn ghost" id="btnPreviewRefresh">刷新预览</button>
                    <span class="hint">规则只有点击对应按钮后才会执行，输入过程不会改动节点</span>
                </div>
            </div>
        </section>

        <!-- ============ 模块 3：实时节点预览 ============ -->
        <section class="card" id="card-preview">
            <div class="card-head">
                <span class="dot" style="background:#a78bfa;box-shadow:0 0 10px #a78bfa"></span>
                <h2>实时节点预览</h2>
                <span class="chip">Live Preview</span>
                <div class="card-actions">
                    <span class="mod-status" id="st-preview">未修改</span>
                    <button class="btn sm" data-act="undo" data-mod="preview" disabled>撤销</button>
                    <button class="btn sm" data-act="redo" data-mod="preview" disabled>重做</button>
                    <button class="btn sm" data-act="revert" data-mod="preview">取消恢复</button>
                    <button class="btn sm accent" data-act="module-save" data-mod="preview">保存配置</button>
                </div>
            </div>
            <div class="card-body" id="body-preview">

                <div class="grid3" style="align-items:end">
                    <div class="field">
                        <label>输出节点数量（留空或关闭即不限制）</label>
                        <input type="number" id="in_limit" min="1" step="1" value="${output.limitEnabled ? escHtml(output.limit) : ''}" placeholder="如 50">
                    </div>
                    <label class="check" style="height:32px">
                        <input type="checkbox" id="chk_limitEnabled" ${output.limitEnabled ? 'checked' : ''}> 启用数量限制
                    </label>
                    <label class="check" style="height:32px">
                        <input type="checkbox" id="chk_onlyFav" ${previewState.onlyFav ? 'checked' : ''}> 只看已收藏
                    </label>
                </div>
                <div class="hint mt8" id="limitHint">收藏节点始终优先保留，其余名额从普通节点中随机补足，随机结果按天固定。</div>

                <div class="stats mt12" id="statsBox"></div>

                <div class="opbar" id="opBar">尚未执行任何操作</div>

                <div class="row" style="margin-bottom:8px">
                    <span class="hint">勾选节点后可为它们单独指定前后缀</span>
                    <input type="text" id="in_batchPrefix" placeholder="指定前缀" style="width:120px">
                    <input type="text" id="in_batchSuffix" placeholder="指定后缀" style="width:120px">
                    <button class="btn sm accent" id="btnBatchApply">对选中项应用</button>
                    <button class="btn sm danger" id="btnBatchClear">清除专属规则</button>
                    <span class="hint" id="selCount" style="margin-left:auto">已选 0 项</span>
                </div>

                <ul class="nodelist" id="nodeList">
                    <li class="empty">还没有预览数据，请先在「节点抓取源」点击「抓取并预览」</li>
                </ul>
            </div>
        </section>

        <!-- ============ 模块 4：自定义输出节点 ============ -->
        <section class="card" id="card-custom">
            <div class="card-head">
                <span class="dot" style="background:#f472b6;box-shadow:0 0 10px #f472b6"></span>
                <h2>自定义输出节点</h2>
                <span class="chip">Custom Output</span>
                <div class="card-actions">
                    <span class="mod-status" id="st-custom">未修改</span>
                    <button class="btn sm" data-act="undo" data-mod="custom" disabled>撤销</button>
                    <button class="btn sm" data-act="redo" data-mod="custom" disabled>重做</button>
                    <button class="btn sm" data-act="revert" data-mod="custom">取消恢复</button>
                    <button class="btn sm accent" data-act="module-save" data-mod="custom">保存配置</button>
                </div>
            </div>
            <div class="card-body" id="body-custom">
                <textarea id="ta_customNodes" rows="4" spellcheck="false" placeholder="每行一个自建节点，不受上方普通过滤规则影响，但会计入最终数量限制">${escHtml(cfg.customNodes || '')}</textarea>
                <div class="row mt10">
                    <button class="btn accent" id="btnCustomPreview">更新预览</button>
                    <span class="hint">自定义节点与远程节点数据隔离，不会互相覆盖</span>
                </div>
            </div>
        </section>

    </main>

    <aside>
        <section class="card open" id="cardMySubs">
            <div class="card-head">
                <div class="collapse-head" style="width:100%" data-toggle="cardMySubs">
                    <h2>专属地址 My Subs</h2>
                    <span class="collapse-arrow">收起 ▲</span>
                </div>
            </div>
            <div class="card-body collapse-body">
                <div class="subgrid">
                    ${subItems.map(item => subCard(item, 'qr_my')).join('')}
                </div>
            </div>
        </section>

        <section class="card" id="cardGuest">
            <div class="card-head">
                <div class="collapse-head" style="width:100%" data-toggle="cardGuest">
                    <h2>访客订阅 Guest Subs</h2>
                    <span class="collapse-arrow">展开 ▼</span>
                </div>
            </div>
            <div class="card-body collapse-body">
                <div class="kv" style="margin-bottom:10px"><b>TOKEN</b><span>${escHtml(guest)}</span></div>
                <div class="subgrid">
                    ${guestItems.map(item => subCard(item, 'qr_guest')).join('')}
                </div>
            </div>
        </section>

        <section class="card">
            <div class="card-head"><h2>运行信息</h2></div>
            <div class="card-body">
                <div class="kv" style="margin-bottom:6px"><b>SUBAPI</b><span>${escHtml(subProtocol + '://' + subConverter)}</span></div>
                <div class="kv" style="margin-bottom:6px"><b>CONFIG</b><span>${escHtml(subConfig)}</span></div>
                <div class="kv" style="margin-bottom:6px"><b>配置版本</b><span id="verText">v${cfg.version || 0}</span></div>
                <div class="kv"><b>保存时间</b><span id="savedAtText">${cfg.savedAt ? escHtml(new Date(cfg.savedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })) : '尚未保存'}</span></div>
            </div>
        </section>
    </aside>
</div>

<script id="boot-data" type="application/json">${safeJSON(boot)}</script>

<script>
(function () {
    'use strict';

    var BOOT = JSON.parse(document.getElementById('boot-data').textContent);
    var MOD_KEYS = ['links', 'rules', 'preview', 'custom'];

    /* ======================= 基础工具 ======================= */
    function $(id) { return document.getElementById(id); }
    function valOf(id) { var e = $(id); return e ? e.value : ''; }
    function checkedOf(id) { var e = $(id); return e ? !!e.checked : false; }
    function setVal(id, v) { var e = $(id); if (e) e.value = (v === undefined || v === null) ? '' : v; }
    function setChk(id, v) { var e = $(id); if (e) e.checked = !!v; }
    function clone(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function nowTime() {
        var d = new Date();
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }
    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function sameJSON(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

    function toast(msg, type, ms) {
        var wrap = $('toastWrap');
        if (!wrap) return;
        var t = document.createElement('div');
        t.className = 'toast' + (type === 'error' ? ' error' : (type === 'warn' ? ' warn' : ''));
        t.textContent = msg;
        wrap.appendChild(t);
        requestAnimationFrame(function () { t.classList.add('show'); });
        setTimeout(function () {
            t.classList.remove('show');
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 280);
        }, ms || 3000);
    }

    function splitList(v) {
        if (!v) return [];
        var parts = String(v).split(/[,，\\s]+/);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].trim().toLowerCase();
            if (p && out.indexOf(p) < 0) out.push(p);
        }
        return out;
    }

    function tryRegex(pattern, flags, label) {
        if (!pattern) return;
        try {
            new RegExp(pattern, flags);
        } catch (e) {
            throw new Error((label || '') + ' 正则表达式无效：' + e.message);
        }
    }

    /* ======================= 双时钟（CN = UTC+8 / UTC） ======================= */
    function clockText(offsetSeconds) {
        var d = new Date(Date.now() + offsetSeconds * 1000);
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
            ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
    }
    function tickClock() {
        var cn = $('clockCN');
        var utc = $('clockUTC');
        if (cn) cn.textContent = clockText(8 * 3600);
        if (utc) utc.textContent = clockText(0);
    }
    tickClock();
    setInterval(tickClock, 1000);

    /* ======================= 全局状态 ======================= */
    var App = {
        version: BOOT.version || 0,
        baseline: clone(BOOT.config || {}),
        favorites: normFav((BOOT.config || {}).favorites),
        specific: clone(((BOOT.config || {}).rules || {}).specificRules || {}),
        merged: [],
        sources: [],
        stats: null,
        seed: BOOT.seed || '',
        loaded: false,
        fetching: false,
        queueFetch: false,
        globalBusy: false,
        lastOp: '尚未执行任何操作',
        appliedKeyword: ((BOOT.config || {}).preview || {}).keyword || '',
        visibleCount: 0,
        limitInfo: null,
        savedLabel: ''
    };

    function normFav(arr) {
        var out = [];
        if (!Array.isArray(arr)) return out;
        for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            var id = '';
            var name = '';
            if (typeof it === 'string') {
                id = it;
            } else if (it && typeof it === 'object') {
                id = it.id || it.fingerprint || '';
                name = it.name || '';
            }
            id = String(id || '').trim();
            if (!id) continue;
            var dup = false;
            for (var j = 0; j < out.length; j++) { if (out[j].id === id) { dup = true; break; } }
            if (!dup) out.push({ id: id, name: String(name) });
        }
        return out;
    }

    /* ======================= 模块定义 ======================= */
    var MODS = {};
    function defMod(key, collect, apply) {
        MODS[key] = {
            key: key, collect: collect, apply: apply,
            history: [], hIndex: -1,
            saved: null, savedTime: '', pending: false, error: ''
        };
    }

    function collectLinks() { return { links: valOf('ta_links') }; }
    function applyLinks(s) { if (s) setVal('ta_links', s.links); }

    function collectCustom() { return { customNodes: valOf('ta_customNodes') }; }
    function applyCustom(s) { if (s) setVal('ta_customNodes', s.customNodes); }

    function collectRules() {
        return {
            autoEmoji: checkedOf('chk_autoEmoji'),
            deepDeduplicate: checkedOf('chk_deepDeduplicate'),
            sortNodes: checkedOf('chk_sortNodes'),
            dropInvalidNodes: checkedOf('chk_dropInvalidNodes'),
            retainProtocols: splitList(valOf('in_retainProtocols')),
            dropProtocols: splitList(valOf('in_dropProtocols')),
            replaceTarget: valOf('in_replaceTarget'),
            replaceWith: valOf('in_replaceWith'),
            retainNameRegex: valOf('in_retainNameRegex'),
            dropNameRegex: valOf('in_dropNameRegex'),
            globalRename: valOf('in_globalRename'),
            addPrefix: valOf('in_addPrefix'),
            addSuffix: valOf('in_addSuffix'),
            specificRules: clone(App.specific)
        };
    }

    function applyRules(s) {
        if (!s) return;
        setChk('chk_autoEmoji', s.autoEmoji);
        setChk('chk_deepDeduplicate', s.deepDeduplicate);
        setChk('chk_sortNodes', s.sortNodes);
        setChk('chk_dropInvalidNodes', s.dropInvalidNodes);
        setVal('in_retainProtocols', (s.retainProtocols || []).join(','));
        setVal('in_dropProtocols', (s.dropProtocols || []).join(','));
        setVal('in_replaceTarget', s.replaceTarget);
        setVal('in_replaceWith', s.replaceWith);
        setVal('in_retainNameRegex', s.retainNameRegex);
        setVal('in_dropNameRegex', s.dropNameRegex);
        setVal('in_globalRename', s.globalRename);
        setVal('in_addPrefix', s.addPrefix);
        setVal('in_addSuffix', s.addSuffix);
        App.specific = clone(s.specificRules || {});
    }

    function collectPreview() {
        return {
            limitEnabled: checkedOf('chk_limitEnabled'),
            limit: valOf('in_limit'),
            keyword: App.appliedKeyword || '',
            onlyFav: checkedOf('chk_onlyFav')
        };
    }

    function applyPreview(s) {
        if (!s) return;
        setChk('chk_limitEnabled', s.limitEnabled);
        setVal('in_limit', s.limit);
        setChk('chk_onlyFav', s.onlyFav);
        App.appliedKeyword = s.keyword || '';
        setVal('in_keyword', s.keyword || '');
        if (s.keyword) {
            $('limitHint').textContent = '当前处于查找筛选状态：仅显示匹配「' + s.keyword + '」的节点，不影响最终输出。';
        }
    }

    defMod('links', collectLinks, applyLinks);
    defMod('rules', collectRules, applyRules);
    defMod('preview', collectPreview, applyPreview);
    defMod('custom', collectCustom, applyCustom);

    /* ======================= 基准状态（上次全局保存） ======================= */
    function normRules(r) {
        r = r || {};
        return {
            autoEmoji: r.autoEmoji !== false,
            deepDeduplicate: r.deepDeduplicate !== false,
            sortNodes: r.sortNodes !== false,
            dropInvalidNodes: r.dropInvalidNodes !== false,
            retainProtocols: splitList((r.retainProtocols || []).join(',')),
            dropProtocols: splitList((r.dropProtocols || []).join(',')),
            replaceTarget: r.replaceTarget || '',
            replaceWith: r.replaceWith || '',
            retainNameRegex: r.retainNameRegex || '',
            dropNameRegex: r.dropNameRegex || '',
            globalRename: r.globalRename || '',
            addPrefix: r.addPrefix || '',
            addSuffix: r.addSuffix || '',
            specificRules: r.specificRules || {}
        };
    }

    function baselineSlice(key) {
        var b = App.baseline || {};
        if (key === 'links') return { links: b.links || '' };
        if (key === 'custom') return { customNodes: b.customNodes || '' };
        if (key === 'rules') return normRules(b.rules);
        if (key === 'preview') {
            var o = b.output || {};
            var p = b.preview || {};
            return {
                limitEnabled: !!o.limitEnabled,
                limit: (o.limitEnabled && o.limit) ? String(o.limit) : '',
                keyword: p.keyword || '',
                onlyFav: !!p.onlyFav
            };
        }
        return {};
    }

    /* ======================= 历史记录（每模块独立，最多 10 步） ======================= */
    function hPush(key) {
        var m = MODS[key];
        if (!m) return;
        var cur = m.collect();
        if (m.hIndex >= 0 && sameJSON(m.history[m.hIndex], cur)) { refreshMod(key); return; }
        m.history = m.history.slice(0, m.hIndex + 1);   // 新修改清除重做分支
        m.history.push(clone(cur));
        while (m.history.length > 11) m.history.shift(); // 11 个状态 = 最多回退 10 步
        m.hIndex = m.history.length - 1;
        refreshMod(key);
    }

    function hReset(key, state) {
        var m = MODS[key];
        if (!m) return;
        m.history = [clone(state === undefined ? m.collect() : state)];
        m.hIndex = 0;
    }

    function hUndo(key) {
        var m = MODS[key];
        if (!m || m.hIndex <= 0) return;
        m.hIndex--;
        m.apply(clone(m.history[m.hIndex]));
        afterStateChange(key);
        toast('已撤销（' + (m.hIndex) + '/10）');
    }

    function hRedo(key) {
        var m = MODS[key];
        if (!m || m.hIndex >= m.history.length - 1) return;
        m.hIndex++;
        m.apply(clone(m.history[m.hIndex]));
        afterStateChange(key);
        toast('已重做（' + (m.hIndex) + '/10）');
    }

    function afterStateChange(key) {
        refreshAll();
        if (key === 'preview') {
            applySelectionLocal();
            renderNodes();
            renderStats();
            renderOpBar();
        } else {
            fetchPreview('撤销/重做');
        }
    }

    /* ======================= 状态渲染 ======================= */
    function refreshMod(key) {
        var m = MODS[key];
        if (!m) return;
        var cur = JSON.stringify(m.collect());
        var savedJson = m.saved ? JSON.stringify(m.saved) : '';
        var baseJson = JSON.stringify(baselineSlice(key));

        var st = $('st-' + key);
        if (st) {
            var text = '未修改';
            var tone = 'ok';
            if (m.pending) { text = '正在提交...'; tone = 'busy'; }
            else if (m.error) { text = m.error; tone = 'error'; }
            else if (savedJson && cur !== savedJson) { text = '有未暂存修改'; tone = 'warn'; }
            else if (savedJson && savedJson !== baseJson) { text = '已暂存，待全局保存'; tone = 'info'; }
            else if (m.savedTime) { text = '已保存 ' + m.savedTime; tone = 'ok'; }
            st.textContent = text;
            st.className = 'mod-status ' + tone;
        }

        var undoBtn = document.querySelector('[data-act="undo"][data-mod="' + key + '"]');
        var redoBtn = document.querySelector('[data-act="redo"][data-mod="' + key + '"]');
        if (undoBtn) undoBtn.disabled = m.hIndex <= 0;
        if (redoBtn) redoBtn.disabled = m.hIndex >= m.history.length - 1;
    }

    function refreshGlobal() {
        var el = $('globalStatus');
        if (!el) return;
        if (App.globalBusy) { el.textContent = '正在提交全部配置...'; el.className = 'gstatus busy'; return; }
        if (App.globalError) { el.textContent = App.globalError; el.className = 'gstatus error'; return; }

        var dirty = 0, staged = 0;
        for (var i = 0; i < MOD_KEYS.length; i++) {
            var k = MOD_KEYS[i];
            var m = MODS[k];
            var cur = JSON.stringify(m.collect());
            var savedJson = m.saved ? JSON.stringify(m.saved) : '';
            if (savedJson && cur !== savedJson) dirty++;
            else if (savedJson && savedJson !== JSON.stringify(baselineSlice(k))) staged++;
        }
        var favChanged = !sameJSON(App.favorites, normFav(App.baseline.favorites));

        if (dirty) { el.textContent = dirty + ' 个模块有未暂存修改'; el.className = 'gstatus warn'; }
        else if (staged) { el.textContent = staged + ' 个模块待全局保存'; el.className = 'gstatus warn'; }
        else if (favChanged) { el.textContent = '收藏列表有未保存修改'; el.className = 'gstatus warn'; }
        else { el.textContent = App.savedLabel || '全部已保存'; el.className = 'gstatus ok'; }
    }

    function refreshAll() {
        for (var i = 0; i < MOD_KEYS.length; i++) refreshMod(MOD_KEYS[i]);
        refreshGlobal();
    }

    /* ======================= 网络 ======================= */
    function postJSON(url, payload, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var ctrl = new AbortController();
            var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 30000);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'same-origin',
                signal: ctrl.signal
            }).then(function (res) {
                clearTimeout(timer);
                return res.text().then(function (txt) {
                    var data;
                    try {
                        data = txt ? JSON.parse(txt) : {};
                    } catch (e) {
                        data = { ok: res.ok, error: txt || ('HTTP ' + res.status) };
                    }
                    if (!res.ok && !data.error) data.error = 'HTTP ' + res.status;
                    if (!res.ok) data.ok = false;
                    resolve(data);
                });
            }).catch(function (e) {
                clearTimeout(timer);
                reject(new Error(e && e.name === 'AbortError' ? '请求超时' : (e.message || '网络异常')));
            });
        });
    }

    function buildPayload() {
        var pv = collectPreview();
        var n = parseInt(pv.limit, 10);
        return {
            version: App.version,
            links: valOf('ta_links'),
            customNodes: valOf('ta_customNodes'),
            rules: collectRules(),
            favorites: clone(App.favorites),
            output: {
                limitEnabled: !!pv.limitEnabled,
                limit: (isFinite(n) && n > 0) ? n : 0
            },
            preview: { keyword: pv.keyword || '', onlyFav: !!pv.onlyFav }
        };
    }

    /* ======================= 数量限制（前端复算，与服务端同一算法） ======================= */
    function hashSeed(str) {
        var h = 2166136261 >>> 0;
        var s = String(str || '');
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h >>> 0;
    }

    function mulberry32(a) {
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function seededShuffle(arr, seed) {
        var out = arr.slice();
        var rnd = mulberry32(hashSeed(seed));
        for (var i = out.length - 1; i > 0; i--) {
            var j = Math.floor(rnd() * (i + 1));
            var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
        }
        return out;
    }

    function applySelectionLocal() {
        var pv = collectPreview();
        var enabled = !!pv.limitEnabled;
        var limit = parseInt(pv.limit, 10);

        var favCount = 0, infoCount = 0, normalIdx = [];
        for (var i = 0; i < App.merged.length; i++) {
            var n = App.merged[i];
            if (n.isInfoNode) { n.selected = true; infoCount++; continue; }
            if (n.favorite) { n.selected = true; favCount++; continue; }
            n.selected = false;
            normalIdx.push(i);
        }

        var exceeded = false;
        if (!enabled || !isFinite(limit) || limit < 1) {
            for (var a = 0; a < normalIdx.length; a++) App.merged[normalIdx[a]].selected = true;
        } else if (favCount >= limit) {
            exceeded = favCount > limit;
        } else {
            var remain = limit - favCount;
            var picked = seededShuffle(normalIdx, App.seed).slice(0, remain);
            for (var b = 0; b < picked.length; b++) App.merged[picked[b]].selected = true;
        }

        var outCount = 0;
        for (var c = 0; c < App.merged.length; c++) if (App.merged[c].selected) outCount++;

        App.limitInfo = {
            enabled: enabled && isFinite(limit) && limit >= 1,
            limit: isFinite(limit) ? limit : 0,
            available: favCount + normalIdx.length,
            favorites: favCount,
            info: infoCount,
            output: outCount,
            exceeded: exceeded
        };
    }

    /* ======================= 渲染：抓取源上报 ======================= */
    function renderSources() {
        var box = $('srcReport');
        if (!box) return;
        var s = App.sources || [];
        var html = [];

        if (App.plainCount) {
            html.push('<div class="src-item good">');
            html.push('<span class="src-tag">明文</span>');
            html.push('<span>直接填写的明文节点 ' + App.plainCount + ' 行</span>');
            html.push('</div>');
        }

        for (var i = 0; i < s.length; i++) {
            var it = s[i];
            html.push('<div class="src-item ' + (it.ok ? 'good' : 'bad') + '">');
            html.push('<span class="src-tag">' + (it.ok ? 'OK' : 'FAIL') + '</span>');
            html.push('<span>' + esc(it.host || it.url) + ' · ' +
                (it.ok ? ('解析 ' + it.nodes + ' 个节点') : esc(it.error || '抓取失败')) + '</span>');
            html.push('</div>');
        }

        box.innerHTML = html.join('');
    }

    /* ======================= 渲染：节点列表 ======================= */
    function renderNodes() {
        var list = $('nodeList');
        if (!list) return;

        if (!App.loaded) {
            list.innerHTML = '<li class="empty">还没有预览数据，请先在「节点抓取源」点击「抓取并预览」</li>';
            App.visibleCount = 0;
            return;
        }

        var pv = collectPreview();
        var kw = (pv.keyword || '').trim().toLowerCase();
        var onlyFav = !!pv.onlyFav;
        var rows = [];

        for (var i = 0; i < App.merged.length; i++) {
            var n = App.merged[i];
            var hit = true;
            if (kw) {
                var nm = (n.name || '').toLowerCase();
                var on = (n.originalName || '').toLowerCase();
                hit = nm.indexOf(kw) >= 0 || on.indexOf(kw) >= 0;
            }
            if (onlyFav && !n.favorite) hit = false;
            if (hit) rows.push(i);
        }

        App.visibleCount = rows.length;

        if (!rows.length) {
            list.innerHTML = '<li class="empty">没有符合条件的节点（可能是查找条件过严，或全部被规则剔除）</li>';
            return;
        }

        var MAXR = 800;
        var shown = rows.slice(0, MAXR);
        var html = [];

        for (var r = 0; r < shown.length; r++) {
            var idx = shown[r];
            var node = App.merged[idx];
            var cls = 'node' + (node.favorite ? ' is-fav' : '') + (node.selected ? '' : ' is-off');

            html.push('<li class="' + cls + '">');
            html.push('<button class="star' + (node.favorite ? ' on' : '') + '" data-act="fav" data-i="' + idx + '" title="收藏 / 取消收藏">' +
                (node.favorite ? '★' : '☆') + '</button>');
            html.push('<input type="checkbox" class="pick" data-i="' + idx + '"' +
                (App.specific[node.identifier] ? ' checked' : '') + ' title="勾选后应用专属前后缀">');
            html.push('<div class="node-main"><div class="node-tags">');
            html.push('<span class="badge">' + esc(node.protocol || '?') + '</span>');
            if (node.isCustom) html.push('<span class="badge custom">自定义</span>');
            if (node.isInfoNode) html.push('<span class="badge info">信息</span>');
            if (node.favorite) html.push('<span class="badge fav">已收藏</span>');
            if (!node.selected) html.push('<span class="badge off">限制外</span>');
            html.push('</div>');

            if (node.originalName && node.originalName !== node.name) {
                html.push('<div class="node-old">' + esc(node.originalName) + '</div>');
            }
            html.push('<div class="node-name">' + esc(node.name) + '</div>');
            html.push('<div class="node-raw">' + esc(node.raw) + '</div>');
            html.push('</div></li>');
        }

        list.innerHTML = html.join('');
        updateSelCount();

        if (rows.length > MAXR) {
            toast('节点较多，列表仅渲染前 ' + MAXR + ' 个，全部节点仍参与最终输出', 'warn', 4000);
        }
    }

    function updateSelCount() {
        var picks = document.querySelectorAll('#nodeList .pick:checked');
        var box = $('selCount');
        if (box) box.textContent = '已选 ' + picks.length + ' 项';
    }

    /* ======================= 渲染：统计与操作条 ======================= */
    function renderStats() {
        var box = $('statsBox');
        if (!box) return;
        var li = App.limitInfo || {};
        var st = App.stats || {};

        var data = [
            { k: '节点总数', v: App.merged.length, w: false },
            { k: '当前显示', v: App.visibleCount || 0, w: false },
            { k: '预计输出', v: li.output || 0, w: false },
            { k: '收藏节点', v: li.favorites || 0, w: false },
            { k: '可用节点', v: li.available || 0, w: false },
            { k: '自定义节点', v: App.customCount || 0, w: false }
        ];

        if (li.exceeded) data[2].w = true;

        var html = [];
        for (var i = 0; i < data.length; i++) {
            html.push('<div class="stat' + (data[i].w ? ' warn' : '') + '"><b>' + data[i].v + '</b><span>' + data[i].k + '</span></div>');
        }
        box.innerHTML = html.join('');
    }

    function renderOpBar() {
        var bar = $('opBar');
        if (!bar) return;
        var li = App.limitInfo || {};
        var pv = collectPreview();
        var parts = ['最近操作：' + App.lastOp];

        if (pv.keyword) parts.push('查找筛选：' + pv.keyword + '（仅影响显示）');
        if (pv.onlyFav) parts.push('仅显示已收藏');
        if (li.enabled) parts.push('数量限制 ' + li.limit + '，实际输出 ' + li.output);
        if (li.info) parts.push('含 ' + li.info + ' 个信息节点（始终保留）');
        if (li.exceeded) parts.push('⚠ 收藏数量已超过设定上限，已保留全部收藏节点');

        bar.innerHTML = '<span>' + esc(parts.join('　|　')) + '</span>';
    }

    /* ======================= 预览请求 ======================= */
    function fetchPreview(reason, onDone) {
        if (!BOOT.hasKV) { toast('未绑定 KV，无法抓取', 'error'); return; }
        if (App.fetching) { App.queueFetch = true; return; }

        App.fetching = true;
        var btn = $('btnFetch');
        if (btn) { btn.disabled = true; btn.textContent = '抓取中...'; }

        var payload = buildPayload();
        delete payload.version;

        postJSON('/preview', payload, 60000).then(function (res) {
            if (!res || !res.ok) throw new Error((res && res.error) || '预览失败');

            App.merged = (res.nodes || []).concat(res.customNodes || []);
            App.baseCount = (res.nodes || []).length;
            App.customCount = (res.customNodes || []).length;
            App.sources = res.sources || [];
            App.plainCount = res.plainCount || 0;
            App.stats = res.stats || null;
            if (res.seed) App.seed = res.seed;
            App.loaded = true;

            // 服务端算出的输出数量应与本地一致，若不一致以服务端为准
            if (res.stats && res.stats.limit) {
                App.limitInfo = res.stats.limit;
            }

            var st = App.stats || {};
            var dropped = (st.droppedProtocol || 0) + (st.droppedName || 0) + (st.deduped || 0);
            App.lastOp = (reason || '刷新预览') + ' · 共 ' + App.merged.length + ' 个节点（规则剔除 ' +
                dropped + '，重命名 ' + (st.renamed || 0) + '）';

            if (st.favoritesUnmatched && st.favoritesUnmatched.length) {
                toast('有 ' + st.favoritesUnmatched.length + ' 个收藏节点未出现在当前抓取结果中：' +
                    st.favoritesUnmatched.slice(0, 3).join('、'), 'warn', 6000);
            }

            applySelectionLocal();
            renderSources();
            renderNodes();
            renderStats();
            renderOpBar();
            refreshAll();

            if (typeof onDone === 'function') onDone(st);
        }).catch(function (e) {
            App.lastOp = '预览失败：' + e.message;
            renderOpBar();
            toast('预览失败：' + e.message, 'error', 5000);
        }).then(function () {
            App.fetching = false;
            if (btn) { btn.disabled = false; btn.textContent = '抓取并预览'; }
            if (App.queueFetch) { App.queueFetch = false; fetchPreview('排队刷新'); }
        });
    }

    /* ======================= 收藏 ======================= */
    function toggleFav(idx) {
        var n = App.merged[idx];
        if (!n) return;
        if (!n.fingerprint) { toast('该节点缺少稳定标识，无法收藏', 'error'); return; }

        var pos = -1;
        for (var i = 0; i < App.favorites.length; i++) {
            if (App.favorites[i].id === n.fingerprint) { pos = i; break; }
        }

        if (pos >= 0) {
            App.favorites.splice(pos, 1);
            n.favorite = false;
            toast('已取消收藏：' + n.name);
        } else {
            App.favorites.push({ id: n.fingerprint, name: n.name });
            n.favorite = true;
            toast('已收藏：' + n.name);
        }

        applySelectionLocal();
        renderNodes();
        renderStats();
        renderOpBar();
        refreshAll();
    }

    /* ======================= 模块级操作 ======================= */
    function saveMod(key) {
        var m = MODS[key];
        if (!m) return;
        try {
            var snap = m.collect();
            if (key === 'rules') {
                tryRegex(snap.retainNameRegex, 'i', '正则保留');
                tryRegex(snap.dropNameRegex, 'i', '正则剔除');
                tryRegex(snap.replaceTarget, 'gi', '查找关键字');
            }
            if (key === 'preview' && snap.limitEnabled) {
                var n = parseInt(snap.limit, 10);
                if (!String(snap.limit).trim() || !isFinite(n) || n < 1) {
                    throw new Error('节点数量必须是大于 0 的整数');
                }
            }
            m.saved = clone(snap);
            m.savedTime = nowTime();
            m.error = '';
            hReset(key, snap);
            refreshAll();
            toast('本模块配置已暂存，点击「保存所有配置」后才会正式生效');
        } catch (e) {
            m.error = '暂存失败';
            refreshAll();
            toast('暂存失败：' + e.message, 'error', 4000);
        }
    }

    function revertMod(key) {
        var m = MODS[key];
        if (!m) return;
        var state = m.saved ? clone(m.saved) : clone(baselineSlice(key));
        m.apply(state);
        m.error = '';
        hReset(key, state);
        refreshAll();
        if (key === 'preview') {
            applySelectionLocal();
            renderNodes();
            renderStats();
            renderOpBar();
        } else {
            fetchPreview('取消恢复');
        }
        toast('已恢复到本模块最近一次保存的状态');
    }

    /* ======================= 规则执行 ======================= */
    function applyRulesAction(label, doneMsg) {
        var r = collectRules();
        try {
            tryRegex(r.retainNameRegex, 'i', '正则保留');
            tryRegex(r.dropNameRegex, 'i', '正则剔除');
            tryRegex(r.replaceTarget, 'gi', '查找关键字');
        } catch (e) {
            toast(e.message, 'error', 5000);
            App.lastOp = e.message;
            renderOpBar();
            return;
        }

        hPush('rules');
        refreshAll();
        fetchPreview(label, function (st) {
            toast(typeof doneMsg === 'function' ? doneMsg(st) : (doneMsg || (label + '完成')));
        });
    }

    /* ======================= 全局保存 ======================= */
    function globalSave() {
        if (App.globalBusy) return;
        if (!BOOT.hasKV) { toast('未绑定 KV，无法保存', 'error'); return; }

        var payload = buildPayload();
        try {
            tryRegex(payload.rules.retainNameRegex, 'i', '正则保留');
            tryRegex(payload.rules.dropNameRegex, 'i', '正则剔除');
            tryRegex(payload.rules.replaceTarget, 'gi', '查找关键字');
            if (payload.output.limitEnabled) {
                if (!Number.isInteger(payload.output.limit) || payload.output.limit < 1) {
                    throw new Error('节点数量必须是大于 0 的整数');
                }
            }
        } catch (e) {
            toast(e.message, 'error', 5000);
            return;
        }

        if (!payload.links && !payload.customNodes) {
            if (!window.confirm('抓取源与自定义节点都为空，继续保存会导致订阅没有节点。确定继续吗？')) return;
        }

        App.globalBusy = true;
        App.globalError = '';
        for (var pi = 0; pi < MOD_KEYS.length; pi++) MODS[MOD_KEYS[pi]].pending = true;
        var btn = $('btnGlobalSave');
        if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
        refreshAll();

        postJSON('/admin', payload, 45000).then(function (res) {
            if (!res || !res.ok) throw new Error((res && res.error) || '保存失败');

            App.version = res.version || (App.version + 1);
            App.baseline = {
                links: payload.links,
                customNodes: payload.customNodes,
                rules: payload.rules,
                output: payload.output,
                favorites: clone(App.favorites),
                preview: { keyword: payload.preview.keyword, onlyFav: payload.preview.onlyFav }
            };

            var t = nowTime();
            for (var i = 0; i < MOD_KEYS.length; i++) {
                var m = MODS[MOD_KEYS[i]];
                m.saved = clone(m.collect());
                m.savedTime = t;
                m.error = '';
                m.pending = false;
                hReset(MOD_KEYS[i], m.saved);
            }

            App.savedLabel = '全部已保存 ' + t;
            App.globalError = '';
            var ver = $('verText');
            if (ver) ver.textContent = 'v' + App.version;
            var st = $('savedAtText');
            if (st) st.textContent = new Date(res.savedAt || Date.now()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

            refreshAll();
            toast('全部配置已保存并正式生效', 'success', 4000);
            if (res.warning) toast(res.warning, 'warn', 7000);
        }).catch(function (e) {
            App.savedLabel = '';
            App.globalError = '保存失败：' + e.message;
            toast('保存失败：' + e.message + '（配置未生效）', 'error', 6000);
            refreshAll();
        }).then(function () {
            App.globalBusy = false;
            for (var qi = 0; qi < MOD_KEYS.length; qi++) MODS[MOD_KEYS[qi]].pending = false;
            if (btn) { btn.disabled = false; btn.textContent = '保存所有配置'; }
            refreshAll();
        });
    }

    /* ======================= 事件绑定 ======================= */
    // 模块工具栏
    document.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== document.body && !(t.getAttribute && t.getAttribute('data-act'))) t = t.parentNode;
        if (!t || t === document.body || !t.getAttribute) return;

        var act = t.getAttribute('data-act');
        var mod = t.getAttribute('data-mod');

        if (act === 'undo') hUndo(mod);
        else if (act === 'redo') hRedo(mod);
        else if (act === 'revert') revertMod(mod);
        else if (act === 'module-save') saveMod(mod);
    });

    // 折叠
    document.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== document.body && !(t.getAttribute && t.getAttribute('data-toggle'))) t = t.parentNode;
        if (!t || t === document.body || !t.getAttribute) return;
        var card = $(t.getAttribute('data-toggle'));
        if (!card) return;
        card.classList.toggle('open');
        var arrow = t.querySelector('.collapse-arrow');
        if (arrow) arrow.textContent = card.classList.contains('open') ? '收起 ▲' : '展开 ▼';
    });

    // 节点列表内交互
    var nodeList = $('nodeList');
    if (nodeList) {
        nodeList.addEventListener('click', function (e) {
            var t = e.target;
            while (t && t !== this && !(t.getAttribute && t.getAttribute('data-act'))) t = t.parentNode;
            if (!t || t === this || !t.getAttribute) return;
            if (t.getAttribute('data-act') === 'fav') {
                e.preventDefault();
                toggleFav(parseInt(t.getAttribute('data-i'), 10));
            }
        });
        nodeList.addEventListener('change', function (e) {
            if (e.target && e.target.classList && e.target.classList.contains('pick')) updateSelCount();
        });
    }

    // 订阅地址复制
    var subcards = document.querySelectorAll('.subcard');
    for (var si = 0; si < subcards.length; si++) {
        subcards[si].addEventListener('click', function () {
            var link = this.getAttribute('data-copy') || '';
            if (!link) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(function () {
                    toast('订阅链接已复制');
                }).catch(function () { toast('复制失败，请手动选中复制', 'error'); });
            } else {
                toast('当前浏览器不支持自动复制', 'warn');
            }
        });
    }

    // 历史记录防抖（连续输入不产生大量记录）
    var histTimers = {};
    function scheduleHistory(key) {
        if (histTimers[key]) clearTimeout(histTimers[key]);
        histTimers[key] = setTimeout(function () {
            histTimers[key] = null;
            hPush(key);
            refreshAll();
        }, 700);
    }

    var bodyMap = { 'body-links': 'links', 'body-rules': 'rules', 'body-preview': 'preview', 'body-custom': 'custom' };
    Object.keys(bodyMap).forEach(function (id) {
        var box = $(id);
        var key = bodyMap[id];
        if (!box) return;

        box.addEventListener('input', function (e) {
            var tid = e.target && e.target.id;
            App.globalError = '';
            if (key === 'preview') {
                if (tid === 'in_keyword') { return; }   // 查找需点击按钮才生效
                if (tid === 'in_limit' || tid === 'chk_limitEnabled') { onLimitChange(); return; }
            }
            scheduleHistory(key);
            refreshGlobal();
        });

        box.addEventListener('change', function (e) {
            var tid = e.target && e.target.id;
            if (key === 'preview' && tid === 'chk_onlyFav') {
                hPush('preview');
                renderNodes();
                renderStats();
                renderOpBar();
                refreshAll();
                return;
            }
            scheduleHistory(key);
            refreshGlobal();
        });
    });

    // 数量限制变化
    function onLimitChange() {
        var pv = collectPreview();
        var hint = $('limitHint');
        if (pv.limitEnabled) {
            var n = Number(pv.limit);
            if (!String(pv.limit).trim() || !isFinite(n) || n < 1 || Math.floor(n) !== n) {
                if (hint) {
                    hint.textContent = '⚠ 节点数量必须是大于 0 的整数，当前输入不会生效';
                    hint.style.color = '#f87171';
                }
                return;
            }
        }
        if (hint) {
            hint.textContent = '收藏节点始终优先保留，其余名额从普通节点中随机补足，随机结果按天固定。';
            hint.style.color = '';
        }
        applySelectionLocal();
        renderNodes();
        renderStats();
        renderOpBar();
        scheduleHistory('preview');
        refreshGlobal();
    }

    // 各按钮
    var btnFetch = $('btnFetch');
    if (btnFetch) btnFetch.onclick = function () { fetchPreview('抓取节点'); };

    var btnPreviewRefresh = $('btnPreviewRefresh');
    if (btnPreviewRefresh) btnPreviewRefresh.onclick = function () { fetchPreview('手动刷新'); };

    var btnCustomPreview = $('btnCustomPreview');
    if (btnCustomPreview) {
        btnCustomPreview.onclick = function () {
            hPush('custom');
            fetchPreview('更新自定义节点');
        };
    }

    var btnSearch = $('btnSearch');
    if (btnSearch) {
        btnSearch.onclick = function () {
            var kw = valOf('in_keyword').trim();
            App.appliedKeyword = kw;
            hPush('preview');
            if (!App.loaded) { fetchPreview('查找'); return; }
            renderNodes();
            renderStats();
            renderOpBar();
            refreshAll();
            if (kw) {
                toast('查找完成：匹配 ' + App.visibleCount + ' 个节点');
                if ($('limitHint')) {
                    $('limitHint').textContent = '当前处于查找筛选状态：仅显示匹配「' + kw + '」的节点，不影响最终输出。';
                }
            } else {
                toast('关键字为空，已显示全部节点', 'warn');
            }
        };
    }

    var btnClearSearch = $('btnClearSearch');
    if (btnClearSearch) {
        btnClearSearch.onclick = function () {
            setVal('in_keyword', '');
            App.appliedKeyword = '';
            hPush('preview');
            renderNodes();
            renderStats();
            renderOpBar();
            refreshAll();
            if ($('limitHint')) {
                $('limitHint').textContent = '收藏节点始终优先保留，其余名额从普通节点中随机补足，随机结果按天固定。';
                $('limitHint').style.color = '';
            }
            toast('已清除查找条件，恢复显示全部节点');
        };
    }

    var btnReplace = $('btnReplace');
    if (btnReplace) {
        btnReplace.onclick = function () {
            if (!valOf('in_replaceTarget')) {
                toast('请先填写需要查找替换的内容', 'error');
                return;
            }
            applyRulesAction('执行替换', function (st) {
                var hits = st.replaceHits || 0;
                return hits > 0
                    ? '替换完成：' + hits + ' 个节点名称被修改'
                    : '替换已执行，但没有节点名称命中该关键字';
            });
        };
    }

    var btnApplyRetain = $('btnApplyRetain');
    if (btnApplyRetain) {
        btnApplyRetain.onclick = function () {
            if (!valOf('in_retainNameRegex')) { toast('请先填写正则保留表达式', 'error'); return; }
            applyRulesAction('执行保留', function (st) {
                return '保留规则已执行，剩余 ' + (App.merged.length) + ' 个节点';
            });
        };
    }

    var btnApplyDrop = $('btnApplyDrop');
    if (btnApplyDrop) {
        btnApplyDrop.onclick = function () {
            if (!valOf('in_dropNameRegex')) { toast('请先填写正则剔除表达式', 'error'); return; }
            applyRulesAction('执行剔除', function (st) {
                return '剔除规则已执行，共剔除 ' + (st.droppedName || 0) + ' 个节点';
            });
        };
    }

    var btnApplyRename = $('btnApplyRename');
    if (btnApplyRename) {
        btnApplyRename.onclick = function () {
            if (!valOf('in_globalRename')) { toast('请先填写重命名内容', 'error'); return; }
            applyRulesAction('执行重命名', '重命名已执行');
        };
    }

    var btnApplyPrefix = $('btnApplyPrefix');
    if (btnApplyPrefix) {
        btnApplyPrefix.onclick = function () {
            if (!valOf('in_addPrefix')) { toast('请先填写前缀内容', 'error'); return; }
            applyRulesAction('添加前缀', '已为全部节点添加前缀');
        };
    }

    var btnApplySuffix = $('btnApplySuffix');
    if (btnApplySuffix) {
        btnApplySuffix.onclick = function () {
            if (!valOf('in_addSuffix')) { toast('请先填写后缀内容', 'error'); return; }
            applyRulesAction('添加后缀', '已为全部节点添加后缀');
        };
    }

    var btnBatchApply = $('btnBatchApply');
    if (btnBatchApply) {
        btnBatchApply.onclick = function () {
            var picks = document.querySelectorAll('#nodeList .pick:checked');
            if (!picks.length) { toast('请先勾选需要应用规则的节点', 'error'); return; }
            var p = valOf('in_batchPrefix');
            var s = valOf('in_batchSuffix');
            if (!p && !s) { toast('前缀或后缀请至少填写一项', 'error'); return; }

            hPush('rules');
            var count = 0;
            for (var i = 0; i < picks.length; i++) {
                var idx = parseInt(picks[i].getAttribute('data-i'), 10);
                var node = App.merged[idx];
                if (!node || !node.identifier) continue;
                var rule = App.specific[node.identifier] || {};
                if (p) rule.prefix = p;
                if (s) rule.suffix = s;
                App.specific[node.identifier] = rule;
                count++;
            }
            setVal('in_batchPrefix', '');
            setVal('in_batchSuffix', '');
            hPush('rules');
            toast('已为 ' + count + ' 个节点设置专属前后缀');
            fetchPreview('应用专属前后缀');
        };
    }

    var btnBatchClear = $('btnBatchClear');
    if (btnBatchClear) {
        btnBatchClear.onclick = function () {
            hPush('rules');
            App.specific = {};
            hPush('rules');
            toast('已清空全部专属前后缀规则');
            fetchPreview('清除专属规则');
        };
    }

    var btnGlobalSave = $('btnGlobalSave');
    if (btnGlobalSave) btnGlobalSave.onclick = globalSave;

    // 离开页面提醒（只提醒，不自动保存）
    window.addEventListener('beforeunload', function (e) {
        var dirty = false;
        for (var i = 0; i < MOD_KEYS.length; i++) {
            var m = MODS[MOD_KEYS[i]];
            var cur = JSON.stringify(m.collect());
            var savedJson = m.saved ? JSON.stringify(m.saved) : JSON.stringify(baselineSlice(MOD_KEYS[i]));
            if (cur !== savedJson) { dirty = true; break; }
        }
        if (dirty) {
            e.preventDefault();
            e.returnValue = '有尚未保存的修改，确定离开吗？';
            return e.returnValue;
        }
    });

    /* ======================= 节点名称解码（保持原项目行为） ======================= */
    function decodeNodeNameSafe(text) {
        if (!text) return text;
        return String(text).split('\\n').map(function (line) {
            var hashIndex = line.lastIndexOf('#');
            if (hashIndex !== -1 && line.indexOf('://') !== -1) {
                var beforeHash = line.substring(0, hashIndex);
                var afterHash = line.substring(hashIndex + 1);
                try {
                    return beforeHash + '#' + decodeURIComponent(afterHash);
                } catch (e) {
                    return line;
                }
            }
            return line;
        }).join('\\n');
    }

    /* ======================= 初始化 ======================= */
    function initQR() {
        if (typeof QRCode === 'undefined') return;
        var cards = document.querySelectorAll('.subcard');
        for (var i = 0; i < cards.length; i++) {
            var box = cards[i].querySelector('.subcard-qr');
            if (!box) continue;
            try {
                new QRCode(box, {
                    text: cards[i].getAttribute('data-copy') || '',
                    width: 78,
                    height: 78,
                    colorDark: '#000',
                    colorLight: '#fff',
                    correctLevel: QRCode.CorrectLevel.L
                });
            } catch (e) { }
        }
    }

    function init() {
        var taLinks = $('ta_links');
        if (taLinks && taLinks.value) taLinks.value = decodeNodeNameSafe(taLinks.value);
        var taCustom = $('ta_customNodes');
        if (taCustom && taCustom.value) taCustom.value = decodeNodeNameSafe(taCustom.value);

        initQR();

        for (var i = 0; i < MOD_KEYS.length; i++) {
            var k = MOD_KEYS[i];
            hReset(k, MODS[k].collect());
        }

        applySelectionLocal();
        renderStats();
        renderOpBar();
        refreshAll();

        if (BOOT.hasKV) {
            fetchPreview('初始加载');
        } else {
            App.lastOp = '未绑定 KV，无法抓取节点';
            renderOpBar();
        }
    }

    init();
})();
</script>
</body>
</html>`;
}


// ================= 基础编解码与工具函数 =================
async function ADD(envadd) {
    var addtext = String(envadd === undefined || envadd === null ? '' : envadd)
        .replace(/[  "'|\r\n]+/g, '\n')
        .replace(/\n+/g, '\n');

    if (addtext.charAt(0) == '\n') {
        addtext = addtext.slice(1);
    }

    if (addtext.charAt(addtext.length - 1) == '\n') {
        addtext = addtext.slice(0, addtext.length - 1);
    }

    return addtext.split('\n');
}


async function nginx() {
    return `<!DOCTYPE html><html><head><title>Welcome</title></head><body><h1>Nginx works!</h1></body></html>`;
}


async function sendMessage(type, ip, add_data = "") {
    return;
}


function base64Decode(str) {
    const normalized = String(str || '')
        .replace(/\s/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const padded =
        normalized + '='.repeat((4 - normalized.length % 4) % 4);

    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder('utf-8').decode(bytes);
}


function encodeBase64(data) {
    const binary = new TextEncoder().encode(data);
    let base64 = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    for (let i = 0; i < binary.length; i += 3) {
        const byte1 = binary[i];
        const byte2 = binary[i + 1] || 0;
        const byte3 = binary[i + 2] || 0;

        base64 += chars[byte1 >> 2];
        base64 += chars[((byte1 & 3) << 4) | (byte2 >> 4)];
        base64 += chars[((byte2 & 15) << 2) | (byte3 >> 6)];
        base64 += chars[byte3 & 63];
    }

    const padding = 3 - (binary.length % 3 || 3);

    return base64.slice(0, base64.length - padding) + '=='.slice(0, padding);
}


async function MD5MD5(text) {
    const encoder = new TextEncoder();

    const firstPass = await crypto.subtle.digest(
        'MD5',
        encoder.encode(text)
    );

    const firstHex = Array.from(new Uint8Array(firstPass))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    const secondPass = await crypto.subtle.digest(
        'MD5',
        encoder.encode(firstHex.slice(7, 27))
    );

    return Array.from(new Uint8Array(secondPass))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toLowerCase();
}


function clashFix(content) {
    if (
        content.includes('wireguard') &&
        !content.includes('remote-dns-resolve')
    ) {
        return content.replace(
            /, mtu: 1280, udp: true/g,
            `, mtu: 1280, remote-dns-resolve: true, udp: true`
        );
    }

    return content;
}


async function proxyURL(proxyURL, url) {
    return new Response('Proxy working');
}


async function 迁移地址列表(env, txt) {
    return true;
}


// ====== 远程订阅拉取：强制 GET ======
async function getUrl(
    request,
    targetUrl,
    追加UA,
    userAgentHeader,
    signal
) {
    // 只向远程订阅源发 GET；后台预览入口是 POST，不能把它的方法透传给订阅源。
    // 不转发后台 Cookie / Authorization，避免管理凭据泄露给第三方订阅地址。
    const newHeaders = new Headers();

    // 取消透传前端的 Accept，防止目标 API 返回 JSON 导致后续无法解析 Base64
    newHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,application/x-envoy,*/*;q=0.8');

    // 移除浏览器 UA 中的 Mozilla 标识，防止被订阅防 DDoS 面板识别为浏览器而返回网页
    newHeaders.set(
        'User-Agent',
        `v2rayN/6.45 cmliu/CF-Workers-SUB ${追加UA}`
    );

    const modifiedRequest = new Request(targetUrl, {
        method: 'GET',
        headers: newHeaders,
        redirect: 'follow',
        signal,
        cf: { insecureSkipVerify: true }
    });

    return fetch(modifiedRequest);
}
