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
    outputLimit: 0, favorites: []
};

function chooseOutputNodes(nodes, config) {
    const limit = Number(config?.outputLimit || 0);
    if (!Number.isInteger(limit) || limit < 0) throw new Error('节点数量限制必须是非负整数');
    const favorites = new Set(Array.isArray(config?.favorites) ? config.favorites : []);
    const pinned = nodes.filter(n => n.valid && favorites.has(nodeStableId(n)));
    const ordinary = nodes.filter(n => !n.valid || !favorites.has(nodeStableId(n)));
    if (!limit || nodes.length <= limit || pinned.length >= limit) return pinned.length >= limit && limit ? [...pinned, ...ordinary.filter(n=>!n.valid)] : nodes;
    const pool = ordinary.filter(n => n.valid);
    for (let i=pool.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
    return [...pinned, ...pool.slice(0, Math.max(0, limit-pinned.length)), ...ordinary.filter(n=>!n.valid)];
}
function nodeStableId(n) { return n.protocol === 'vmess' ? `${n.protocol}://${n.address}:${n.port}/${n.id}` : `${n.protocol}://${n.address}:${n.port}/${n.id || ''}`; }

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
                const rawResolved = await resolveLinksToNodes(
                    data.links || '',
                    request,
                    userAgentHeader
                );

                // 2. 将抓取到的裸节点输入二次编辑引擎处理
                const processedArray = processNodes(rawResolved, data.config || {});

                // 3. 处理自定义节点（不受上方过滤规则限制）
                const customArray = processNodes(
                    data.customNodes || '',
                    Object.assign({}, data.config, { isCustom: true })
                );

                return new Response(JSON.stringify({
                    nodes: processedArray,
                    customNodes: customArray
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
                    let snapshot = await env.KV.get('CONFIG_SNAPSHOT.json');
                    if (snapshot) {
                        try { const committed = JSON.parse(snapshot); MainData = committed.links ?? MainData; customOutputNodes = committed.customNodes ?? ''; Object.assign(dynamicConfig, committed.config || {}); } catch (_) {}
                    } else {
                    MainData = await env.KV.get('LINK.txt') || MainData;
                    customOutputNodes = await env.KV.get('CUSTOM_NODES.txt') || "";
                    let kvCfg = await env.KV.get('EDIT_CONFIG.json');
                    if (kvCfg) {
                        try {
                            Object.assign(dynamicConfig, JSON.parse(kvCfg));
                        } catch (e) {}
                    }
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

            // 合并输出
            let outputNodes = chooseOutputNodes([...nodeArray, ...processNodes(customOutputNodes, Object.assign({}, dynamicConfig, { isCustom: true }))], dynamicConfig);
            let finalOutput = buildSubString(outputNodes);

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
async function resolveLinksToNodes(text, request, userAgentHeader) {
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
                    'Set-Cookie': `admin_session=${sessionToken}; HttpOnly; Path=/; Max-Age=864000`
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

    // 全局唯一保存接口
    if (request.method === 'POST' && url.pathname === '/admin') {
        if (!env.KV) {
            return new Response("未绑定KV", { status: 400 });
        }

        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            try {
                const textData = await request.text();
                const data = JSON.parse(textData);
                if (typeof data.links !== 'string' || typeof data.customNodes !== 'string' || !data.config || typeof data.config !== 'object' || Array.isArray(data.config)) throw new Error('配置数据格式错误');
                const limit = Number(data.config.outputLimit || 0);
                if (!Number.isInteger(limit) || limit < 0 || limit > 100000) throw new Error('节点数量限制须为 0 至 100000 的整数');
                if (data.config.favorites !== undefined && (!Array.isArray(data.config.favorites) || data.config.favorites.some(x => typeof x !== 'string'))) throw new Error('收藏节点数据格式错误');
                const snapshot = JSON.stringify({ version: 1, links: data.links, customNodes: data.customNodes, config: data.config, committedAt: new Date().toISOString() });
                await env.KV.put('CONFIG_SNAPSHOT.json', snapshot);
                // 兼容旧版本后台/订阅入口；正式订阅优先读取上方单键提交快照。
                await Promise.allSettled([env.KV.put('LINK.txt', data.links), env.KV.put('CUSTOM_NODES.txt', data.customNodes), env.KV.put('EDIT_CONFIG.json', JSON.stringify(data.config))]);

                return new Response(JSON.stringify({ ok: true, committedAt: JSON.parse(snapshot).committedAt }), { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
            } catch (e) {
                return new Response("JSON 解析异常: " + e.message, { status: 400 });
            }
        } else {
            const content = await request.text();
            await env.KV.put('LINK.txt', content);
            return new Response("保存成功", { status: 200 });
        }
    }

    let content = '';
    let customNodes = '';
    let configObj = Object.assign({}, DEFAULT_NODE_EDIT_CONFIG);
    let hasKV = !!env.KV;

    if (hasKV) {
        content = await env.KV.get('LINK.txt') || '';
        customNodes = await env.KV.get('CUSTOM_NODES.txt') || '';

        let kvCfg = await env.KV.get('EDIT_CONFIG.json');

        if (kvCfg) {
            try {
                Object.assign(configObj, JSON.parse(kvCfg));
            } catch (e) {}
        }
    }

    return new Response(
        renderDashboardHTML(
            content,
            customNodes,
            configObj,
            guest,
            url,
            mytoken,
            FileName,
            hasKV,
            subProtocol,
            subConverter,
            subConfig,
            userAgentHeader
        ),
        {
            headers: {
                "Content-Type": "text/html;charset=utf-8",
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        }
    );
}


const globalCSS = `
<style>
    :root {
        --glass-bg: rgba(17, 25, 40, 0.6);
        --glass-border: rgba(255, 255, 255, 0.125);
        --neon-cyan: #00f3ff;
        --neon-purple: #b026ff;
    }

    body {
        background-color: #0f172a;
        color: #e2e8f0;
    }

    .orb {
        position: fixed;
        border-radius: 50%;
        filter: blur(100px);
        opacity: 0.4;
        z-index: -1;
        animation: float 10s infinite ease-in-out alternate;
    }

    .orb-1 {
        width: 400px;
        height: 400px;
        background: var(--neon-cyan);
        top: -100px;
        left: -100px;
    }

    .orb-2 {
        width: 500px;
        height: 500px;
        background: var(--neon-purple);
        bottom: -100px;
        right: -100px;
        animation-delay: -5s;
    }

    .orb-3 {
        width: 300px;
        height: 300px;
        background: #ff0055;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        animation-delay: -2s;
        opacity: 0.2;
    }

    @keyframes float {
        0% { transform: translate(0, 0) scale(1); }
        100% { transform: translate(30px, 50px) scale(1.1); }
    }

    .glass-card {
        background-color: var(--glass-bg);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid var(--glass-border);
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
    }

    .glass-input {
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #fff;
        transition: all 0.3s;
    }

    .glass-input:focus {
        border-color: var(--neon-cyan);
        box-shadow: 0 0 15px rgba(0, 243, 255, 0.3);
        outline: none;
    }

    .neon-text-cyan {
        color: var(--neon-cyan);
        text-shadow: 0 0 8px rgba(0, 243, 255, 0.5);
    }

    .neon-text-purple {
        color: #d980ff;
        text-shadow: 0 0 8px rgba(176, 38, 255, 0.5);
    }

    .neon-btn {
        background: linear-gradient(45deg, #00f3ff, #0088ff);
        color: #000;
        box-shadow: 0 0 15px rgba(0, 243, 255, 0.4);
        transition: all 0.3s;
        border: none;
    }

    .neon-btn:hover {
        box-shadow: 0 0 25px rgba(0, 243, 255, 0.7);
        transform: translateY(-2px);
    }

    ::-webkit-scrollbar {
        width: 8px;
    }

    ::-webkit-scrollbar-track {
        background: rgba(0,0,0,0.1);
    }

    ::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.2);
        border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
        background: rgba(255,255,255,0.4);
    }
</style>
`;


function renderLoginHTML(isError = false) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>系统后台登录</title>
    <script src="https://cdn.tailwindcss.com"></script>
    ${globalCSS}
</head>
<body class="h-screen flex items-center justify-center relative overflow-hidden">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>

    <div class="glass-card p-10 rounded-3xl shadow-2xl w-96 relative z-10 border-t border-l border-white/20">
        <div class="mb-8 text-center">
            <h1 class="text-3xl font-bold text-white tracking-wider drop-shadow-md">
                NODE<span class="neon-text-cyan"> HUB</span>
            </h1>
            <p class="text-sm text-gray-400 mt-2">安全聚合控制台</p>
        </div>

        ${isError ? '<div class="bg-red-500/20 border border-red-500/50 text-red-300 p-3 mb-6 text-sm rounded backdrop-blur-md">账号或密码错误，请重试</div>' : ''}

        <form action="/login" method="POST" class="space-y-6">
            <div>
                <label class="block text-gray-300 text-xs font-bold mb-2 uppercase tracking-wide"> 用户名 </label>
                <input type="text" name="username" class="glass-input w-full px-4 py-3 rounded-xl placeholder-gray-500" placeholder="请输入用户名" required>
            </div>

            <div>
                <label class="block text-gray-300 text-xs font-bold mb-2 uppercase tracking-wide"> 密码 </label>
                <input type="password" name="password" class="glass-input w-full px-4 py-3 rounded-xl placeholder-gray-500" placeholder="请输入密码" required>
            </div>

            <button type="submit" class="neon-btn w-full font-bold py-3 px-4 rounded-xl mt-4 uppercase tracking-widest text-sm">
                授权登录 LOGIN
            </button>
        </form>
    </div>
</body>
</html>`;
}


function renderDashboardHTML(
    content,
    customNodes,
    configObj,
    guest,
    url,
    mytoken,
    FileName,
    hasKV,
    subProtocol,
    subConverter,
    subConfig,
    userAgentHeader
) {
    const subItems = [
        {
            name: '自适应',
            path: `/${mytoken}?sub`,
            badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30'
        },
        {
            name: 'Base64',
            path: `/${mytoken}?b64`,
            badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
        },
        {
            name: 'Clash',
            path: `/${mytoken}?clash`,
            badge: 'bg-pink-500/20 text-pink-300 border-pink-500/30'
        },
        {
            name: 'Singbox',
            path: `/${mytoken}?sb`,
            badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30'
        }
    ];

    const generateSubCard = (item, prefix) => `
        <div class="glass-card rounded-xl p-4 flex flex-col justify-between hover:border-[var(--neon-cyan)] hover:shadow-[0_0_15px_rgba(0,243,255,0.2)] transition-all duration-300 group cursor-pointer" onclick="copyTo('${url.origin}${item.path}')">
            <div class="flex justify-between items-start mb-3">
                <span class="px-2.5 py-1 text-[10px] font-bold rounded border ${item.badge} tracking-wider uppercase">${item.name}</span>
                <span class="text-gray-500 group-hover:text-[var(--neon-cyan)] transition">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    </svg>
                </span>
            </div>

            <div class="flex flex-col items-center">
                <div class="p-1.5 bg-white/90 rounded-lg shadow-sm group-hover:shadow-[0_0_10px_#fff] transition">
                    <div id="${prefix}_${item.name}"></div>
                </div>
                <p class="text-[9px] text-gray-500 mt-3 truncate w-full text-center group-hover:text-gray-300 font-mono">
                    ${url.origin}${item.path}
                </p>
            </div>
        </div>
    `;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
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
        window.CURRENT_SPECIFIC_RULES = ${JSON.stringify(configObj.specificRules || {})};
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

            <a href="/logout" class="text-xs font-bold text-gray-400 hover:text-red-400 transition uppercase tracking-wider px-4 py-2 glass-card rounded-full hover:border-red-500/50">
                登出 LOGOUT
            </a>
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

                    <div class="flex items-center gap-3">
                        <span id="saveStatus" class="text-xs text-[var(--neon-cyan)] font-mono mr-2"></span>

                        <button
                            id="restoreBtn"
                            type="button"
                            onclick="if (confirm('确定放弃当前所有未保存修改，并恢复到上次保存的整体配置吗？')) window.location.reload();"
                            class="flex items-center justify-center h-10 px-4 gap-2 rounded-xl text-sm font-bold text-gray-300 border border-gray-600 hover:text-white hover:border-red-500/50 hover:bg-red-500/10 transition-all bg-black/20 cursor-pointer"
                            title="放弃未保存的修改，重新读取 KV 中已保存的整体配置"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                            取消恢复（整体配置）
                        </button>

                        <button id="saveBtn" class="neon-btn flex items-center justify-center h-10 px-5 gap-2 rounded-xl text-sm font-bold text-black cursor-pointer shadow-[0_0_15px_rgba(0,243,255,0.4)]">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path>
                            </svg>
                            保存配置(最终生效)
                        </button>
                    </div>
                </div>

                ${hasKV ? `<textarea id="content" class="glass-input w-full p-4 h-[120px] font-mono text-[13px] rounded-xl resize-y leading-relaxed text-green-400" placeholder="# 粘贴原始节点或订阅链接...">${content}</textarea>` : '<div class="h-[100px] flex items-center justify-center bg-red-900/20 text-red-400 font-medium rounded-xl">未绑定 KV，功能不可用</div>'}
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

                <div class="grid grid-cols-2 gap-4 mb-5 pb-2">
                    <label class="flex items-center space-x-2 cursor-pointer group">
                        <input type="checkbox" id="cfg_autoEmoji" class="form-checkbox text-cyan-400 rounded bg-black/20 border-white/20 h-4 w-4" ${configObj.autoEmoji ? 'checked' : ''}>
                        <span class="text-xs text-gray-300 group-hover:text-[var(--neon-cyan)] transition">自动地区 Emoji (🇭🇰🇯🇵)</span>
                    </label>

                    <label class="flex items-center space-x-2 cursor-pointer group">
                        <input type="checkbox" id="cfg_deepDeduplicate" class="form-checkbox text-cyan-400 rounded bg-black/20 border-white/20 h-4 w-4" ${configObj.deepDeduplicate ? 'checked' : ''}>
                        <span class="text-xs text-gray-300 group-hover:text-[var(--neon-cyan)] transition">深度去重 (剔同IP端口)</span>
                    </label>

                    <label class="flex items-center space-x-2 cursor-pointer group">
                        <input type="checkbox" id="cfg_sortNodes" class="form-checkbox text-cyan-400 rounded bg-black/20 border-white/20 h-4 w-4" ${configObj.sortNodes ? 'checked' : ''}>
                        <span class="text-xs text-gray-300 group-hover:text-[var(--neon-cyan)] transition">智能排序 (信息置顶)</span>
                    </label>

                    <label class="flex items-center space-x-2 cursor-pointer group">
                        <input type="checkbox" id="cfg_dropInvalidNodes" class="form-checkbox text-cyan-400 rounded bg-black/20 border-white/20 h-4 w-4" ${configObj.dropInvalidNodes ? 'checked' : ''}>
                        <span class="text-xs text-gray-300 group-hover:text-[var(--neon-cyan)] transition">剔除无效节点(防报错)</span>
                    </label>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="md:col-span-2">
                        <label class="text-[10px] text-[var(--neon-purple)] block mb-1">查找关键字 (在下方预览中将高亮展示被删内容)</label>
                        <input type="text" id="cfg_replaceTarget" class="glass-input w-full p-2 text-xs rounded-lg border-[var(--neon-purple)]/50" value="${configObj.replaceTarget || ''}" placeholder="例: @clashV8">
                    </div>

                    <div class="md:col-span-2">
                        <label class="text-[10px] text-[var(--neon-purple)] block mb-1">替换为 (留空则代表直接删除查找到的词)</label>
                        <input type="text" id="cfg_replaceWith" class="glass-input w-full p-2 text-xs rounded-lg border-[var(--neon-purple)]/50" value="${configObj.replaceWith || ''}" placeholder="例: 星链">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-400 block mb-1 mt-2">正则保留(名称)</label>
                        <input type="text" id="cfg_retainNameRegex" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.retainNameRegex || ''}" placeholder="如：香港|日本">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-400 block mb-1 mt-2">正则剔除(名称)</label>
                        <input type="text" id="cfg_dropNameRegex" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.dropNameRegex || ''}" placeholder="如：过期|流量">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-400 block mb-1 mt-2">全局重命名(覆盖)</label>
                        <input type="text" id="cfg_globalRename" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.globalRename || ''}" placeholder="如：专属节点">
                    </div>

                    <div class="flex gap-2">
                        <div class="w-1/2">
                            <label class="text-[10px] text-gray-400 block mb-1 mt-2">统一前缀</label>
                            <input type="text" id="cfg_addPrefix" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.addPrefix || ''}" placeholder="如：🚀">
                        </div>

                        <div class="w-1/2">
                            <label class="text-[10px] text-gray-400 block mb-1 mt-2">统一后缀</label>
                            <input type="text" id="cfg_addSuffix" class="glass-input w-full p-2 text-xs rounded-lg" value="${configObj.addSuffix || ''}" placeholder="如：[Pro]">
                        </div>
                    </div>
                </div>
            </div>

            <!-- 3. 自定义节点 -->
            <div class="glass-card rounded-2xl p-6 flex flex-col">
                <h2 class="text-lg font-bold text-pink-400 mb-1 tracking-wide">自定义输出节点 (Custom Output)</h2>
                <p class="text-[11px] text-gray-400 mb-4 font-mono">在此填写的节点将<strong class="text-white">不受上方规则限制</strong>，强制追加到订阅末尾</p>
                <textarea id="customNodes" class="glass-input w-full p-4 h-[80px] font-mono text-[13px] rounded-xl resize-y leading-relaxed text-pink-400" placeholder="# 粘贴自建节点...">${customNodes}</textarea>
            </div>

            <!-- 4. 实时节点预览区域 -->
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

            ` : ''}
        </div>

        <!-- ================= 侧边辅助与分发区 ================= -->
        <div class="lg:col-span-5 flex flex-col gap-6">
            <div class="glass-card rounded-2xl p-6 relative overflow-hidden">
                <div class="absolute -top-10 -right-10 w-32 h-32 bg-[var(--neon-cyan)] rounded-full mix-blend-screen filter blur-[60px] opacity-20 pointer-events-none"></div>
                <h2 class="text-lg font-bold text-white mb-1 tracking-wide">专属地址 My Subs</h2>

                <div class="grid grid-cols-2 gap-4 mt-5">
                    ${subItems.map(item => generateSubCard(item, 'qr_my')).join('')}
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

                    specificRules: window.CURRENT_SPECIFIC_RULES
                }
            };
        }


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

                            let origDisplay = highlight(node.originalName, targetKw, true);
                            let finalDisplay = highlight(node.name, payload.config.replaceWith, false);

                            let diffHtml = '';

                            if (node.originalName !== node.name && !isCustom) {
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
                                <li class="p-3 rounded-xl border \${borderClass} transition-all duration-300 flex items-start gap-3 relative overflow-hidden group">
                                    \${!isCustom ? \`<input type="checkbox" class="node-checkbox form-checkbox h-4 w-4 mt-1.5 text-[var(--neon-cyan)] rounded border-gray-600 bg-black cursor-pointer" value="\${node.identifier}">\` : '<span class="w-4"></span>'}

                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 mb-1.5">
                                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-300 border border-gray-600 uppercase tracking-wider">
                                                \${node.protocol}
                                            </span>

                                            \${isCustom ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-400 border border-pink-500/30">自定义输出</span>' : ''}

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
                window.CURRENT_SPECIFIC_RULES = {};
                showToast('已清空所有专属前后缀规则！');

                if (document.getElementById('previewBtn')) {
                    document.getElementById('previewBtn').click();
                }
            };
        }


        // 全局唯一保存机制
        const btn = document.getElementById('saveBtn');

        if (btn) {
            const setUnsavedStatus = () => {
                document.getElementById('saveStatus').innerHTML =
                    '<span class="text-yellow-400 drop-shadow-[0_0_5px_rgba(250,204,21,0.5)]">⚠️ 尚未保存生效</span>';
            };

            const saveAction = async () => {
                btn.innerHTML = '⏳ 写入底层 KV 中...';
                btn.disabled = true;
                btn.style.filter = "brightness(0.7)";

                try {
                    const payload = getPayload();

                    document.getElementById('content').value = payload.links;
                    document.getElementById('customNodes').value = payload.customNodes;

                    const res = await fetch('/admin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (res.ok) {
                        document.getElementById('saveStatus').innerHTML =
                            '<span class="text-[var(--neon-cyan)]">✓ 保存于 ' +
                            new Date().toLocaleTimeString() +
                            '</span>';

                        showToast('配置数据已安全存入底层 KV！已对外部订阅链接完全生效。');
                    } else {
                        showToast('保存失败，请检查网络', 'error');
                    }

                } catch (e) {
                    showToast('网络异常', 'error');
                } finally {
                    btn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> 保存配置(最终生效>';
                    btn.disabled = false;
                    btn.style.filter = "brightness(1)";
                }
            };

            btn.onclick = saveAction;

            document.querySelectorAll('input, textarea').forEach(el => {
                el.addEventListener('input', setUnsavedStatus);
            });
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
        return [[], ''];
    }

    let newapi = '';
    let 异常订阅 = '';
    let 订阅转换URLs = '';

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
                console.warn(
                    '订阅源抓取失败:',
                    sources[index],
                    response.reason?.message || response.reason
                );
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
        订阅转换URLs
    ];
}
