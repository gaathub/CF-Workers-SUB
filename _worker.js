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
let total = 99;
let timestamp = 4102329600000;

let MainData = `
https://cfxr.eu.org/getSub
`;

let urls = [];
let subConverter = "SUBAPI.cmliussss.net"; 
let subConfig = "https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini"; 
let subProtocol = 'https';

// ====== 【节点处理配置对象】 ======
const DEFAULT_NODE_EDIT_CONFIG = {
    retainProtocols: [], dropProtocols: [],
    retainNameRegex: '', dropNameRegex: '',
    replaceTarget: '', replaceWith: '',
    globalRename: '', addPrefix: '', addSuffix: '',
    autoEmoji: true, deepDeduplicate: true, sortNodes: true, dropInvalidNodes: true,
    specificRules: {}, // 专属节点的特殊前后缀规则
    outputLimit: 0, favorites: [] // 0 表示不限制；收藏节点优先保留
};

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

        // ====== 【核心升级 1：处理预览请求并真实抓取远程链接】 ======
        if (request.method === 'POST' && url.pathname === '/preview') {
            // 预览会代替后台请求用户填写的远程订阅地址，只允许已登录管理员调用。
            const previewSessionToken = await MD5MD5(AdminUser + AdminPass + "CF-SUB-SECURE");
            if (getCookie(request, 'admin_session') !== previewSessionToken) {
                return new Response(JSON.stringify({
                    error: '未登录或登录已过期，请重新登录后台'
                }), {
                    status: 401,
                    headers: {
                        "Content-Type": "application/json;charset=utf-8",
                        "Cache-Control": "no-store"
                    }
                });
            }

            try {
                const textData = await request.text();
                const data = JSON.parse(textData);

                // 1. 真实抓取远程链接的内容
                const previewReport = { failures: [] };
                const rawResolved = await resolveLinksToNodes(
                    data.links || '',
                    request,
                    userAgentHeader,
                    previewReport
                );

                // 2. 将抓取到的裸节点输入二次编辑引擎处理
                const previewConfig = Object.assign({}, DEFAULT_NODE_EDIT_CONFIG, data.config || {});
                const previewLimit = Number(previewConfig.outputLimit || 0);
                if (!Number.isInteger(previewLimit) || previewLimit < 0 || previewLimit > 10000) {
                    return new Response(JSON.stringify({ error: '节点数量限制必须是 0 至 10000 的整数' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
                }
                const processedArray = processNodes(rawResolved, previewConfig);

                // 3. 自定义节点独立解析，不执行普通 Rules 过滤
                const customArray = processNodes(
                    data.customNodes || '',
                    Object.assign({}, previewConfig, { isCustom: true })
                );
                customArray.forEach(node => { node.isCustom = true; });

                // 4. 合并后执行收藏保护与节点数量限制；与正式订阅共用同一算法
                const mergedArray = processedArray.concat(customArray);
                const limitedArray = applyNodeLimit(mergedArray, previewConfig);

                return new Response(JSON.stringify({
                    nodes: limitedArray,
                    customNodes: [],
                    totalNodes: mergedArray.length,
                    outputNodes: limitedArray.length,
                    favoriteCount: limitedArray.filter(n => previewConfig.favorites.includes(n.identifier)).length,
                    unmatchedFavorites: previewConfig.favorites.filter(id => !mergedArray.some(n => n.identifier === id)),
                    outputLimit: Number(previewConfig.outputLimit) || 0,
                    failures: previewReport.failures || []
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json;charset=utf-8" }
                });
            } catch (e) {
                console.error("Preview Error:", e);
                return new Response(JSON.stringify({
                    error: "解析或抓取异常: " + e.message
                }), {
                    status: 400,
                    headers: { "Content-Type": "application/json;charset=utf-8" }
                });
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

        // ================= 原有订阅分发逻辑 (融入最终生效规则) =================
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
            let dynamicConfig = Object.assign({}, DEFAULT_NODE_EDIT_CONFIG);
            let customOutputNodes = "";

            if (env.KV) {
                await 迁移地址列表(env, 'LINK.txt');

                if (userAgent.includes('mozilla') && !url.search) {
                    return Response.redirect(`${url.origin}/admin`, 302);
                } else {
                    // 新版统一快照优先；旧 KV 键作为兼容回退
                    const snapshotText = await env.KV.get('ADMIN_CONFIG_SNAPSHOT.json');
                    if (snapshotText) {
                        try {
                            const snapshot = JSON.parse(snapshotText);
                            MainData = typeof snapshot.links === 'string' ? snapshot.links : (await env.KV.get('LINK.txt') || MainData);
                            customOutputNodes = typeof snapshot.customNodes === 'string' ? snapshot.customNodes : (await env.KV.get('CUSTOM_NODES.txt') || '');
                            Object.assign(dynamicConfig, snapshot.config || {});
                        } catch (e) {
                            console.error('统一配置快照读取失败，回退旧配置:', e);
                            MainData = await env.KV.get('LINK.txt') || MainData;
                            customOutputNodes = await env.KV.get('CUSTOM_NODES.txt') || '';
                            const oldCfg = await env.KV.get('EDIT_CONFIG.json');
                            if (oldCfg) { try { Object.assign(dynamicConfig, JSON.parse(oldCfg)); } catch (_) {} }
                        }
                    } else {
                        MainData = await env.KV.get('LINK.txt') || MainData;
                        customOutputNodes = await env.KV.get('CUSTOM_NODES.txt') || '';
                        const kvCfg = await env.KV.get('EDIT_CONFIG.json');
                        if (kvCfg) { try { Object.assign(dynamicConfig, JSON.parse(kvCfg)); } catch (_) {} }
                    }
                }
            } else {
                MainData = env.LINK || MainData;
                if (env.LINKSUB) urls = await ADD(env.LINKSUB);
            }

            // 获取基础裸节点
            let req_data = await resolveLinksToNodes(
                MainData + '\n' + urls.join('\n'),
                request,
                userAgentHeader
            );

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

            // ====== 核心修改：节点统一处理与重组 ======
            const utf8Encoder = new TextEncoder();
            const text = new TextDecoder().decode(utf8Encoder.encode(req_data));
            const uniqueLines = [...new Set(text.split('\n'))].join('\n');

            // 按照最新的规则处理抓取到的节点
            let nodeArray = processNodes(uniqueLines, dynamicConfig);

            // 独立处理自定义节点
            let customArray = processNodes(
                customOutputNodes,
                Object.assign({}, dynamicConfig, { isCustom: true })
            );
            customArray.forEach(node => { node.isCustom = true; });

            // 合并后统一执行收藏保护与数量限制，确保最终订阅与预览一致
            const mergedNodes = nodeArray.concat(customArray);
            const selectedNodes = applyNodeLimit(mergedNodes, dynamicConfig);
            let finalOutput = buildSubString(selectedNodes);

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


// ================= 核心工具函数：真实拉取远程节点 =================
async function resolveLinksToNodes(text, request, userAgentHeader, report = null) {
    let urls = await ADD(text);
    let req_data = "";
    let selfBuilt = "";
    let subLinks = "";

    // 区分出自建明文节点和远程订阅链接
    for (let x of urls) {
        if (x.toLowerCase().startsWith('http')) {
            subLinks += x + '\n';
        } else {
            selfBuilt += x + '\n';
        }
    }

    let linkArr = [...new Set(await ADD(subLinks))]
        .filter(item => item?.trim?.());

    if (linkArr.length > 0) {
        let 追加UA = 'v2rayn';
        const res = await getSUB(
            linkArr,
            request,
            追加UA,
            userAgentHeader
        );

        req_data += res[0].join('\n');
        if (report) report.failures = res[2] || [];
    }

    return selfBuilt + (selfBuilt && req_data ? '\n' : '') + req_data;
}


// ================= 节点处理核心引擎 (返回结构化对象数组，支撑预览与输出) =================
function processNodes(content, config) {
    let lines = content.split('\n');
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

        let node = parseSingleNode(line);

        if (node && node.valid) {
            parsedNodes.push(node);
        } else if (line.includes('://')) {
            parsedNodes.push({
                valid: false,
                raw: line,
                isInfoNode: INFO_NODE_REGEX.test(line),
                name: line,
                protocol: line.split('://')[0].toLowerCase()
            });
        }
    }

    let finalNodes = [];
    let uniqueIdentifiers = new Set();

    for (let node of parsedNodes) {
        // 无效节点处理
        if (!node.valid) {
            if (node.isInfoNode) finalNodes.push(node);
            else if (!config.dropInvalidNodes) finalNodes.push(node);
            continue;
        }

        // 白名单保护：信息节点原样放行
        if (INFO_NODE_REGEX.test(node.name)) {
            node.isInfoNode = true;
            finalNodes.push(node);
            continue;
        }

        // 正则过滤
        if (
            config.retainProtocols &&
            config.retainProtocols.length > 0 &&
            !config.retainProtocols.includes(node.protocol)
        ) continue;

        if (
            config.dropProtocols &&
            config.dropProtocols.length > 0 &&
            config.dropProtocols.includes(node.protocol)
        ) continue;

        if (
            config.retainNameRegex &&
            !new RegExp(config.retainNameRegex, 'i').test(node.name)
        ) continue;

        if (
            config.dropNameRegex &&
            new RegExp(config.dropNameRegex, 'i').test(node.name)
        ) continue;

        // 深度去重
        if (config.deepDeduplicate && !config.isCustom) {
            const dedupeId =
                `${node.protocol}:${node.address}:${node.port}:${node.id}`;

            if (uniqueIdentifiers.has(dedupeId)) continue;
            uniqueIdentifiers.add(dedupeId);
        }

        if (!config.isCustom) {
            // 查找替换核心算法
            if (config.replaceTarget) {
                try {
                    node.name = node.name.replace(
                        new RegExp(config.replaceTarget, 'gi'),
                        config.replaceWith || ''
                    );
                } catch (e) {
                    node.name = node.name
                        .split(config.replaceTarget)
                        .join(config.replaceWith || '');
                }
            }

            if (config.globalRename) {
                node.name = config.globalRename;
            }

            // 自动 Emoji
            if (
                config.autoEmoji &&
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
            if (
                config.specificRules &&
                node.identifier &&
                config.specificRules[node.identifier]
            ) {
                let sRule = config.specificRules[node.identifier];

                if (sRule.prefix) {
                    node.name = sRule.prefix + node.name;
                }

                if (sRule.suffix) {
                    node.name = node.name + sRule.suffix;
                }
            }

            if (config.addPrefix) {
                node.name = config.addPrefix + node.name;
            }

            if (config.addSuffix) {
                node.name = node.name + config.addSuffix;
            }
        }

        finalNodes.push(node);
    }

    if (!config.isCustom) {
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
        if (config.sortNodes) {
            finalNodes.sort((a, b) => {
                if (a.isInfoNode && !b.isInfoNode) return -1;
                if (!a.isInfoNode && b.isInfoNode) return 1;
                if (!a.valid || !b.valid) return 0;
                return a.name.localeCompare(b.name, 'zh-CN');
            });
        }
    }

    return finalNodes;
}


// 稳定的伪随机排序：同一 UTC 日期内预览和订阅输出一致，次日自动重新抽样
function stableNodeScore(value, seed) {
    const input = String(seed) + '|' + String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function applyNodeLimit(nodes, config = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    const limit = Number(config.outputLimit || 0);
    const favorites = new Set(Array.isArray(config.favorites) ? config.favorites : []);
    if (!Number.isInteger(limit) || limit <= 0 || list.length <= limit) return list;

    const protectedNodes = list.filter(node => node && favorites.has(node.identifier));
    const ordinaryNodes = list.filter(node => !node || !favorites.has(node.identifier));
    if (protectedNodes.length >= limit) return protectedNodes;

    const seed = new Date().toISOString().slice(0, 10);
    ordinaryNodes.sort((a, b) =>
        stableNodeScore(a?.identifier || a?.raw, seed) - stableNodeScore(b?.identifier || b?.raw, seed)
    );
    return protectedNodes.concat(ordinaryNodes.slice(0, Math.max(0, limit - protectedNodes.length)));
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
            let match = line.match(/^([a-zA-Z0-9+-.]+):\/\/(.*)$/);
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

            let name = decodeURIComponent(urlObj.hash.slice(1) || '');

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

        // 生成唯一标识符用于前台精准勾选控制
        node.identifier =
            `${node.protocol}://${node.address}:${node.port}#${node.originalName}`;

        return node;
    } catch (e) {
        return { valid: false };
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${FileName} - Node Editor Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
    ${globalCSS}
</head>
<body class="relative min-h-screen pb-10 overflow-x-hidden">
    <div id="toast-container" class="fixed top-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none"></div>
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>

    <script>
        // 前端保存独立状态
        window.INITIAL_NODE_CONFIG = ${JSON.stringify(configObj)};
        window.CURRENT_RETAIN_PROTOCOLS = ${JSON.stringify(configObj.retainProtocols || [])};
        window.CURRENT_DROP_PROTOCOLS = ${JSON.stringify(configObj.dropProtocols || [])};
        window.CURRENT_SPECIFIC_RULES = ${JSON.stringify(configObj.specificRules || {})};
        window.CURRENT_FAVORITES = ${JSON.stringify(Array.isArray(configObj.favorites) ? configObj.favorites : [])};
        window.PREVIEW_NODES = [];
    </script>

    <nav class="glass-card sticky top-0 z-50 border-b-0 border-white/10 mb-8 rounded-b-3xl">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full flex items-center justify-center border border-[var(--neon-cyan)] shadow-[0_0_10px_rgba(0,243,255,0.3)] bg-black/30">
                    <svg class="w-5 h-5 text-[var(--neon-cyan)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a6 6 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A6 6 0 009 10.172V5L8 4z"></path>
                    </svg>
                </div>
                <h1 class="font-bold text-xl text-white tracking-widest uppercase">${FileName}</h1>
            </div>

            <div class="flex items-center gap-4 flex-wrap justify-end">
                <div class="text-right font-mono text-[11px] leading-5 text-gray-300">
                    <div>CN <span id="cnClock" class="text-cyan-300 tabular-nums">----</span></div>
                    <div>UTC <span id="utcClock" class="text-purple-300 tabular-nums">----</span></div>
                </div>
                <button id="saveAllBtn" class="neon-btn px-4 py-2 rounded-xl text-xs font-bold">保存所有配置</button>
                <a href="/logout" class="text-xs font-bold text-gray-400 hover:text-red-400 transition uppercase tracking-wider px-4 py-2 glass-card rounded-full hover:border-red-500/50">登出 LOGOUT</a>
            </div>
        </div>
    </nav>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8">

        <!-- ================= 整合后的核心控制区 ================= -->
        <div class="lg:col-span-7 flex flex-col gap-6">

            <!-- 1. 抓取源与全局控制台 -->
            <div class="glass-card rounded-2xl p-6 flex flex-col">
                <div class="flex justify-between items-center mb-4">
                    <div>
                        <h2 class="text-lg font-bold text-white tracking-wide">节点抓取源 (Sub Links)</h2>
                        <p class="text-[11px] text-gray-400 mt-1 font-mono">填入需要合并抓取的节点或订阅源</p>
                    </div>

                    <div class="flex items-center gap-2 flex-wrap justify-end">
                        <span id="linksStatus" class="text-xs text-cyan-300"></span>
                        <button type="button" data-module-save="links" class="module-save glass-card px-3 py-2 rounded-lg text-xs">保存配置</button>
                        <button type="button" data-module-restore="links" class="glass-card px-3 py-2 rounded-lg text-xs">取消恢复</button>
                        <button type="button" data-undo="links" class="glass-card px-3 py-2 rounded-lg text-xs">撤销</button>
                        <button type="button" data-redo="links" class="glass-card px-3 py-2 rounded-lg text-xs">重做</button>
                    </div>
                </div>

                ${hasKV ? `<textarea id="content" data-module="links" class="glass-input w-full p-4 h-[120px] font-mono text-[13px] rounded-xl resize-y leading-relaxed text-green-400" placeholder="# 粘贴原始节点或订阅链接...">${content}</textarea><div class="mt-3 flex justify-end"><button id="sourcePreviewBtn" class="glass-card px-4 py-2 rounded-lg text-xs text-cyan-300">节点抓取源预览</button></div>` : '<div class="h-[100px] flex items-center justify-center bg-red-900/20 text-red-400 font-medium rounded-xl">未绑定 KV，功能不可用</div>'}
            </div>

            ${hasKV ? `
            <!-- 2. 二次编辑规则 -->
            <div class="glass-card rounded-2xl p-6 relative">
                <div class="flex justify-between items-center mb-4 border-b border-white/10 pb-4">
                    <div>
                        <h2 class="text-lg font-bold text-white tracking-wide">节点二次编辑规则 (Rules)</h2>
                        <p class="text-[11px] text-gray-400 mt-1 font-mono">配置好规则后，点击右侧的【应用配置并预览】即可立刻查看真实效果</p>
                    </div>

                    <button id="previewBtn" class="glass-card flex items-center justify-center h-10 px-4 gap-2 rounded-xl text-sm font-bold text-[var(--neon-cyan)] border-[var(--neon-cyan)]/50 hover:bg-[var(--neon-cyan)]/10 transition-all cursor-pointer">
                        ⚡ 应用配置并预览
                    </button>
                </div>

                <div class="flex flex-wrap gap-2 justify-end mb-4">
                    <span id="rulesStatus" class="text-xs text-cyan-300 mr-auto"></span>
                    <button type="button" data-module-save="rules" class="module-save glass-card px-3 py-2 rounded-lg text-xs">保存配置</button>
                    <button type="button" data-module-restore="rules" class="glass-card px-3 py-2 rounded-lg text-xs">取消恢复</button>
                    <button type="button" data-undo="rules" class="glass-card px-3 py-2 rounded-lg text-xs">撤销</button>
                    <button type="button" data-redo="rules" class="glass-card px-3 py-2 rounded-lg text-xs">重做</button>
                </div>
                <div class="grid grid-cols-2 gap-4 mb-5 pb-2">
                    <label class="flex items-center space-x-2 cursor-pointer group">
                        <input type="checkbox" id="cfg_autoEmoji" data-module="rules" class="form-checkbox text-cyan-400 rounded bg-black/20 border-white/20 h-4 w-4" ${configObj.autoEmoji ? 'checked' : ''}>
                        <span class="text-xs text-gray-300 group-hover:text-[var(--neon-cyan)] transition">自动地区 Emoji (🇭🇰🇯🇵)</span>
                    </label>

                    <label class="flex items-center space-x-2 cursor-pointer group">
                        <input type="checkbox" id="cfg_deepDeduplicate" data-module="rules" class="form-checkbox text-cyan-400 rounded bg-black/20 border-white/20 h-4 w-4" ${configObj.deepDeduplicate ? 'checked' : ''}>
                        <span class="text-xs text-gray-300 group-hover:text-[var(--neon-cyan)] transition">深度去重 (剔同IP端口)</span>
                    </label>

                    <label class="flex items-center space-x-2 cursor-pointer group">
                        <input type="checkbox" id="cfg_sortNodes" data-module="rules" class="form-checkbox text-cyan-400 rounded bg-black/20 border-white/20 h-4 w-4" ${configObj.sortNodes ? 'checked' : ''}>
                        <span class="text-xs text-gray-300 group-hover:text-[var(--neon-cyan)] transition">智能排序 (信息置顶)</span>
                    </label>

                    <label class="flex items-center space-x-2 cursor-pointer group">
                        <input type="checkbox" id="cfg_dropInvalidNodes" data-module="rules" class="form-checkbox text-cyan-400 rounded bg-black/20 border-white/20 h-4 w-4" ${configObj.dropInvalidNodes ? 'checked' : ''}>
                        <span class="text-xs text-gray-300 group-hover:text-[var(--neon-cyan)] transition">剔除无效节点(防报错)</span>
                    </label>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="md:col-span-2">
                        <label class="text-[10px] text-[var(--neon-purple)] block mb-1">查找关键字（仅筛选预览显示）</label>
                        <input type="text" id="ruleFindKeyword" class="glass-input w-full p-2 text-xs rounded-lg" placeholder="输入要查找的节点名称关键词">
                    </div>
                    <div class="md:col-span-2">
                        <label class="text-[10px] text-[var(--neon-purple)] block mb-1">替换目标关键字</label>
                        <input type="text" id="cfg_replaceTarget" data-module="rules" class="glass-input w-full p-2 text-xs rounded-lg border-[var(--neon-purple)]/50" value="${configObj.replaceTarget || ''}" placeholder="例: @clashV8">
                    </div>

                    <div class="md:col-span-2">
                        <label class="text-[10px] text-[var(--neon-purple)] block mb-1">替换为 (留空则代表直接删除查找到的词)</label>
                        <input type="text" id="cfg_replaceWith" data-module="rules" class="glass-input w-full p-2 text-xs rounded-lg border-[var(--neon-purple)]/50" value="${configObj.replaceWith || ''}" placeholder="例: 星链">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-400 block mb-1 mt-2">正则保留(名称)</label>
                        <input type="text" id="cfg_retainNameRegex" data-module="rules" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.retainNameRegex || ''}" placeholder="如：香港|日本">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-400 block mb-1 mt-2">正则剔除(名称)</label>
                        <input type="text" id="cfg_dropNameRegex" data-module="rules" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.dropNameRegex || ''}" placeholder="如：过期|流量">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-400 block mb-1 mt-2">全局重命名(覆盖)</label>
                        <input type="text" id="cfg_globalRename" data-module="rules" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.globalRename || ''}" placeholder="如：专属节点">
                    </div>

                    <div class="flex gap-2">
                        <div class="w-1/2">
                            <label class="text-[10px] text-gray-400 block mb-1 mt-2">统一前缀</label>
                            <input type="text" id="cfg_addPrefix" data-module="rules" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.addPrefix || ''}" placeholder="如：🚀">
                        </div>

                        <div class="w-1/2">
                            <label class="text-[10px] text-gray-400 block mb-1 mt-2">统一后缀</label>
                            <input type="text" id="cfg_addSuffix" data-module="rules" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.addSuffix || ''}" placeholder="如：[Pro]">
                        </div>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 mt-4">
                    <button type="button" id="findKeywordBtn" class="glass-card px-3 py-2 rounded-lg text-xs">查找</button>
                    <button type="button" id="replaceKeywordBtn" class="glass-card px-3 py-2 rounded-lg text-xs">替换</button>
                    <button type="button" id="retainRegexBtn" class="glass-card px-3 py-2 rounded-lg text-xs">执行保留</button>
                    <button type="button" id="dropRegexBtn" class="glass-card px-3 py-2 rounded-lg text-xs">执行剔除</button>
                    <button type="button" id="renameBtn" class="glass-card px-3 py-2 rounded-lg text-xs">执行重命名</button>
                    <button type="button" id="prefixBtn" class="glass-card px-3 py-2 rounded-lg text-xs">添加前缀</button>
                    <button type="button" id="suffixBtn" class="glass-card px-3 py-2 rounded-lg text-xs">添加后缀</button>
                </div>
            </div>
                        <!-- 3. 实时节点预览区域 -->
            <div id="previewSection" class="glass-card rounded-2xl p-6 hidden flex-col border border-[var(--neon-cyan)] shadow-[0_0_20px_rgba(0,243,255,0.15)] mt-2">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-lg font-bold text-[var(--neon-cyan)] tracking-wide flex items-center gap-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                        </svg>
                        实时节点预览 (Live Preview)
                    </h2>

                    <button onclick="document.getElementById('previewSection').classList.add('hidden')" class="text-gray-400 hover:text-white text-xs border border-gray-600 px-3 py-1 rounded-full hover:bg-white/10 transition">
                        ✕ 关闭
                    </button>
                </div>

                <div class="flex flex-wrap items-center gap-2 mb-4">
                    <span id="previewStatus" class="text-xs text-cyan-300 mr-auto"></span>
                    <button type="button" data-module-save="preview" class="module-save glass-card px-3 py-2 rounded-lg text-xs">保存配置</button>
                    <button type="button" data-module-restore="preview" class="glass-card px-3 py-2 rounded-lg text-xs">取消恢复</button>
                    <button type="button" data-undo="preview" class="glass-card px-3 py-2 rounded-lg text-xs">撤销</button>
                    <button type="button" data-redo="preview" class="glass-card px-3 py-2 rounded-lg text-xs">重做</button>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 p-3 rounded-xl bg-black/30 border border-white/10">
                    <label class="text-xs text-gray-300">最终输出节点数量（0=不限制）<input id="outputLimit" data-module="preview" type="number" min="0" max="10000" step="1" value="${Number(configObj.outputLimit || 0)}" class="glass-input w-full mt-1 p-2 rounded-lg"></label>
                    <label class="text-xs text-gray-300 md:col-span-2">预览查找（只隐藏显示，不删除节点）<input id="previewSearch" type="text" class="glass-input w-full mt-1 p-2 rounded-lg" placeholder="输入节点名称关键字"></label>
                    <div class="md:col-span-3 text-xs text-gray-400" id="nodeStats">等待抓取节点</div>
                </div>

                <!-- 批量指定前缀后缀工具栏 -->
                <div class="flex flex-wrap items-center gap-2 mb-4 p-3 bg-black/40 rounded-xl border border-[var(--neon-purple)]/40 shadow-inner">
                    <span class="text-xs text-gray-300 mr-2 flex items-center gap-1">
                        <svg class="w-4 h-4 text-[var(--neon-cyan)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                        已选 <span id="selectedCount" class="text-[var(--neon-cyan)] font-bold text-sm mx-1">0</span> 项
                    </span>

                    <input type="text" id="batchPrefix" placeholder="指定前缀..." class="glass-input w-24 p-1.5 text-xs rounded">
                    <input type="text" id="batchSuffix" placeholder="指定后缀..." class="glass-input w-24 p-1.5 text-xs rounded">
                    <button id="applyBatchBtn" class="neon-btn px-3 py-1.5 rounded text-xs font-bold text-black shadow-md ml-auto">对选中项应用</button>
                    <button id="clearBatchBtn" class="border border-red-500/50 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded text-xs transition">清除专有规则</button>
                </div>

                <div id="previewContent" class="w-full h-[400px] rounded-xl overflow-y-auto pr-2 custom-scrollbar"></div>
            </div>


            <!-- 4. 自定义节点 -->
            <div class="glass-card rounded-2xl p-6 flex flex-col">
                <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <h2 class="text-lg font-bold text-pink-400 tracking-wide">自定义输出节点 (Custom Output)</h2>
                    <div class="flex gap-2 items-center"><span id="customStatus" class="text-xs text-cyan-300"></span>
                        <button type="button" data-module-save="custom" class="module-save glass-card px-3 py-2 rounded-lg text-xs">保存配置</button>
                        <button type="button" data-module-restore="custom" class="glass-card px-3 py-2 rounded-lg text-xs">取消恢复</button>
                        <button type="button" data-undo="custom" class="glass-card px-3 py-2 rounded-lg text-xs">撤销</button>
                        <button type="button" data-redo="custom" class="glass-card px-3 py-2 rounded-lg text-xs">重做</button>
                    </div>
                </div>
                <p class="text-[11px] text-gray-400 mb-4 font-mono">在此填写的节点独立管理，不执行普通 Rules 过滤，参与最终数量控制</p>
                <textarea id="customNodes" data-module="custom" class="glass-input w-full p-4 h-[100px] font-mono text-[13px] rounded-xl resize-y leading-relaxed text-pink-400" placeholder="# 粘贴自建节点...">${customNodes}</textarea>
                <div class="flex justify-end mt-3"><button type="button" id="customPreviewBtn" class="glass-card px-4 py-2 rounded-lg text-xs text-pink-300">预览自定义节点</button></div>
                <div id="customPreviewContent" class="hidden mt-3 max-h-48 overflow-y-auto rounded-lg border border-pink-400/20 bg-black/30 p-3 text-xs text-gray-300"></div>
            </div>
            ` : ''}
        </div>

        <!-- ================= 侧边辅助与分发区 ================= -->
        <div class="lg:col-span-5 flex flex-col gap-6">
            <div class="glass-card rounded-2xl p-6 relative overflow-hidden">
                <div class="absolute -top-10 -right-10 w-32 h-32 bg-[var(--neon-cyan)] rounded-full mix-blend-screen filter blur-[60px] opacity-20 pointer-events-none"></div>
                <div class="flex justify-between items-center cursor-pointer" onclick="toggleMySubs()"><h2 class="text-lg font-bold text-white mb-1 tracking-wide">专属地址 My Subs</h2><span id="mySubsToggle" class="text-xs text-gray-400">收起 ▲</span></div>
                <div id="mySubsContent">
                <div class="grid grid-cols-2 gap-4 mt-5">
                    ${subItems.map(item => generateSubCard(item, 'qr_my')).join('')}
                </div>
                </div>
            </div>

            <div class="glass-card rounded-2xl p-6">
                <div class="flex justify-between items-center cursor-pointer group" onclick="toggleNotice()">
                    <div>
                        <h2 class="text-md font-bold text-white tracking-wide">访客订阅 Guest Subs</h2>
                    </div>
                    <span id="noticeToggle" class="text-gray-500 font-mono text-xs border border-white/10 px-3 py-1 rounded-full bg-black/20">展开 ▼</span>
                </div>

                <div id="noticeContent" class="hidden mt-5 border-t border-white/10 pt-5">
                    <div class="mb-5 bg-black/40 p-3 rounded-xl border border-[var(--neon-purple)]/30">
                        <span class="text-xs text-gray-400">TOKEN: </span>
                        <strong class="neon-text-purple font-mono text-xs tracking-wider">${guest}</strong>
                    </div>

                    <div class="grid grid-cols-2 gap-4 opacity-70 hover:opacity-100 transition duration-500">
                        ${subItems.map(item => generateSubCard({
                            ...item,
                            path: `/sub?token=${guest}${item.path.split('?')[1] ? '&' + item.path.split('?')[1] : ''}`
                        }, 'qr_guest')).join('')}
                    </div>
                </div>
            </div>

            <div class="glass-card rounded-2xl p-5 text-xs font-mono text-gray-400">
                <div class="space-y-2">
                    <p>
                        <span class="text-[var(--neon-purple)] font-bold">SUBAPI:</span>
                        <span class="text-gray-300">${subProtocol}://${subConverter}</span>
                    </p>
                    <p>
                        <span class="text-[var(--neon-purple)] font-bold">CONFIG:</span>
                        <span class="text-gray-300 break-all">${subConfig}</span>
                    </p>
                </div>
            </div>
        </div>
    </div>

    <script>
        function showToast(message, type='success') {
            const container = document.getElementById('toast-container');
            if (!container) return;

            const toast = document.createElement('div');
            let borderColor = type === 'success' ? 'var(--neon-cyan)' : '#ff4757';

            toast.className = \`glass-card px-5 py-3 rounded-xl border border-[\${borderColor}] shadow-[0_0_15px_rgba(0,0,0,0.5)] text-white text-sm font-bold flex items-center gap-3 transform transition-all duration-300 translate-x-[120%] opacity-0\`;
            toast.innerHTML = \`<span class="text-[\${borderColor}] text-lg leading-none">\${type==='success'?'✓':'✕'}</span> \${message}\`;

            container.appendChild(toast);

            requestAnimationFrame(() => {
                setTimeout(() => {
                    toast.classList.remove('translate-x-[120%]', 'opacity-0');
                }, 10);
            });

            setTimeout(() => {
                toast.classList.add('translate-x-[120%]', 'opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }


        function decodeNodeNameSafe(text) {
            if (!text) return text;

            return text.split('\\n').map(line => {
                let hashIndex = line.lastIndexOf('#');

                if (hashIndex !== -1 && line.includes('://')) {
                    let beforeHash = line.substring(0, hashIndex);
                    let afterHash = line.substring(hashIndex + 1);

                    try {
                        return beforeHash + '#' + decodeURIComponent(afterHash);
                    } catch (e) {
                        return line;
                    }
                }

                return line;
            }).join('\\n');
        }
                window.onload = () => {
            ${subItems.map(item => `
                if(document.getElementById('qr_my_${item.name}')) new QRCode(document.getElementById('qr_my_${item.name}'), {
                    text: '${url.origin}${item.path}',
                    width: 85,
                    height: 85,
                    colorDark: "#000",
                    colorLight: "#fff",
                    correctLevel: QRCode.CorrectLevel.L
                });

                if(document.getElementById('qr_guest_${item.name}')) new QRCode(document.getElementById('qr_guest_${item.name}'), {
                    text: '${url.origin}/sub?token=${guest}${item.path.split('?')[1] ? '&' + item.path.split('?')[1] : ''}',
                    width: 85,
                    height: 85,
                    colorDark: "#000",
                    colorLight: "#fff",
                    correctLevel: QRCode.CorrectLevel.L
                });
            `).join('\n')}

            ['content', 'customNodes'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.value) el.value = decodeNodeNameSafe(el.value);
            });
        };


        function copyTo(text) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('订阅链接已复制！');
            });
        }


        function getPayload() {
            let content = document.getElementById('content')
                ? document.getElementById('content').value.replace(/：/g, ':')
                : '';

            let customNodes = document.getElementById('customNodes')
                ? document.getElementById('customNodes').value.replace(/：/g, ':')
                : '';

            return {
                links: decodeNodeNameSafe(content),
                customNodes: decodeNodeNameSafe(customNodes),
                config: {
                    autoEmoji: document.getElementById('cfg_autoEmoji')
                        ? document.getElementById('cfg_autoEmoji').checked
                        : true,

                    deepDeduplicate: document.getElementById('cfg_deepDeduplicate')
                        ? document.getElementById('cfg_deepDeduplicate').checked
                        : true,

                    sortNodes: document.getElementById('cfg_sortNodes')
                        ? document.getElementById('cfg_sortNodes').checked
                        : true,

                    dropInvalidNodes: document.getElementById('cfg_dropInvalidNodes')
                        ? document.getElementById('cfg_dropInvalidNodes').checked
                        : true,

                    globalRename: document.getElementById('cfg_globalRename')
                        ? document.getElementById('cfg_globalRename').value
                        : '',

                    addPrefix: document.getElementById('cfg_addPrefix')
                        ? document.getElementById('cfg_addPrefix').value
                        : '',

                    addSuffix: document.getElementById('cfg_addSuffix')
                        ? document.getElementById('cfg_addSuffix').value
                        : '',

                    retainNameRegex: document.getElementById('cfg_retainNameRegex')
                        ? document.getElementById('cfg_retainNameRegex').value
                        : '',

                    dropNameRegex: document.getElementById('cfg_dropNameRegex')
                        ? document.getElementById('cfg_dropNameRegex').value
                        : '',

                    replaceTarget: document.getElementById('cfg_replaceTarget')
                        ? document.getElementById('cfg_replaceTarget').value
                        : '',

                    replaceWith: document.getElementById('cfg_replaceWith')
                        ? document.getElementById('cfg_replaceWith').value
                        : '',

                    retainProtocols: window.CURRENT_RETAIN_PROTOCOLS || [],
                    dropProtocols: window.CURRENT_DROP_PROTOCOLS || [],
                    specificRules: window.CURRENT_SPECIFIC_RULES,
                    outputLimit: document.getElementById('outputLimit') ? Number(document.getElementById('outputLimit').value || 0) : 0,
                    favorites: Array.isArray(window.CURRENT_FAVORITES) ? window.CURRENT_FAVORITES : []
                }
            };
        }


        function applyPreviewSearch() {
            const keyword = (document.getElementById('previewSearch')?.value || '').toLowerCase();
            document.querySelectorAll('.preview-node').forEach(el => { el.style.display = (el.dataset.nodeName || '').toLowerCase().includes(keyword) ? '' : 'none'; });
            const visible = document.querySelectorAll('.preview-node:not([style*="display: none"])').length;
            const stat = document.getElementById('nodeStats');
            if (stat) stat.dataset.visible = String(visible);
        }
        document.getElementById('previewSearch')?.addEventListener('input', applyPreviewSearch);

        // ================= 前端核心：请求真实预览 =================
        const previewBtn = document.getElementById('previewBtn');

        if (previewBtn) {
            previewBtn.onclick = async () => {
                previewBtn.innerHTML = '⏳ 拉取与解析中...';
                previewBtn.disabled = true;

                try {
                    const payload = getPayload();
                    const targetKw = payload.config.replaceTarget;

                    const res = await fetch('/preview', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!res.ok) {
                        throw new Error(await res.text());
                    }

                    const resJson = await res.json();

                    if (resJson.error) {
                        throw new Error(resJson.error);
                    }

                    let htmlContent = '<ul class="space-y-3">';

                    // 极致的高亮算法 (删除线红色 vs 发光紫色)
                    const highlight = (text, keyword, isDeleteMode = false) => {
                        if (!keyword || !text) return text;

                        try {
                            const className = isDeleteMode
                                ? "bg-red-500/50 text-white px-0.5 mx-0.5 rounded line-through"
                                : "bg-[var(--neon-purple)] text-white px-1 py-0.5 mx-0.5 rounded shadow-[0_0_8px_var(--neon-purple)]";

                            return text.replace(
                                new RegExp(\`(\${keyword})\`, 'gi'),
                                \`<mark class="\${className}">$1</mark>\`
                            );
                        } catch (e) {
                            return text;
                        }
                    };

                    const renderList = (nodesArr, isCustom) => {
                        nodesArr.forEach((node, index) => {
                            if (!node.valid) return;
                            const nodeIsCustom = !!(node.isCustom || isCustom);

                            let origDisplay = highlight(node.originalName, targetKw, true);
                            let finalDisplay = highlight(node.name, payload.config.replaceWith, false);

                            let diffHtml = '';

                            if (node.originalName !== node.name && !nodeIsCustom) {
                                diffHtml = \`<div class="text-[11px] text-gray-500 line-through mb-1 flex items-center gap-2">
                                    <svg class="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                                    </svg>
                                    \${origDisplay}
                                </div>\`;
                            }

                            let hasRule = window.CURRENT_SPECIFIC_RULES[node.identifier];

                            let borderClass = hasRule
                                ? 'border-[var(--neon-purple)]/60 bg-[var(--neon-purple)]/10'
                                : 'border-white/10 hover:border-white/30 bg-black/50';

                            htmlContent += \`
                                <li data-node-name="\${String(node.name || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" class="preview-node p-3 rounded-xl border \${borderClass} transition-all duration-300 flex items-start gap-3 relative overflow-hidden group">
                                    \${!nodeIsCustom ? \`<input type="checkbox" class="node-checkbox form-checkbox h-4 w-4 mt-1.5 text-[var(--neon-cyan)] rounded border-gray-600 bg-black cursor-pointer" value="\${node.identifier}">\` : '<span class="w-4"></span>'}

                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 mb-1.5">
                                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-300 border border-gray-600 uppercase tracking-wider">
                                                \${node.protocol}
                                            </span>
                                            <button type="button" class="favorite-toggle text-xs px-2 py-0.5 rounded border border-yellow-400/30 text-yellow-300" data-favorite-id="\${node.identifier}">\${window.CURRENT_FAVORITES.includes(node.identifier) ? '★ 已收藏' : '☆ 收藏'}</button>

                                            \${nodeIsCustom ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-400 border border-pink-500/30">自定义输出</span>' : ''}

                                            \${hasRule ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-[var(--neon-purple)] border border-[var(--neon-purple)]/50">存在专属附加规则</span>' : ''}
                                        </div>

                                        \${diffHtml}

                                        <div class="text-[13px] font-bold text-[var(--neon-cyan)] truncate w-full" title="\${node.name}">
                                            \${finalDisplay}
                                        </div>

                                        <div class="text-[9px] text-gray-500 truncate w-full mt-1.5 border-t border-white/5 pt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            \${node.raw}
                                        </div>
                                    </div>
                                </li>
                            \`;
                        });
                    };

                    if (resJson.nodes && resJson.nodes.length > 0) {
                        renderList(resJson.nodes, false);
                    } else {
                        htmlContent += '<li class="text-gray-500 p-4 text-center">暂无符合条件的节点（有可能全部被你的剔除规则排除了）</li>';
                    }

                    if (resJson.customNodes && resJson.customNodes.length > 0) {
                        renderList(resJson.customNodes, true);
                    }

                    htmlContent += '</ul>';

                    document.getElementById('previewContent').innerHTML = htmlContent;
                    window.PREVIEW_NODES = (resJson.nodes || []).concat(resJson.customNodes || []);
                    const stat = document.getElementById('nodeStats');
                    if (stat) { stat.title = (resJson.failures || []).map(x => x.url + '：' + x.error).join('\\n'); stat.textContent = \`可用节点 \${resJson.totalNodes ?? window.PREVIEW_NODES.length} · 当前输出 \${resJson.outputNodes ?? window.PREVIEW_NODES.length} · 收藏 \${resJson.favoriteCount ?? window.CURRENT_FAVORITES.length} · 数量上限 \${resJson.outputLimit || '不限'}\` + ((resJson.failures || []).length ? \` · 失败订阅 \${(resJson.failures || []).length}（悬停查看原因）\` : ''); }
                    if ((resJson.failures || []).length) showToast('有 '+resJson.failures.length+' 个订阅源抓取失败，详情见节点统计区域', 'error');
                    if ((resJson.unmatchedFavorites || []).length) showToast('有 '+resJson.unmatchedFavorites.length+' 个收藏节点暂未匹配到，请检查订阅源或节点是否变更', 'error');
                    document.querySelectorAll('.favorite-toggle').forEach(button => button.addEventListener('click', () => {
                        const id = button.dataset.favoriteId;
                        if (window.CURRENT_FAVORITES.includes(id)) window.CURRENT_FAVORITES = window.CURRENT_FAVORITES.filter(x => x !== id);
                        else window.CURRENT_FAVORITES.push(id);
                        rememberModule('preview');
                        button.textContent = window.CURRENT_FAVORITES.includes(id) ? '★ 已收藏' : '☆ 收藏';
                        if (document.getElementById('previewBtn')) document.getElementById('previewBtn').click();
                    }));
                    applyPreviewSearch();

                    // 绑定选中框事件
                    document.querySelectorAll('.node-checkbox').forEach(cb => {
                        cb.addEventListener('change', () => {
                            document.getElementById('selectedCount').innerText =
                                document.querySelectorAll('.node-checkbox:checked').length;
                        });
                    });

                    document.getElementById('selectedCount').innerText = '0';

                    document.getElementById('previewSection').classList.remove('hidden');
                    document.getElementById('previewSection').classList.add('flex');

                    document.getElementById('previewSection').scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });

                } catch (e) {
                    showToast('预览失败: ' + e.message, 'error');
                } finally {
                    previewBtn.innerHTML = '⚡ 应用配置并预览';
                    previewBtn.disabled = false;
                }
            };
        }
                // ================= 前端核心：专有规则附加 =================
        const applyBatchBtn = document.getElementById('applyBatchBtn');

        if (applyBatchBtn) {
            applyBatchBtn.onclick = () => {
                const checked = document.querySelectorAll('.node-checkbox:checked');

                if (checked.length === 0) {
                    showToast('请先在下方列表中勾选你需要应用规则的节点！', 'error');
                    return;
                }

                rememberModule('rules');
                const p = document.getElementById('batchPrefix').value;
                const s = document.getElementById('batchSuffix').value;

                if (!p && !s) {
                    showToast('前缀或后缀请至少填写一项！', 'error');
                    return;
                }

                checked.forEach(cb => {
                    const id = cb.value;

                    if (!window.CURRENT_SPECIFIC_RULES[id]) {
                        window.CURRENT_SPECIFIC_RULES[id] = {};
                    }

                    if (p) window.CURRENT_SPECIFIC_RULES[id].prefix = p;
                    if (s) window.CURRENT_SPECIFIC_RULES[id].suffix = s;
                });

                showToast(\`成功！已为 \${checked.length} 个节点赋予了独立前后缀。\`);

                document.getElementById('batchPrefix').value = '';
                document.getElementById('batchSuffix').value = '';

                // 自动再次触发预览
                if (document.getElementById('previewBtn')) {
                    document.getElementById('previewBtn').click();
                }
            };
        }


        const clearBatchBtn = document.getElementById('clearBatchBtn');

        if (clearBatchBtn) {
            clearBatchBtn.onclick = () => {
                rememberModule('rules');
                window.CURRENT_SPECIFIC_RULES = {};
                showToast('已清空所有专属前后缀规则！');

                if (document.getElementById('previewBtn')) {
                    document.getElementById('previewBtn').click();
                }
            };
        }


        // 模块暂存、撤销/重做与全局正式保存严格分离
        const moduleFields = {
            links: ['content'],
            rules: ['cfg_autoEmoji','cfg_deepDeduplicate','cfg_sortNodes','cfg_dropInvalidNodes','cfg_replaceTarget','cfg_replaceWith','cfg_retainNameRegex','cfg_dropNameRegex','cfg_globalRename','cfg_addPrefix','cfg_addSuffix'],
            preview: ['outputLimit'],
            custom: ['customNodes']
        };
        const moduleState = {};
        const moduleHistory = {};
        const clone = value => JSON.parse(JSON.stringify(value));
        function readModule(id) {
            const state = {};
            (moduleFields[id] || []).forEach(key => { const el = document.getElementById(key); if (el) state[key] = el.type === 'checkbox' ? el.checked : el.value; });
            if (id === 'rules') state.specificRules = clone(window.CURRENT_SPECIFIC_RULES || {});
            if (id === 'preview') state.favorites = clone(window.CURRENT_FAVORITES || []);
            return state;
        }
        function applyModule(id, state) {
            if (!state) return;
            Object.entries(state).forEach(([key,value]) => {
                if (key === 'specificRules') { window.CURRENT_SPECIFIC_RULES = clone(value || {}); return; }
                if (key === 'favorites') { window.CURRENT_FAVORITES = clone(value || []); return; }
                const el = document.getElementById(key); if (el) { if (el.type === 'checkbox') el.checked = !!value; else el.value = value ?? ''; }
            });
        }
        function rememberModule(id) {
            const current = readModule(id);
            const h = moduleHistory[id];
            if (JSON.stringify(h.items[h.index]) === JSON.stringify(current)) return;
            h.items = h.items.slice(0, h.index + 1); h.items.push(clone(current));
            if (h.items.length > 11) h.items.shift();
            h.index = h.items.length - 1; updateHistoryButtons(id);
        }
        function updateHistoryButtons(id) {
            const h = moduleHistory[id];
            document.querySelectorAll(\`[data-undo="\${id}"]\`).forEach(b => b.disabled = !h || h.index <= 0);
            document.querySelectorAll(\`[data-redo="\${id}"]\`).forEach(b => b.disabled = !h || h.index >= h.items.length - 1);
        }
        const staged = { links: document.getElementById('content')?.value || '', customNodes: document.getElementById('customNodes')?.value || '', config: getPayload().config };
        ['links','rules','preview','custom'].forEach(id => { const initial = readModule(id); moduleState[id] = clone(initial); moduleHistory[id] = {items:[clone(initial)],index:0}; updateHistoryButtons(id); });
        document.querySelectorAll('[data-module]').forEach(el => {
            const id = el.dataset.module;
            el.addEventListener('input', () => { const status=document.getElementById(id+'Status'); if(status) status.textContent='有未暂存修改'; clearTimeout(el._historyTimer); el._historyTimer = setTimeout(() => rememberModule(id), 250); });
            el.addEventListener('change', () => { const status=document.getElementById(id+'Status'); if(status) status.textContent='有未暂存修改'; rememberModule(id); });
        });
        document.querySelectorAll('[data-module-save]').forEach(button => button.addEventListener('click', () => {
            const id = button.dataset.moduleSave; rememberModule(id); moduleState[id] = readModule(id);
            if (id === 'links') staged.links = moduleState[id].content;
            if (id === 'custom') staged.customNodes = moduleState[id].customNodes;
            if (id === 'rules') { const current = getPayload().config; ['autoEmoji','deepDeduplicate','sortNodes','dropInvalidNodes','globalRename','addPrefix','addSuffix','retainNameRegex','dropNameRegex','replaceTarget','replaceWith','specificRules'].forEach(k => staged.config[k] = current[k]); }
            if (id === 'preview') { staged.config.outputLimit = Number(moduleState[id].outputLimit || 0); staged.config.favorites = clone(moduleState[id].favorites || []); }
            const status = document.getElementById(id + 'Status'); if (status) status.textContent = '已暂存，等待全局保存';
            showToast('本模块已暂存，点击「保存所有配置」后才会正式生效');
        }));
        document.querySelectorAll('[data-module-restore]').forEach(button => button.addEventListener('click', () => {
            const id = button.dataset.moduleRestore; applyModule(id, moduleState[id]);
            rememberModule(id); showToast('已恢复本模块最近一次暂存状态');
        }));
        document.querySelectorAll('[data-undo]').forEach(button => button.addEventListener('click', () => {
            const id = button.dataset.undo, h = moduleHistory[id]; if (h.index <= 0) return;
            h.index--; applyModule(id, h.items[h.index]); updateHistoryButtons(id);
        }));
        document.querySelectorAll('[data-redo]').forEach(button => button.addEventListener('click', () => {
            const id = button.dataset.redo, h = moduleHistory[id]; if (h.index >= h.items.length - 1) return;
            h.index++; applyModule(id, h.items[h.index]); updateHistoryButtons(id);
        }));
                // 显式规则按钮：点击才执行；规则值仍由服务端处理引擎执行
        document.getElementById('findKeywordBtn')?.addEventListener('click', () => {
            const input = document.getElementById('ruleFindKeyword');
            const search = document.getElementById('previewSearch'); if (search) search.value = input.value;
            document.getElementById('previewSection')?.classList.remove('hidden');
            document.getElementById('previewBtn')?.click();
            showToast('查找仅过滤预览显示，不会删除节点');
        });
        document.getElementById('replaceKeywordBtn')?.addEventListener('click', () => { rememberModule('rules'); document.getElementById('previewBtn')?.click(); });
        document.getElementById('retainRegexBtn')?.addEventListener('click', () => { try { const v=document.getElementById('cfg_retainNameRegex').value; if(v) new RegExp(v,'i'); rememberModule('rules'); document.getElementById('previewBtn')?.click(); } catch(e) { showToast('正则保留表达式错误：'+e.message,'error'); } });
        document.getElementById('dropRegexBtn')?.addEventListener('click', () => { try { const v=document.getElementById('cfg_dropNameRegex').value; if(v) new RegExp(v,'i'); rememberModule('rules'); document.getElementById('previewBtn')?.click(); } catch(e) { showToast('正则剔除表达式错误：'+e.message,'error'); } });
        document.getElementById('renameBtn')?.addEventListener('click', () => { rememberModule('rules'); document.getElementById('previewBtn')?.click(); });
        document.getElementById('prefixBtn')?.addEventListener('click', () => { rememberModule('rules'); document.getElementById('previewBtn')?.click(); });
        document.getElementById('suffixBtn')?.addEventListener('click', () => { rememberModule('rules'); document.getElementById('previewBtn')?.click(); });
        document.getElementById('sourcePreviewBtn')?.addEventListener('click', () => document.getElementById('previewBtn')?.click());
        document.getElementById('customPreviewBtn')?.addEventListener('click', async () => {
            const button = document.getElementById('customPreviewBtn');
            const panel = document.getElementById('customPreviewContent');
            button.disabled = true; button.textContent = '解析中…';
            try {
                const response = await fetch('/preview', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(getPayload())});
                const data = await response.json(); if (!response.ok) throw new Error(data.error || '预览失败');
                const custom = (data.nodes || []).filter(node => node.isCustom && node.valid);
                panel.textContent = custom.length ? custom.map((node,i) => \`\${i+1}. \${node.name} [\${node.protocol}]\`).join('\\n') : '暂无有效自定义节点';
                panel.classList.remove('hidden');
            } catch(e) { showToast('自定义节点预览失败：'+e.message,'error'); }
            finally { button.disabled=false; button.textContent='预览自定义节点'; }
        });

        // 全局提交只提交各模块已暂存的内容；未暂存编辑不会偷偷写入 KV
        const saveAllBtn = document.getElementById('saveAllBtn');
        if (saveAllBtn) saveAllBtn.addEventListener('click', async () => {
            saveAllBtn.disabled = true; saveAllBtn.textContent = '正在提交…';
            try {
                const payload = { links: staged.links, customNodes: staged.customNodes, config: clone(staged.config) };
                const res = await fetch('/admin', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
                const result = await res.json();
                if (!res.ok || !result.success) throw new Error(result.error || '保存失败');
                applyModule('links', {content: staged.links});
                applyModule('custom', {customNodes: staged.customNodes});
                const stagedRules = {
                    cfg_autoEmoji: staged.config.autoEmoji, cfg_deepDeduplicate: staged.config.deepDeduplicate,
                    cfg_sortNodes: staged.config.sortNodes, cfg_dropInvalidNodes: staged.config.dropInvalidNodes,
                    cfg_replaceTarget: staged.config.replaceTarget || '', cfg_replaceWith: staged.config.replaceWith || '',
                    cfg_retainNameRegex: staged.config.retainNameRegex || '', cfg_dropNameRegex: staged.config.dropNameRegex || '',
                    cfg_globalRename: staged.config.globalRename || '', cfg_addPrefix: staged.config.addPrefix || '',
                    cfg_addSuffix: staged.config.addSuffix || '', specificRules: staged.config.specificRules || {}
                };
                applyModule('rules', stagedRules);
                applyModule('preview', {outputLimit: staged.config.outputLimit || 0, favorites: staged.config.favorites || []});
                ['links','rules','preview','custom'].forEach(id => {
                    moduleState[id] = readModule(id);
                    const h = moduleHistory[id]; h.items = [clone(moduleState[id])]; h.index = 0; updateHistoryButtons(id);
                    const status = document.getElementById(id+'Status'); if(status) status.textContent = '全局已生效';
                });
                const saveStatus = document.getElementById('linksStatus');
                if (saveStatus) saveStatus.textContent = '全局保存成功 ' + new Date(result.savedAt).toLocaleTimeString('zh-CN',{hour12:false});
                showToast(result.compatibilityMirrorWarning ? '统一配置已生效；旧键兼容镜像有部分写入失败' : '全部配置已正式保存并生效');
            } catch(e) { showToast('全局保存失败：'+e.message,'error'); }
            finally { saveAllBtn.disabled=false; saveAllBtn.textContent='保存所有配置'; }
        });

        // CN / UTC 使用同一个时间戳，每秒刷新
        function updateClocks() {
            const now = new Date();
            const fmt = zone => new Intl.DateTimeFormat('sv-SE', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now);
            const cn = document.getElementById('cnClock'), utc = document.getElementById('utcClock');
            if (cn) cn.textContent = fmt('Asia/Shanghai'); if (utc) utc.textContent = fmt('UTC');
        }
        updateClocks(); setInterval(updateClocks,1000);

        function toggleMySubs() {
            const el=document.getElementById('mySubsContent'), btn=document.getElementById('mySubsToggle');
            el.classList.toggle('hidden'); btn.textContent=el.classList.contains('hidden')?'展开 ▼':'收起 ▲';
        }

        function toggleNotice() {
            const el = document.getElementById('noticeContent');
            const btn = document.getElementById('noticeToggle');

            if (el.classList.contains('hidden')) {
                el.classList.remove('hidden');
                btn.textContent = '收起 ▲';
            } else {
                el.classList.add('hidden');
                btn.textContent = '展开 ▼';
            }
        }


        // 注入美化滚动条
        const style = document.createElement('style');

        style.innerHTML = \`
            .custom-scrollbar::-webkit-scrollbar { width: 6px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,243,255,0.3); border-radius: 4px; }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0,243,255,0.6); }
        \`;

        document.head.appendChild(style);
    </script>
</body>
</html>`;
}
// 基础编解码函数
async function ADD(envadd) {
    var addtext = envadd
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

    // 【修复 1】：取消透传前端的 Accept，防止目标 API 返回 JSON 数据导致后续无法解析 Base64
    newHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,application/x-envoy,*/*;q=0.8');

    // 【修复 2】：移除浏览器 UA 中的 Mozilla 标识，防止被订阅防DDoS面板识别为浏览器而返回网页
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


// ====== 多订阅源并发抓取与解析 ======
async function getSUB(api, request, 追加UA, userAgentHeader) {
    const sources = Array.isArray(api)
        ? [...new Set(api.filter(item =>
            typeof item === 'string' && item.trim()
        ))]
        : [];

    if (sources.length === 0) {
        return [[], '', []];
    }

    let newapi = '';
    let 异常订阅 = '';
    let 订阅转换URLs = '';
    const failures = [];

    const controller = new AbortController();

    // 给远程订阅留出合理响应时间，并真正把 signal 传给 fetch。
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        const responses = await Promise.allSettled(
            sources.map(async apiUrl => {
                const response = await getUrl(
                    request,
                    apiUrl,
                    追加UA,
                    userAgentHeader,
                    controller.signal
                );

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                return response.text();
            })
        );

        responses.forEach((response, index) => {
            if (response.status !== 'fulfilled') {
                const reason = response.reason?.message || String(response.reason || '未知错误');
                failures.push({ url: sources[index], error: reason });
                console.warn('订阅源抓取失败:', sources[index], reason);
                return;
            }

            const content = String(response.value || '')
                .replace(/^\uFEFF/, '')
                .trim();

            if (!content) return;

            const anomalyHost = new URL(sources[index]).host;

            const anomalyNode =
                'trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#' +
                encodeURIComponent(`异常订阅 ${anomalyHost}`) +
                '\n';

            // Clash YAML / sing-box JSON：这里只记录转换 URL，不直接解析为节点。
            if (
                content.includes('proxies:') ||
                (content.includes('outbounds"') && content.includes('inbounds"'))
            ) {
                订阅转换URLs += '|' + sources[index];

            } else if (content.includes('://')) {
                // 明文节点
                newapi += content + '\n';

            } else {
                // Base64 订阅
                const compact = content.replace(/\s/g, '');

                if (/^[A-Za-z0-9+/_=-]+$/.test(compact)) {
                    try {
                        newapi += base64Decode(compact) + '\n';
                    } catch (error) {
                        console.warn(
                            '订阅 Base64 解码失败:',
                            sources[index],
                            error
                        );

                        异常订阅 += anomalyNode;
                    }
                } else {
                    异常订阅 += anomalyNode;
                }
            }
        });

    } catch (error) {
        console.error('订阅抓取异常:', error);

    } finally {
        clearTimeout(timeout);
    }

    return [
        await ADD(newapi + 异常订阅),
        订阅转换URLs,
        failures
    ];
}
