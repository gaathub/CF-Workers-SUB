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

// ====== 【新增配置：节点二次编辑模块】开始 ======
// 你可以在这里自由修改节点处理规则
const NODE_EDIT_CONFIG = {
    // 1. 协议级过滤
    retainProtocols: [], // 例: ['vless', 'vmess', 'trojan']，留空则不限制
    dropProtocols: [],   // 例: ['ss']，留空则不剔除
    
    // 2. 节点名称正则过滤 (留空则不生效)
    retainNameRegex: '', // 例: '香港|日本' (只保留名称含香港或日本的节点)
    dropNameRegex: '',   // 例: '过期|重置|测试' (剔除含这些字眼的节点)
    
    // 3. 命名与装饰
    globalRename: '',    // 全局重命名，留空则不改名 (例: 'MyNode')
    addPrefix: '',       // 批量添加前缀 (例: '🚀 ')
    addSuffix: '',       // 批量添加后缀
    autoEmoji: true,     // 是否自动根据地区关键词补充 Emoji 旗帜
    
    // 4. 去重与排序
    deepDeduplicate: true,  // 深度去重：基于 (协议+IP+端口+ID) 剔除重复节点
    sortNodes: true,        // 智能排序：信息节点置顶，其余按字母拼音排序
    
    // 5. 异常剔除
    dropInvalidNodes: true  // 剔除无效、无 IP/端口 的坏节点，防止客户端报错
};
// ====== 【新增配置：节点二次编辑模块】结束 ======


export default {
    async fetch(request, env) {
        const userAgentHeader = request.headers.get('User-Agent');
        const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : "null";
        const url = new URL(request.url);
        const token = url.searchParams.get('token');
        
        // 读取环境变量中的账号密码
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

        let UD = Math.floor(((timestamp - Date.now()) / timestamp * total * 1099511627776) / 2);
        total = total * 1099511627776;
        let expire = Math.floor(timestamp / 1000);
        SUBUpdateTime = env.SUBUPTIME || SUBUpdateTime;

        // 【拦截管理后台独立路由】
        if (url.pathname === '/admin' || url.pathname === '/login' || url.pathname === '/logout' || url.pathname === '/') {
            const sessionToken = await MD5MD5(AdminUser + AdminPass + "CF-SUB-SECURE");
            return await handleAdminUI(request, env, sessionToken, AdminUser, AdminPass, guestToken, url, mytoken, FileName, subProtocol, subConverter, subConfig, userAgentHeader);
        }

        // ================= 原有订阅分发逻辑 =================
        if (!([mytoken, fakeToken, 访客订阅].includes(token) || url.pathname == ("/" + mytoken) || url.pathname.includes("/" + mytoken + "?"))) {
            if (TG == 1 && url.pathname !== "/" && url.pathname !== "/favicon.ico") await sendMessage(`#异常访问 ${FileName}`, request.headers.get('CF-Connecting-IP'), `UA: ${userAgent}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`);
            if (env.URL302) return Response.redirect(env.URL302, 302);
            else if (env.URL) return await proxyURL(env.URL, url);
            else return new Response(await nginx(), { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
        } else {
            if (env.KV) {
                await 迁移地址列表(env, 'LINK.txt');
                if (userAgent.includes('mozilla') && !url.search) {
                    return Response.redirect(`${url.origin}/admin`, 302);
                } else {
                    MainData = await env.KV.get('LINK.txt') || MainData;
                }
            } else {
                MainData = env.LINK || MainData;
                if (env.LINKSUB) urls = await ADD(env.LINKSUB);
            }
            let 重新汇总所有链接 = await ADD(MainData + '\n' + urls.join('\n'));
            let 自建节点 = "";
            let 订阅链接 = "";
            for (let x of 重新汇总所有链接) {
                if (x.toLowerCase().startsWith('http')) 订阅链接 += x + '\n';
                else 自建节点 += x + '\n';
            }
            MainData = 自建节点;
            urls = await ADD(订阅链接);
            await sendMessage(`#获取订阅 ${FileName}`, request.headers.get('CF-Connecting-IP'), `UA: ${userAgentHeader}</tg-spoiler>\n域名: ${url.hostname}\n<tg-spoiler>入口: ${url.pathname + url.search}</tg-spoiler>`);
            
            const isSubConverterRequest = request.headers.get('subconverter-request') || request.headers.get('subconverter-version') || userAgent.includes('subconverter');
            let 订阅格式 = 'base64';
            if (!(userAgent.includes('null') || isSubConverterRequest || userAgent.includes('nekobox') || userAgent.includes(('CF-Workers-SUB').toLowerCase()))) {
                if (userAgent.includes('sing-box') || userAgent.includes('singbox') || url.searchParams.has('sb') || url.searchParams.has('singbox')) 订阅格式 = 'singbox';
                else if (userAgent.includes('surge') || url.searchParams.has('surge')) 订阅格式 = 'surge';
                else if (userAgent.includes('quantumult') || url.searchParams.has('quanx')) 订阅格式 = 'quanx';
                else if (userAgent.includes('loon') || url.searchParams.has('loon')) 订阅格式 = 'loon';
                else if (userAgent.includes('clash') || userAgent.includes('meta') || userAgent.includes('mihomo') || url.searchParams.has('clash')) 订阅格式 = 'clash';
            }

            let subConverterUrl;
            let 订阅转换URL = `${url.origin}/${await MD5MD5(fakeToken)}?token=${fakeToken}`;
            let req_data = MainData;
            let 追加UA = 'v2rayn';
            if (url.searchParams.has('b64') || url.searchParams.has('base64')) 订阅格式 = 'base64';
            else if (url.searchParams.has('clash')) 追加UA = 'clash';
            else if (url.searchParams.has('singbox')) 追加UA = 'singbox';
            else if (url.searchParams.has('surge')) 追加UA = 'surge';
            else if (url.searchParams.has('quanx')) 追加UA = 'Quantumult%20X';
            else if (url.searchParams.has('loon')) 追加UA = 'Loon';

            const 订阅链接数组 = [...new Set(urls)].filter(item => item?.trim?.());
            if (订阅链接数组.length > 0) {
                const 请求订阅响应内容 = await getSUB(订阅链接数组, request, 追加UA, userAgentHeader);
                req_data += 请求订阅响应内容[0].join('\n');
                订阅转换URL += "|" + 请求订阅响应内容[1];
                if (订阅格式 == 'base64' && !isSubConverterRequest && 请求订阅响应内容[1].includes('://')) {
                    subConverterUrl = `${subProtocol}://${subConverter}/sub?target=mixed&url=${encodeURIComponent(请求订阅响应内容[1])}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
                    try {
                        const subConverterResponse = await fetch(subConverterUrl, { headers: { 'User-Agent': 'v2rayN/CF-Workers-SUB' } });
                        if (subConverterResponse.ok) {
                            const subConverterContent = await subConverterResponse.text();
                            req_data += '\n' + atob(subConverterContent);
                        }
                    } catch (error) { console.log('订阅转换失败'); }
                }
            }

            if (env.WARP) 订阅转换URL += "|" + (await ADD(env.WARP)).join("|");
            const utf8Encoder = new TextEncoder();
            const encodedData = utf8Encoder.encode(req_data);
            const utf8Decoder = new TextDecoder();
            const text = utf8Decoder.decode(encodedData);
            const uniqueLines = new Set(text.split('\n'));
            let result = [...uniqueLines].join('\n');

            // ====== 【修改点：核心注入】开始 ======
            // 替换原有的 renameDuplicateNodes 为全新强大的 processAndEditSubNodes 二次编辑引擎
            result = processAndEditSubNodes(result, NODE_EDIT_CONFIG);
            // ====== 【修改点：核心注入】结束 ======

            let base64Data;
            try { base64Data = btoa(result); } catch (e) { base64Data = encodeBase64(result); }

            const responseHeaders = {
                "content-type": "text/plain; charset=utf-8",
                "Profile-Update-Interval": `${SUBUpdateTime}`,
                "Profile-web-page-url": request.url.includes('?') ? request.url.split('?')[0] : request.url,
            };

            if (订阅格式 == 'base64' || token == fakeToken) {
                return new Response(base64Data, { headers: responseHeaders });
            } else if (订阅格式 == 'clash') { subConverterUrl = `${subProtocol}://${subConverter}/sub?target=clash&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
            } else if (订阅格式 == 'singbox') { subConverterUrl = `${subProtocol}://${subConverter}/sub?target=singbox&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
            } else if (订阅格式 == 'surge') { subConverterUrl = `${subProtocol}://${subConverter}/sub?target=surge&ver=4&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
            } else if (订阅格式 == 'quanx') { subConverterUrl = `${subProtocol}://${subConverter}/sub?target=quanx&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&udp=true`;
            } else if (订阅格式 == 'loon') { subConverterUrl = `${subProtocol}://${subConverter}/sub?target=loon&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false`;
            }
            try {
                const subConverterResponse = await fetch(subConverterUrl, { headers: { 'User-Agent': userAgentHeader } });
                if (!subConverterResponse.ok) return new Response(base64Data, { headers: responseHeaders });
                let subConverterContent = await subConverterResponse.text();
                if (订阅格式 == 'clash') subConverterContent = await clashFix(subConverterContent);
                if (!userAgent.includes('mozilla')) responseHeaders["Content-Disposition"] = `attachment; filename*=utf-8''${encodeURIComponent(FileName)}`;
                return new Response(subConverterContent, { headers: responseHeaders });
            } catch (error) {
                return new Response(base64Data, { headers: responseHeaders });
            }
        }
    }
};

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

async function handleAdminUI(request, env, sessionToken, AdminUser, AdminPass, guest, url, mytoken, FileName, subProtocol, subConverter, subConfig, userAgentHeader) {
    const currentCookie = getCookie(request, 'admin_session');
    const isAuthenticated = currentCookie === sessionToken;

    if (url.pathname === '/') return Response.redirect(`${url.origin}/admin`, 302);
    
    // 退出逻辑
    if (url.pathname === '/logout') {
        return new Response(null, {
            status: 302,
            headers: { 'Location': '/login', 'Set-Cookie': `admin_session=; HttpOnly; Path=/; Max-Age=0` }
        });
    }

    // 登录验证
    if (request.method === 'POST' && url.pathname === '/login') {
        const formData = await request.formData();
        if (formData.get('username') === AdminUser && formData.get('password') === AdminPass) {
            return new Response(null, {
                status: 302,
                headers: { 'Location': '/admin', 'Set-Cookie': `admin_session=${sessionToken}; HttpOnly; Path=/; Max-Age=864000` } 
            });
        } else {
            return new Response(renderLoginHTML(true), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
        }
    }

    if (!isAuthenticated) {
        return new Response(renderLoginHTML(), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    // --- 已登录后台 ---
    if (request.method === 'POST' && url.pathname === '/admin') {
        if (!env.KV) return new Response("未绑定KV", { status: 400 });
        const content = await request.text();
        await env.KV.put('LINK.txt', content);
        return new Response("保存成功", { status: 200 });
    }

    let content = '';
    let hasKV = !!env.KV;
    if (hasKV) content = await env.KV.get('LINK.txt') || '';
    
    return new Response(renderDashboardHTML(content, guest, url, mytoken, FileName, hasKV, subProtocol, subConverter, subConfig, userAgentHeader), {
        headers: { "Content-Type": "text/html;charset=utf-8" }
    });
}

// ---------------- UI HTML 模板 ----------------
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
    .orb-1 { width: 400px; height: 400px; background: var(--neon-cyan); top: -100px; left: -100px; }
    .orb-2 { width: 500px; height: 500px; background: var(--neon-purple); bottom: -100px; right: -100px; animation-delay: -5s; }
    .orb-3 { width: 300px; height: 300px; background: #ff0055; top: 50%; left: 50%; transform: translate(-50%, -50%); animation-delay: -2s; opacity: 0.2; }
    
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
    .neon-text-cyan { color: var(--neon-cyan); text-shadow: 0 0 8px rgba(0, 243, 255, 0.5); }
    .neon-text-purple { color: #d980ff; text-shadow: 0 0 8px rgba(176, 38, 255, 0.5); }
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
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }
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
            <h1 class="text-3xl font-bold text-white tracking-wider drop-shadow-md">NODE<span class="neon-text-cyan"> HUB</span></h1>
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

function renderDashboardHTML(content, guest, url, mytoken, FileName, hasKV, subProtocol, subConverter, subConfig, userAgentHeader) {
    const subItems = [
        { name: '自适应', path: `/${mytoken}?sub`, badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
        { name: 'Base64', path: `/${mytoken}?b64`, badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
        { name: 'Clash', path: `/${mytoken}?clash`, badge: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
        { name: 'Singbox', path: `/${mytoken}?sb`, badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
        { name: 'Surge', path: `/${mytoken}?surge`, badge: 'bg-teal-500/20 text-teal-300 border-teal-500/30' },
        { name: 'Loon', path: `/${mytoken}?loon`, badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30' }
    ];

    const generateSubCard = (item, prefix) => `
        <div class="glass-card rounded-xl p-4 flex flex-col justify-between hover:border-[var(--neon-cyan)] hover:shadow-[0_0_15px_rgba(0,243,255,0.2)] transition-all duration-300 group cursor-pointer" onclick="copyTo('${url.origin}${item.path}')">
            <div class="flex justify-between items-start mb-3">
                <span class="px-2.5 py-1 text-[10px] font-bold rounded border ${item.badge} tracking-wider uppercase">${item.name}</span>
                <span class="text-gray-500 group-hover:text-[var(--neon-cyan)] transition">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                </span>
            </div>
            <div class="flex flex-col items-center">
                <div class="p-1.5 bg-white/90 rounded-lg shadow-sm group-hover:shadow-[0_0_10px_#fff] transition">
                    <div id="${prefix}_${item.name}"></div>
                </div>
                <p class="text-[9px] text-gray-500 mt-3 truncate w-full text-center group-hover:text-gray-300 font-mono">${url.origin}${item.path}</p>
            </div>
        </div>
    `;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${FileName} - 管理控制台</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
    ${globalCSS}
</head>
<body class="relative min-h-screen pb-10 overflow-x-hidden">
    <div id="toast-container" class="fixed top-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none"></div>

    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>

    <nav class="glass-card sticky top-0 z-50 border-b-0 border-white/10 mb-8 rounded-b-3xl">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full flex items-center justify-center border border-[var(--neon-cyan)] shadow-[0_0_10px_rgba(0,243,255,0.3)] bg-black/30">
                    <svg class="w-5 h-5 text-[var(--neon-cyan)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                </div>
                <h1 class="font-bold text-xl text-white tracking-widest uppercase">${FileName} <span class="text-[10px] font-normal text-[var(--neon-cyan)] border border-[var(--neon-cyan)] px-2 py-0.5 rounded-full ml-2 relative top-[-2px]">PRO</span></h1>
            </div>
            <a href="/logout" class="text-xs font-bold text-gray-400 hover:text-red-400 transition uppercase tracking-wider px-4 py-2 glass-card rounded-full hover:border-red-500/50">登出 LOGOUT</a>
        </div>
    </nav>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        <div class="lg:col-span-7 flex flex-col gap-6">
            <div class="glass-card rounded-2xl p-6 flex flex-col h-[650px]">
                <div class="flex justify-between items-center mb-4">
                    <div>
                        <h2 class="text-lg font-bold text-white tracking-wide">节点编辑器 Node Editor</h2>
                        <p class="text-[11px] text-gray-400 mt-1 font-mono">Input vmess://, trojan:// or sub links</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <span id="saveStatus" class="text-xs text-[var(--neon-cyan)] font-mono mr-2"></span>
                        
                        <button onclick="window.location.reload()" class="flex items-center justify-center h-10 px-5 gap-2 rounded-xl text-sm font-bold text-gray-300 border border-gray-600 hover:text-white hover:border-red-500/50 hover:bg-red-500/10 transition-all bg-black/20 cursor-pointer">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            取消恢复
                        </button>
                        
                        <button id="saveBtn" class="neon-btn flex items-center justify-center h-10 px-5 gap-2 rounded-xl text-sm font-bold text-black cursor-pointer">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
                            手动保存
                        </button>
                    </div>
                </div>
                ${hasKV ? `
                <textarea id="content" class="glass-input flex-1 w-full p-5 font-mono text-[13px] rounded-xl resize-none leading-relaxed overflow-y-auto text-green-400" placeholder="# 在此处粘贴你的节点或订阅链接...\\n# 后台抓取后会自动全局重命名重名的节点！">${content}</textarea>
                ` : '<div class="flex-1 flex items-center justify-center bg-red-900/20 rounded-xl border-2 border-dashed border-red-500/50 text-red-400 font-medium backdrop-blur-sm">未绑定 KV 命名空间，请检查 Cloudflare 设置！</div>'}
            </div>
            
            <div class="glass-card rounded-2xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono text-gray-400">
                <div class="space-y-2">
                    <p><span class="text-gray-500">TG 交流群:</span> <a href="https://t.me/CMLiussss" target="_blank" class="neon-text-cyan hover:underline">@CMLiussss</a></p>
                    <p><span class="text-gray-500">GitHub:</span> <a href="https://github.com/cmliu/CF-Workers-SUB" target="_blank" class="neon-text-purple hover:underline">CF-Workers-SUB</a></p>
                    <p><span class="text-gray-500">User-Agent:</span> <span class="text-gray-300 break-all">${userAgentHeader}</span></p>
                </div>
                <div class="space-y-2 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-4">
                    <p><span class="text-[var(--neon-purple)] font-bold">SUBAPI</span> (订阅转换后端):<br><span class="text-gray-300 break-all">${subProtocol}://${subConverter}</span></p>
                    <p class="mt-2"><span class="text-[var(--neon-purple)] font-bold">SUBCONFIG</span> (转换配置):<br><span class="text-gray-300 break-all">${subConfig}</span></p>
                </div>
            </div>
        </div>

        <div class="lg:col-span-5 flex flex-col gap-6">
            <div class="glass-card rounded-2xl p-6 relative overflow-hidden">
                <div class="absolute -top-10 -right-10 w-32 h-32 bg-[var(--neon-cyan)] rounded-full mix-blend-screen filter blur-[60px] opacity-20 pointer-events-none"></div>
                
                <h2 class="text-lg font-bold text-white mb-1 tracking-wide">专属订阅地址 My Subs</h2>
                <p class="text-[11px] text-gray-400 mb-5 font-mono">Click cards to copy links & view QR</p>
                <div class="grid grid-cols-2 gap-4">
                    ${subItems.map(item => generateSubCard(item, 'qr_my')).join('')}
                </div>
            </div>
            
            <div class="glass-card rounded-2xl p-6">
                <div class="flex justify-between items-center cursor-pointer group" onclick="toggleNotice()">
                    <div>
                        <h2 class="text-md font-bold text-white tracking-wide">访客订阅 Guest Subs</h2>
                        <p class="text-[10px] text-gray-500 mt-1">仅分发节点，无权访问后台</p>
                    </div>
                    <span id="noticeToggle" class="text-gray-500 group-hover:text-[var(--neon-purple)] transition font-mono text-xs border border-white/10 px-3 py-1 rounded-full bg-black/20">展开 ▼</span>
                </div>
                <div id="noticeContent" class="hidden mt-5 border-t border-white/10 pt-5">
                    <div class="mb-5 bg-black/40 p-3 rounded-xl border border-[var(--neon-purple)]/30 flex justify-between items-center">
                        <span class="text-xs text-gray-400">访客 TOKEN:</span>
                        <strong class="neon-text-purple font-mono text-xs tracking-wider">${guest}</strong>
                    </div>
                    <div class="grid grid-cols-2 gap-4 opacity-70 hover:opacity-100 transition duration-500">
                        ${subItems.map(item => generateSubCard({...item, path: `/sub?token=${guest}${item.path.split('?')[1] ? '&'+item.path.split('?')[1] : ''}`}, 'qr_guest')).join('')}
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // --- 高级悬浮 Toast 提示功能 ---
        function showToast(message) {
            const container = document.getElementById('toast-container');
            if(!container) return;
            const toast = document.createElement('div');
            toast.className = 'glass-card px-5 py-3 rounded-xl border border-[var(--neon-cyan)] shadow-[0_0_15px_rgba(0,243,255,0.3)] text-white text-sm font-bold flex items-center gap-3 transform transition-all duration-300 translate-x-[120%] opacity-0';
            toast.innerHTML = \`<span class="text-[var(--neon-cyan)] text-lg leading-none">✓</span> \${message}\`;
            container.appendChild(toast);

            requestAnimationFrame(() => {
                setTimeout(() => { toast.classList.remove('translate-x-[120%]', 'opacity-0'); }, 10);
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
                    try { return beforeHash + '#' + decodeURIComponent(afterHash); } catch (e) { return line; }
                }
                return line;
            }).join('\\n');
        }

        const renderQR = (id, text) => {
            const el = document.getElementById(id);
            if(el) {
                el.innerHTML = '';
                new QRCode(el, { text: text, width: 90, height: 90, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
            }
        };

        window.onload = () => {
            ${subItems.map(item => `renderQR('qr_my_${item.name}', '${url.origin}${item.path}');`).join('\n')}
            ${subItems.map(item => `renderQR('qr_guest_${item.name}', '${url.origin}/sub?token=${guest}${item.path.split('?')[1] ? '&'+item.path.split('?')[1] : ''}');`).join('\n')}
            
            const textarea = document.getElementById('content');
            if (textarea && textarea.value) {
                textarea.value = decodeNodeNameSafe(textarea.value);
            }
        };

        function copyTo(text) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('订阅链接已复制到剪贴板！');
            });
        }

        const btn = document.getElementById('saveBtn');
        const textarea = document.getElementById('content');
        
        if(btn && textarea) {
            const setUnsavedStatus = () => {
                document.getElementById('saveStatus').innerHTML = '<span class="text-yellow-400 drop-shadow-[0_0_5px_rgba(250,204,21,0.5)]">⚠️ 有未保存的修改</span>';
            };

            const saveAction = async () => {
                btn.innerHTML = '<svg class="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 写入中...';
                btn.disabled = true;
                btn.style.filter = "brightness(0.7)";
                
                try {
                    let content = textarea.value.replace(/：/g, ':');
                    content = decodeNodeNameSafe(content);
                    textarea.value = content;
                    
                    const res = await fetch('/admin', { method: 'POST', body: content });
                    if(res.ok) {
                        const time = new Date().toLocaleTimeString();
                        document.getElementById('saveStatus').innerHTML = '<span class="text-[var(--neon-cyan)]">✓ 保存于 '+time+'</span>';
                        showToast('配置数据已安全存入底层 KV！');
                    } else {
                        alert('保存失败，请检查网络');
                    }
                } catch(e) {
                    alert('网络异常');
                } finally {
                    btn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> 手动保存';
                    btn.disabled = false;
                    btn.style.filter = "brightness(1)";
                }
            };
            
            btn.onclick = saveAction;
            
            textarea.addEventListener('paste', () => {
                setTimeout(() => {
                    const decodedText = decodeNodeNameSafe(textarea.value);
                    if (textarea.value !== decodedText) { textarea.value = decodedText; }
                    setUnsavedStatus();
                }, 50); 
            });

            textarea.addEventListener('input', setUnsavedStatus);
        }

        function toggleNotice() {
            const el = document.getElementById('noticeContent');
            const btn = document.getElementById('noticeToggle');
            if (el.classList.contains('hidden')) {
                el.classList.remove('hidden');
                btn.textContent = '收起 ▲';
                btn.classList.add('text-[var(--neon-cyan)]', 'border-[var(--neon-cyan)]');
            } else {
                el.classList.add('hidden');
                btn.textContent = '展开 ▼';
                btn.classList.remove('text-[var(--neon-cyan)]', 'border-[var(--neon-cyan)]');
            }
        }
    </script>
</body>
</html>`;
}

// ================= 底层基础依赖函数与逻辑 =================

// ====== 【新增功能：节点二次编辑模块】开始 ======
/**
 * 节点二次编辑核心逻辑：深度去重、过滤、排序、Emoji补充、自动重命名
 */
function processAndEditSubNodes(content, config) {
    let lines = content.split('\n');
    let parsedNodes = [];
    
    // 地区与 Emoji 对应字典表
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

    // 信息节点特征白名单（遇到这些关键词，不剔除不改名，原样保留）
    const INFO_NODE_REGEX = /流量|剩余|到期|过期|时间|Expire|Traffic|官网|更新|群|公告/i;

    // 1. 初步解析所有节点
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        let node = parseSingleNode(line);
        if (node && node.valid) {
            parsedNodes.push(node);
        } else if (line.includes('://')) {
            // 对于解析失败但像节点的（可能是特殊的订阅信息节点），先标为无效存起来
            parsedNodes.push({ valid: false, raw: line, isInfoNode: INFO_NODE_REGEX.test(line), name: line });
        }
    }

    const uniqueIdentifiers = new Set();
    let finalNodes = [];

    // 2. 执行过滤、去重与重命名逻辑
    for (let node of parsedNodes) {
        // 如果是无效节点
        if (!node.valid) {
            if (node.isInfoNode) {
                finalNodes.push(node); // 保留信息节点
            } else if (!config.dropInvalidNodes) {
                finalNodes.push(node); // 如果未开启剔除无效节点，也保留
            }
            continue; 
        }

        // 白名单保护机制
        if (INFO_NODE_REGEX.test(node.name)) {
            node.isInfoNode = true;
            finalNodes.push(node);
            continue;
        }

        // 协议级过滤
        if (config.retainProtocols.length > 0 && !config.retainProtocols.includes(node.protocol)) continue;
        if (config.dropProtocols.length > 0 && config.dropProtocols.includes(node.protocol)) continue;

        // 名称正则过滤 (保留/剔除)
        if (config.retainNameRegex && !new RegExp(config.retainNameRegex, 'i').test(node.name)) continue;
        if (config.dropNameRegex && new RegExp(config.dropNameRegex, 'i').test(node.name)) continue;

        // 深度去重 (依据: 协议+IP+端口+ID，若相同则认为是同一节点)
        if (config.deepDeduplicate) {
            const identifier = `${node.protocol}:${node.address}:${node.port}:${node.id}`;
            if (uniqueIdentifiers.has(identifier)) continue; 
            uniqueIdentifiers.add(identifier);
        }

        // 全局重命名
        if (config.globalRename) node.name = config.globalRename;

        // 自动补充地区 Emoji (仅在名称本身没有 Emoji 时补充)
        if (config.autoEmoji && !/(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff]|[\u0023-\u0039]\ufe0f?\u20e3|\u3299|\u3297|\u303d|\u3030|\u24c2|\ud83c[\udd70-\udd71]|\ud83c[\udd7e-\udd7f]|\ud83c\udd8e|\ud83c[\udd91-\udd9a]|\ud83c[\udde6-\uddff])/.test(node.name)) {
            for (const item of EMOJI_MAP) {
                if (item.regex.test(node.name) || item.regex.test(node.originalName)) {
                    node.name = `${item.emoji} ${node.name}`;
                    break;
                }
            }
        }

        // 批量前后缀
        if (config.addPrefix) node.name = config.addPrefix + node.name;
        if (config.addSuffix) node.name = node.name + config.addSuffix;

        finalNodes.push(node);
    }

    // 3. 统计重名，自动编号自增 (如: 香港节点 01, 香港节点 02)
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

    // 4. 节点智能排序
    if (config.sortNodes) {
        finalNodes.sort((a, b) => {
            if (a.isInfoNode && !b.isInfoNode) return -1;
            if (!a.isInfoNode && b.isInfoNode) return 1;
            if (!a.valid || !b.valid) return 0;
            return a.name.localeCompare(b.name, 'zh-CN');
        });
    }

    // 5. 重新打包拼接节点
    return finalNodes.map(n => {
        if (!n.valid) return n.raw; // 还原无效但受保护的节点
        return rebuildSingleNode(n);
    }).join('\n');
}

// 辅助工具：单节点解析器
function parseSingleNode(line) {
    try {
        if (line.startsWith('vmess://')) {
            // 补充 Base64 的 padding 以防报错
            let b64Str = line.substring(8).replace(/-/g, '+').replace(/_/g, '/');
            while (b64Str.length % 4 !== 0) b64Str += '=';
            let jsonStr = base64Decode(b64Str);
            let cfg = JSON.parse(jsonStr);
            return {
                valid: !!cfg.add && !!cfg.port, // 简单合法性校验
                protocol: 'vmess',
                name: cfg.ps || 'vmess',
                originalName: cfg.ps || 'vmess',
                address: cfg.add || '',
                port: cfg.port || '',
                id: cfg.id || '',
                config: cfg
            };
        } else {
            let urlObj = new URL(line);
            let name = decodeURIComponent(urlObj.hash.slice(1) || '');
            return {
                valid: !!urlObj.hostname && !!urlObj.port,
                protocol: urlObj.protocol.replace(':', ''),
                name: name,
                originalName: name,
                address: urlObj.hostname,
                port: urlObj.port,
                id: urlObj.username || '',
                urlObj: urlObj
            };
        }
    } catch (e) {
        return { valid: false }; // 解析报错，抛弃或留作信息节点
    }
}

// 辅助工具：单节点重组器
function rebuildSingleNode(node) {
    if (node.protocol === 'vmess') {
        node.config.ps = node.name;
        return 'vmess://' + encodeBase64(JSON.stringify(node.config));
    } else {
        let urlObj = node.urlObj;
        urlObj.hash = '#' + encodeURIComponent(node.name);
        return urlObj.toString();
    }
}
// ====== 【新增功能：节点二次编辑模块】结束 ======


async function ADD(envadd) {
    var addtext = envadd.replace(/[  "'|\r\n]+/g, '\n').replace(/\n+/g, '\n');
    if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
    if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
    return addtext.split('\n');
}

async function nginx() { return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1></body></html>`; }

async function sendMessage(type, ip, add_data = "") {
    if (BotToken !== '' && ChatID !== '') {
        let msg = "";
        const response = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
        if (response.status == 200) {
            const ipInfo = await response.json();
            msg = `${type}\nIP: ${ip}\n国家: ${ipInfo.country}\n<tg-spoiler>城市: ${ipInfo.city}\n组织: ${ipInfo.org}\nASN: ${ipInfo.as}\n${add_data}`;
        } else { msg = `${type}\nIP: ${ip}\n<tg-spoiler>${add_data}`; }
        let url = "https://api.telegram.org/bot" + BotToken + "/sendMessage?chat_id=" + ChatID + "&parse_mode=HTML&text=" + encodeURIComponent(msg);
        return fetch(url, { method: 'get' });
    }
}

function base64Decode(str) {
    const bytes = new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
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
    const firstPass = await crypto.subtle.digest('MD5', encoder.encode(text));
    const firstHex = Array.from(new Uint8Array(firstPass)).map(b => b.toString(16).padStart(2, '0')).join('');
    const secondPass = await crypto.subtle.digest('MD5', encoder.encode(firstHex.slice(7, 27)));
    return Array.from(new Uint8Array(secondPass)).map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

function clashFix(content) {
    if (content.includes('wireguard') && !content.includes('remote-dns-resolve')) {
        let lines = content.includes('\r\n') ? content.split('\r\n') : content.split('\n');
        let result = "";
        for (let line of lines) {
            if (line.includes('type: wireguard')) result += line.replace(/, mtu: 1280, udp: true/g, `, mtu: 1280, remote-dns-resolve: true, udp: true`) + '\n';
            else result += line + '\n';
        }
        content = result;
    }
    return content;
}

async function proxyURL(proxyURL, url) {
    const URLs = await ADD(proxyURL);
    const fullURL = URLs[Math.floor(Math.random() * URLs.length)];
    let parsedURL = new URL(fullURL);
    let URLPathname = parsedURL.pathname;
    if (URLPathname.charAt(URLPathname.length - 1) == '/') URLPathname = URLPathname.slice(0, -1);
    URLPathname += url.pathname;
    let newURL = `${parsedURL.protocol.slice(0, -1) || 'https'}://${parsedURL.hostname}${URLPathname}${parsedURL.search}`;
    let response = await fetch(newURL);
    let newResponse = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
    newResponse.headers.set('X-New-URL', newURL);
    return newResponse;
}

async function getSUB(api, request, 追加UA, userAgentHeader) {
    if (!api || api.length === 0) return [];
    else api = [...new Set(api)]; 
    let newapi = ""; let 订阅转换URLs = ""; let 异常订阅 = "";
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, 2000);
    try {
        const responses = await Promise.allSettled(api.map(apiUrl => getUrl(request, apiUrl, 追加UA, userAgentHeader).then(response => response.ok ? response.text() : Promise.reject(response))));
        const modifiedResponses = responses.map((response, index) => {
            if (response.status === 'rejected') return { status: response.reason?.name === 'AbortError' ? '超时' : '请求失败', value: null, apiUrl: api[index] };
            return { status: response.status, value: response.value, apiUrl: api[index] };
        });
        for (const response of modifiedResponses) {
            if (response.status === 'fulfilled') {
                const content = await response.value || 'null';
                if (content.includes('proxies:')) 订阅转换URLs += "|" + response.apiUrl;
                else if (content.includes('outbounds"') && content.includes('inbounds"')) 订阅转换URLs += "|" + response.apiUrl;
                else if (content.includes('://')) newapi += content + '\n';
                else if (/^[A-Za-z0-9+/=]+$/.test(content.replace(/\s/g, ''))) newapi += base64Decode(content) + '\n';
                else 异常订阅 += `trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#%E5%BC%82%E5%B8%B8%E8%AE%A2%E9%98%85%20${response.apiUrl.split('://')[1].split('/')[0]}\n`;
            }
        }
    } catch (error) { console.error(error); } finally { clearTimeout(timeout); }
    return [await ADD(newapi + 异常订阅), 订阅转换URLs];
}

async function getUrl(request, targetUrl, 追加UA, userAgentHeader) {
    const newHeaders = new Headers(request.headers);
    newHeaders.set("User-Agent", `v2rayN/6.45 cmliu/CF-Workers-SUB ${追加UA}(${userAgentHeader})`);
    const modifiedRequest = new Request(targetUrl, { method: request.method, headers: newHeaders, redirect: "follow", cf: { insecureSkipVerify: true } });
    return fetch(modifiedRequest);
}

async function 迁移地址列表(env, txt = 'ADD.txt') {
    const 旧数据 = await env.KV.get(`/${txt}`);
    const 新数据 = await env.KV.get(txt);
    if (旧数据 && !新数据) {
        await env.KV.put(txt, 旧数据);
        await env.KV.delete(`/${txt}`);
        return true;
    }
    return false;
}
