// ==UserScript==
// @name         Resource Fetcher
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  JS/JSON Editor (.plist mode), Storage Live Patch (.plist + Search), Clear Tab Cookie/Cache, Live Log & Exp Poll Blocker
// @author       godsfx
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY_API = 'tm_m3u8_custom_apis_v3';
    const STORAGE_KEY_POS = 'tm_m3u8_panel_pos_v1';
    const STORAGE_KEY_JS_POS = 'tm_m3u8_js_panel_pos_v1';
    const STORAGE_KEY_JSON_POS = 'tm_m3u8_json_panel_pos_v1';
    const STORAGE_KEY_STORAGE_POS = 'tm_m3u8_storage_panel_pos_v1';
    const STORAGE_KEY_LOG_POS = 'tm_m3u8_log_panel_pos_v1';
    const STORAGE_KEY_TOKENS = 'tm_m3u8_custom_tokens_v3';
    const STORAGE_KEY_BUILDER = 'tm_m3u8_builder_v3';
    const STORAGE_KEY_JS_PATCHES = 'tm_m3u8_js_patches_v1';
    const STORAGE_KEY_JSON_PATCHES = 'tm_m3u8_json_patches_v1';
    const STORAGE_KEY_EXP_FLAGS = 'tm_m3u8_exp_flags_v1';

    const DEFAULT_HINTS = ['/api/app/vid/m3u8', '.m3u8', '.mp4', '.js', '.json'];
    const TOKEN_KEY_HINTS = [
        'token', 'auth', 'jwt', 'bearer', 'session', 'user', 'login', 'sign', 'access', 'vid',
        'secret', 'key', 'sid', 'ticket', 'hash', 'nonce', 'csrf', 'xsrf', 'pass', 'acct', 'account', 'member', 'vip'
    ];
    const MAX_ITEMS = 150;
    const MAX_SCAN_TEXT_LEN = 40000;
    const MAX_LIVE_LOGS = 200;

    const found = new Map();
    const detectedTokens = new Map();
    const capturedTemplates = new Map();
    const testedPairs = new Set();
    const capturedJsonBodies = new Map();
    const liveLogs = [];

    function loadList(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed)
                ? parsed.map(s => String(s).trim()).filter(Boolean)
                : [];
        } catch (_) {
            return [];
        }
    }

    function saveList(key, list) {
        try {
            localStorage.setItem(key, JSON.stringify(list));
        } catch (_) {}
    }

    function loadJsonObj(key) {
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function saveJsonObj(key, obj) {
        try {
            localStorage.setItem(key, JSON.stringify(obj));
        } catch (_) {}
    }

    let customApis = loadList(STORAGE_KEY_API);
    let customTokens = loadList(STORAGE_KEY_TOKENS);
    let builderState = loadJsonObj(STORAGE_KEY_BUILDER);
    let savedJsPatches = loadJsonObj(STORAGE_KEY_JS_PATCHES);
    let savedJsonPatches = loadJsonObj(STORAGE_KEY_JSON_PATCHES);
    let expFlags = loadJsonObj(STORAGE_KEY_EXP_FLAGS);

    let activeFilter = 'ALL';
    let autoMatchEnabled = builderState.autoMatch !== false;
    let openInNewTab = builderState.openTab !== false;
    let stopServerPollingExp = Boolean(expFlags.stopServerPolling);

    // =========================================================================
    // LIVE LOG SYSTEM (JS / JSON / STORAGE / HOOKS)
    // =========================================================================
    let logPanelEl, logListEl, logFilterSelect, logSearchInput;
    let renderLogScheduled = false;

    function pushLiveLog(category, fnName, detail = '') {
        const entry = {
            time: new Date().toLocaleTimeString(),
            category: category || 'JS',
            fnName: fnName || 'anonymous',
            detail: typeof detail === 'string' ? detail : JSON.stringify(detail)
        };
        liveLogs.push(entry);
        if (liveLogs.length > MAX_LIVE_LOGS) {
            liveLogs.shift();
        }
        if (!renderLogScheduled) {
            renderLogScheduled = true;
            setTimeout(() => {
                renderLogScheduled = false;
                renderLiveLogs();
            }, 120);
        }
    }

    function renderLiveLogs() {
        if (!logListEl) return;
        const cat = logFilterSelect ? logFilterSelect.value : 'ALL';
        const q = (logSearchInput ? logSearchInput.value : '').trim().toLowerCase();

        logListEl.innerHTML = '';
        const filtered = liveLogs.slice().reverse().filter(item => {
            if (cat !== 'ALL' && item.category !== cat) return false;
            if (!q) return true;
            return (
                item.fnName.toLowerCase().includes(q) ||
                item.detail.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q)
            );
        });

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'Belum ada log fungsi JS/JSON/Storage yang cocok.';
            empty.style.cssText = 'color:#94a3b8;text-align:center;padding:12px 4px;font-size:11px;';
            logListEl.appendChild(empty);
            return;
        }

        filtered.slice(0, 120).forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = 'background:#020617;border:1px solid #1e293b;border-radius:6px;padding:5px 7px;display:flex;flex-direction:column;gap:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;';

            const top = document.createElement('div');
            top.style.cssText = 'display:flex;justify-content:space-between;gap:6px;';

            const badge = document.createElement('span');
            const colorMap = {
                JS: '#c084fc',
                JSON: '#fbbf24',
                STORAGE: '#38bdf8',
                POLL: '#f87171',
                SYS: '#86efac'
            };
            badge.style.color = colorMap[item.category] || '#e2e8f0';
            badge.style.fontWeight = '700';
            badge.textContent = `[${item.category}] ${item.fnName}`;

            const tm = document.createElement('span');
            tm.style.color = '#64748b';
            tm.textContent = item.time;

            top.appendChild(badge);
            top.appendChild(tm);

            const det = document.createElement('div');
            det.style.cssText = 'color:#cbd5e1;word-break:break-all;white-space:pre-wrap;max-height:54px;overflow:hidden;';
            det.textContent = item.detail;

            row.appendChild(top);
            if (item.detail) row.appendChild(det);
            logListEl.appendChild(row);
        });
    }

    function ensureLogFloatingPanel() {
        if (logPanelEl && document.getElementById('m3u8-live-log-panel')) return;

        logPanelEl = document.createElement('div');
        logPanelEl.id = 'm3u8-live-log-panel';
        logPanelEl.style.cssText = [
            'position:fixed',
            'left:36px',
            'top:140px',
            'z-index:2147483647',
            'width:370px',
            'max-width:calc(100vw - 24px)',
            'max-height:76vh',
            'background:#0f172a',
            'color:#f8fafc',
            'border:1px solid #22c55e',
            'border-radius:10px',
            'box-shadow:0 10px 28px rgba(0,0,0,.65)',
            'font-family:system-ui,-apple-system,sans-serif',
            'font-size:12px',
            'display:none',
            'flex-direction:column',
            'overflow:hidden'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#1e293b;border-bottom:1px solid #334155;font-weight:700;color:#86efac;cursor:move;touch-action:none;user-select:none;';

        const title = document.createElement('span');
        title.textContent = '⠿ Live Function Log (JS / JSON / Storage)';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:#475569;color:#fff;border:none;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px;';
        closeBtn.onclick = () => { logPanelEl.style.display = 'none'; };

        header.appendChild(title);
        header.appendChild(closeBtn);

        const bar = document.createElement('div');
        bar.style.cssText = 'padding:7px 8px;display:flex;gap:5px;background:#111827;border-bottom:1px solid #1e293b;';

        logFilterSelect = document.createElement('select');
        logFilterSelect.style.cssText = 'background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;';
        ['ALL', 'JS', 'JSON', 'STORAGE', 'POLL', 'SYS'].forEach(c => {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            logFilterSelect.appendChild(o);
        });
        logFilterSelect.onchange = renderLiveLogs;

        logSearchInput = document.createElement('input');
        logSearchInput.type = 'text';
        logSearchInput.placeholder = 'Cari fungsi / key / URL...';
        logSearchInput.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';
        logSearchInput.oninput = renderLiveLogs;

        const clrBtn = document.createElement('button');
        clrBtn.type = 'button';
        clrBtn.textContent = 'Clear';
        clrBtn.style.cssText = 'background:#334155;color:#fff;border:none;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:11px;';
        clrBtn.onclick = () => {
            liveLogs.length = 0;
            renderLiveLogs();
        };

        bar.appendChild(logFilterSelect);
        bar.appendChild(logSearchInput);
        bar.appendChild(clrBtn);

        logListEl = document.createElement('div');
        logListEl.style.cssText = 'padding:8px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;-webkit-overflow-scrolling:touch;';

        logPanelEl.appendChild(header);
        logPanelEl.appendChild(bar);
        logPanelEl.appendChild(logListEl);
        document.documentElement.appendChild(logPanelEl);

        applySavedPosition(logPanelEl, STORAGE_KEY_LOG_POS);
        enableDrag(header, logPanelEl, STORAGE_KEY_LOG_POS);
        renderLiveLogs();
    }

    function openLogFloatingPanel() {
        ensureLogFloatingPanel();
        logPanelEl.style.display = 'flex';
        renderLiveLogs();
    }

    // =========================================================================
    // PLIST FORMATTER / PARSER (FOR JSON & STORAGE)
    // =========================================================================
    function escapeXml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function valueToPlistNode(val, indent = 2) {
        const pad = ' '.repeat(indent);
        if (val === null || val === undefined) {
            return `${pad}<string/>`;
        }
        if (typeof val === 'boolean') {
            return `${pad}${val ? '<true/>' : '<false/>'}`;
        }
        if (typeof val === 'number') {
            return Number.isInteger(val)
                ? `${pad}<integer>${val}</integer>`
                : `${pad}<real>${val}</real>`;
        }
        if (typeof val === 'string') {
            return `${pad}<string>${escapeXml(val)}</string>`;
        }
        if (Array.isArray(val)) {
            if (val.length === 0) return `${pad}<array/>`;
            const inner = val.map(v => valueToPlistNode(v, indent + 2)).join('\n');
            return `${pad}<array>\n${inner}\n${pad}</array>`;
        }
        if (typeof val === 'object') {
            const entries = Object.entries(val);
            if (entries.length === 0) return `${pad}<dict/>`;
            const inner = entries.map(([k, v]) => {
                return `${pad}  <key>${escapeXml(k)}</key>\n${valueToPlistNode(v, indent + 2)}`;
            }).join('\n');
            return `${pad}<dict>\n${inner}\n${pad}</dict>`;
        }
        return `${pad}<string>${escapeXml(String(val))}</string>`;
    }

    function jsonToPlistXml(rawJsonStr) {
        const parsed = JSON.parse(rawJsonStr);
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
            '<plist version="1.0">',
            valueToPlistNode(parsed, 2),
            '</plist>'
        ].join('\n');
    }

    function parsePlistNode(el) {
        if (!el || !el.nodeType) return null;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'plist') {
            const firstChild = [...el.children].find(c => c.tagName && c.tagName.toLowerCase() !== 'key');
            return firstChild ? parsePlistNode(firstChild) : {};
        }
        if (tag === 'dict') {
            const obj = {};
            const children = [...el.children];
            let i = 0;
            while (i < children.length) {
                const cTag = children[i].tagName.toLowerCase();
                if (cTag === 'key' && i + 1 < children.length) {
                    const k = children[i].textContent || '';
                    obj[k] = parsePlistNode(children[i + 1]);
                    i += 2;
                } else {
                    i += 1;
                }
            }
            return obj;
        }
        if (tag === 'array') {
            return [...el.children].map(child => parsePlistNode(child));
        }
        if (tag === 'string') return el.textContent || '';
        if (tag === 'integer' || tag === 'real') {
            const n = Number(el.textContent);
            return Number.isNaN(n) ? 0 : n;
        }
        if (tag === 'true') return true;
        if (tag === 'false') return false;
        if (tag === 'null') return null;
        return el.textContent || '';
    }

    function plistXmlToJsonObj(plistStr) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(plistStr, 'text/xml');
        const parseErr = doc.querySelector('parsererror');
        if (parseErr) {
            throw new Error(parseErr.textContent || 'Invalid Plist XML');
        }
        const plistRoot = doc.querySelector('plist') || doc.documentElement;
        return parsePlistNode(plistRoot);
    }

    // JS .plist-style structured outline (fungsi, variabel, event, hook dalam format plist)
    function jsCodeToPlistOutline(jsCode) {
        const lines = (jsCode || '').split('\n');
        const functions = [];
        const timers = [];
        const hooks = [];
        const assignments = [];

        const fnDeclRe = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/;
        const arrowFnRe = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/;
        const methodFnRe = /([A-Za-z0-9_$]+)\s*:\s*(?:async\s+)?function\s*\(([^)]*)\)/;

        lines.forEach((line, idx) => {
            const ln = idx + 1;
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//')) return;

            let m = trimmed.match(fnDeclRe) || trimmed.match(arrowFnRe) || trimmed.match(methodFnRe);
            if (m) {
                functions.push({
                    line: ln,
                    name: m[1],
                    params: m[2].trim(),
                    preview: trimmed.slice(0, 90)
                });
            }
            if (/setInterval|setTimeout|requestAnimationFrame/.test(trimmed)) {
                timers.push({
                    line: ln,
                    expr: trimmed.slice(0, 100)
                });
            }
            if (/fetch\s*\(|XMLHttpRequest|addEventListener|localStorage|sessionStorage|document\.cookie/.test(trimmed)) {
                hooks.push({
                    line: ln,
                    expr: trimmed.slice(0, 100)
                });
            }
            const assignMatch = trimmed.match(/^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(.+?);?$/);
            if (assignMatch && !assignMatch[2].includes('=>') && !assignMatch[2].startsWith('function')) {
                assignments.push({
                    line: ln,
                    key: assignMatch[1],
                    value: assignMatch[2].slice(0, 80)
                });
            }
        });

        return valueToPlistNode({
            meta: {
                totalLines: lines.length,
                functionsCount: functions.length,
                timersCount: timers.length,
                hooksCount: hooks.length
            },
            functions: functions.slice(0, 80),
            timersAndPolling: timers.slice(0, 40),
            networkAndStorage: hooks.slice(0, 50),
            variables: assignments.slice(0, 50)
        }, 2);
    }

    function wrapJsInPlistDocument(jsCode) {
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
            '<plist version="1.0">',
            '<dict>',
            '  <key>scriptSource</key>',
            `  <string>${escapeXml(jsCode || '')}</string>`,
            '  <key>structureIndex</key>',
            jsCodeToPlistOutline(jsCode || ''),
            '</dict>',
            '</plist>'
        ].join('\n');
    }

    function extractJsFromPlistOrRaw(text) {
        const trimmed = (text || '').trim();
        if (trimmed.startsWith('<?xml') || trimmed.includes('<plist')) {
            const obj = plistXmlToJsonObj(trimmed);
            if (obj && typeof obj === 'object' && typeof obj.scriptSource === 'string') {
                return obj.scriptSource;
            }
        }
        return text;
    }

    // =========================================================================
    // CLEAR COOKIE & CACHE UNTUK TAB AKTIF
    // =========================================================================
    async function clearActiveTabCookiesAndCache() {
        const summary = [];
        try {
            const cookies = document.cookie ? document.cookie.split(';') : [];
            let clearedCookies = 0;
            const hostParts = location.hostname.split('.');
            const domains = [''];
            for (let i = 0; i < hostParts.length - 1; i++) {
                domains.push(hostParts.slice(i).join('.'));
                domains.push('.' + hostParts.slice(i).join('.'));
            }
            const paths = ['/', location.pathname.replace(/[^/]*$/, '') || '/'];

            for (const rawC of cookies) {
                const eqIdx = rawC.indexOf('=');
                const name = (eqIdx >= 0 ? rawC.slice(0, eqIdx) : rawC).trim();
                if (!name) continue;
                clearedCookies++;
                for (const p of paths) {
                    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}`;
                    for (const d of domains) {
                        if (d) {
                            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}; domain=${d}`;
                        }
                    }
                }
            }
            summary.push(`${clearedCookies} cookie`);
        } catch (e) {
            summary.push(`cookie err(${e.message})`);
        }

        try {
            if (window.caches && typeof window.caches.keys === 'function') {
                const names = await window.caches.keys();
                await Promise.all(names.map(n => window.caches.delete(n)));
                summary.push(`${names.length} CacheStorage`);
            }
        } catch (e) {
            summary.push(`cache err(${e.message})`);
        }

        try {
            if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
                summary.push(`${regs.length} SW`);
            }
        } catch (_) {}

        try {
            if (window.performance && typeof window.performance.clearResourceTimings === 'function') {
                window.performance.clearResourceTimings();
            }
        } catch (_) {}

        const msg = `Tab dibersihkan: ${summary.join(', ')}.`;
        setQuickStatus(msg);
        pushLiveLog('SYS', 'clearActiveTabCookiesAndCache', msg);
    }

    // =========================================================================
    // EXPERIMENTAL TOGGLE: STOP SERVER POLLING (.JS TIMERS / XHR / FETCH POLLS)
    // =========================================================================
    const activeIntervals = new Set();
    const activeTimeouts = new Set();

    function applyServerPollingToggle(enabled) {
        stopServerPollingExp = Boolean(enabled);
        expFlags.stopServerPolling = stopServerPollingExp;
        saveJsonObj(STORAGE_KEY_EXP_FLAGS, expFlags);

        if (stopServerPollingExp) {
            for (const id of activeIntervals) {
                try { origClearInterval(id); } catch (_) {}
            }
            for (const id of activeTimeouts) {
                try { origClearTimeout(id); } catch (_) {}
            }
        }

        const stateMsg = stopServerPollingExp
            ? 'EXP ON: Pengecekan berkala dari server (.js interval/timeout/poll) DIHENTIKAN.'
            : 'EXP OFF: Pengecekan berkala dari server berjalan normal.';
        setQuickStatus(stateMsg);
        pushLiveLog('POLL', 'toggleStopServerPolling', stateMsg);
    }

    const origSetInterval = window.setInterval;
    const origClearInterval = window.clearInterval;
    const origSetTimeout = window.setTimeout;
    const origClearTimeout = window.clearTimeout;

    function isLikelyServerPollingCall(handler) {
        if (!stopServerPollingExp) return false;
        const src = typeof handler === 'function' ? handler.toString() : String(handler || '');
        if (/fetch\s*\(|XMLHttpRequest|\.send\s*\(|ajax|poll|heartbeat|ping|check|sync|refresh/i.test(src)) {
            return true;
        }
        try {
            const stack = (new Error().stack || '');
            if (stack.includes('tm-live-patch') || stack.includes('m3u8-auto-detector')) {
                return false;
            }
        } catch (_) {}
        return true;
    }

    window.setInterval = function (handler, delay, ...args) {
        if (stopServerPollingExp && isLikelyServerPollingCall(handler)) {
            pushLiveLog('POLL', 'blocked.setInterval', `delay=${delay}ms`);
            return -1;
        }
        const id = origSetInterval.call(window, handler, delay, ...args);
        activeIntervals.add(id);
        return id;
    };

    window.clearInterval = function (id) {
        activeIntervals.delete(id);
        return origClearInterval.call(window, id);
    };

    window.setTimeout = function (handler, delay, ...args) {
        if (stopServerPollingExp && Number(delay) >= 1500 && isLikelyServerPollingCall(handler)) {
            pushLiveLog('POLL', 'blocked.setTimeout', `delay=${delay}ms`);
            return -1;
        }
        const id = origSetTimeout.call(window, handler, delay, ...args);
        activeTimeouts.add(id);
        return id;
    };

    window.clearTimeout = function (id) {
        activeTimeouts.delete(id);
        return origClearTimeout.call(window, id);
    };

    // =========================================================================
    // CORE HELPERS & STORAGE LIVE PATCHING
    // =========================================================================
    function getAllHints() {
        return [...DEFAULT_HINTS, ...customApis, ...capturedTemplates.keys()];
    }

    function getActiveTokens() {
        return [...new Set([...customTokens, ...detectedTokens.keys()])];
    }

    function isApiLikeUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 2048) return false;
        try {
            const u = new URL(rawUrl, location.href);
            const pathLower = u.pathname.toLowerCase();
            if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)(\?|$)/i.test(pathLower)) return false;
            return (
                pathLower.includes('/api/') ||
                pathLower.includes('m3u8') ||
                pathLower.includes('vid') ||
                pathLower.includes('stream') ||
                pathLower.includes('play') ||
                customApis.some(c => rawUrl.toLowerCase().includes(c.toLowerCase()))
            );
        } catch (_) {
            return false;
        }
    }

    function captureRequestTemplate(rawUrl, method = 'GET', headers = {}, body = null) {
        if (!isApiLikeUrl(rawUrl)) return;
        try {
            const u = new URL(rawUrl, location.href);
            const cleanBase = `${u.origin}${u.pathname}`;
            const existing = capturedTemplates.get(cleanBase);

            const currentParamCount = [...u.searchParams.keys()].length;
            let prevParamCount = -1;
            if (existing) {
                try {
                    prevParamCount = [...new URL(existing.fullUrl).searchParams.keys()].length;
                } catch (_) {}
            }

            if (!existing || currentParamCount >= prevParamCount) {
                capturedTemplates.set(cleanBase, {
                    fullUrl: u.toString(),
                    method: (method || 'GET').toUpperCase(),
                    headers: headers && typeof headers === 'object' ? { ...headers } : {},
                    body: typeof body === 'string' ? body : null,
                    time: new Date().toLocaleTimeString()
                });
                scheduleUiMetaRefresh();
            }
        } catch (_) {}
    }

    function tryStoreJsonResponse(url, text, source = 'fetch') {
        if (!url || typeof text !== 'string') return false;
        const trimmed = text.trim();
        if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return false;
        try {
            JSON.parse(trimmed);
            capturedJsonBodies.set(url, {
                url,
                rawText: trimmed,
                time: new Date().toLocaleTimeString(),
                source
            });
            pushLiveLog('JSON', `captureJsonResponse (${source})`, `${url} (${trimmed.length} chars)`);
            scheduleUiMetaRefresh();
            return true;
        } catch (_) {
            return false;
        }
    }

    function findMatchingJsonOverride(url) {
        if (!url) return null;
        for (const entry of Object.values(savedJsonPatches)) {
            if (!entry || !entry.enabled || !entry.code) continue;
            const pat = (entry.targetPattern || '').trim();
            if (!pat) continue;
            if (url === pat || url.includes(pat)) {
                return entry;
            }
        }
        return null;
    }

    function isLikelyTokenValue(val) {
        if (typeof val !== 'string') return false;
        const s = val.trim().replace(/^["']|["']$/g, '');
        if (s.length < 8 || s.length > 1024) return false;
        if (/^https?:\/\//i.test(s) || /\s/.test(s)) return false;
        if (/^[0-9a-f]{16,256}$/i.test(s)) return true;
        return /^[A-Za-z0-9._~+/=-]{8,}$/.test(s) && /[A-Za-z0-9]/.test(s);
    }

    function addDetectedToken(tok, source, note = '') {
        if (typeof tok !== 'string') return false;
        const clean = tok.replace(/^Bearer\s+/i, '').trim().replace(/^["']|["']$/g, '');
        if (clean.length < 10 || clean.length > 512) return false;
        if (!detectedTokens.has(clean)) {
            detectedTokens.set(clean, {
                token: clean,
                source,
                note,
                time: new Date().toLocaleTimeString()
            });
            return true;
        }
        return false;
    }

    function extractTokensFromText(text, source = 'auto', note = '') {
        if (typeof text !== 'string' || !text) return false;
        const sample = text.length > MAX_SCAN_TEXT_LEN ? text.slice(0, MAX_SCAN_TEXT_LEN) : text;
        let added = false;

        if (sample.includes('eyJ')) {
            const jwtMatches = sample.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) || [];
            jwtMatches.forEach(m => {
                if (addDetectedToken(m, source, note || 'JWT')) added = true;
            });
        }

        const paramRegex = /(?:^|[?&#\"'\s,;:{[])(?:token|access_token|auth_token|vid_token|api_token|user_token|refresh_token|authorization|session_id|sid|auth_key|secret_key|sign|signature|ticket)[=:\"'\s]+([A-Za-z0-9._~+/=-]{8,1024})/gi;
        let match;
        while ((match = paramRegex.exec(sample)) !== null) {
            if (match[1]) {
                const candidate = match[1].replace(/["',;)}\]]+$/, '');
                if (addDetectedToken(candidate, source, note || 'Param')) added = true;
            }
        }

        if (sample.includes('Bearer')) {
            const bearerRegex = /Bearer\s+([A-Za-z0-9._~+/=-]{10,512})/gi;
            while ((match = bearerRegex.exec(sample)) !== null) {
                if (match[1]) {
                    if (addDetectedToken(match[1], source, note || 'Bearer')) added = true;
                }
            }
        }

        return added;
    }

    function extractTokensFromStorageEntry(storageName, key, rawVal) {
        if (!key || key.startsWith('tm_m3u8_') || typeof rawVal !== 'string' || !rawVal) return false;
        if (rawVal.length > 25000) return false;

        let added = false;
        const lowerKey = key.toLowerCase();
        const keyLooksAuth = TOKEN_KEY_HINTS.some(h => lowerKey.includes(h));

        try {
            const parsed = JSON.parse(rawVal);
            const walk = (node, path, depth = 0) => {
                if (!node || depth > 5) return;
                if (typeof node === 'string') {
                    const pLower = path.toLowerCase();
                    const pathAuth = TOKEN_KEY_HINTS.some(h => pLower.includes(h));
                    if (extractTokensFromText(node, storageName, `${key}${path ? '.' + path : ''}`)) {
                        added = true;
                    } else if ((keyLooksAuth || pathAuth) && isLikelyTokenValue(node)) {
                        if (addDetectedToken(node, storageName, `${key}${path ? '.' + path : ''}`)) added = true;
                    }
                } else if (Array.isArray(node)) {
                    node.slice(0, 30).forEach((v, idx) => walk(v, `${path}[${idx}]`, depth + 1));
                } else if (typeof node === 'object') {
                    Object.entries(node).slice(0, 40).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k, depth + 1));
                }
            };
            walk(parsed, '', 0);
        } catch (_) {
            if (extractTokensFromText(rawVal, storageName, key)) {
                added = true;
            } else if (keyLooksAuth && isLikelyTokenValue(rawVal.trim())) {
                if (addDetectedToken(rawVal.trim(), storageName, key)) added = true;
            }
        }

        return added;
    }

    function readStorageArea(storageObj, label) {
        let added = false;
        try {
            for (let i = 0; i < storageObj.length; i++) {
                const k = storageObj.key(i);
                if (!k || k.startsWith('tm_m3u8_')) continue;
                const v = storageObj.getItem(k);
                if (extractTokensFromStorageEntry(label, k, v)) added = true;
            }
        } catch (_) {}
        return added;
    }

    function onNewTokenDiscovered() {
        scheduleUiMetaRefresh();
        if (autoMatchEnabled) {
            scheduleAutoMatch();
        }
    }

    function scanLocalAndSessionStorage() {
        let added = false;
        if (readStorageArea(window.localStorage, 'localStorage')) added = true;
        if (readStorageArea(window.sessionStorage, 'sessionStorage')) added = true;
        if (added) onNewTokenDiscovered();
        return added;
    }

    const origLocalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const origSessionSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);

    function hookStorageSetItem(storageObj, origFn, label) {
        if (!storageObj || typeof origFn !== 'function') return;
        storageObj.setItem = function (key, value) {
            const kStr = String(key);
            const vStr = String(value);
            const result = origFn(kStr, vStr);
            if (!kStr.startsWith('tm_m3u8_')) {
                pushLiveLog('STORAGE', `${label}.setItem`, `${kStr} = ${vStr.slice(0, 120)}`);
            }
            try {
                if (extractTokensFromStorageEntry(label, kStr, vStr)) {
                    onNewTokenDiscovered();
                }
            } catch (_) {}
            scheduleUiMetaRefresh();
            return result;
        };
    }

    hookStorageSetItem(window.localStorage, origLocalSetItem, 'localStorage');
    hookStorageSetItem(window.sessionStorage, origSessionSetItem, 'sessionStorage');

    window.addEventListener('storage', (e) => {
        const area = e.storageArea === window.sessionStorage ? 'sessionStorage' : 'localStorage';
        if (e.key && !e.key.startsWith('tm_m3u8_')) {
            pushLiveLog('STORAGE', `window.storage (${area})`, `key="${e.key}"`);
        }
        if (e.key && e.newValue && extractTokensFromStorageEntry(area, e.key, e.newValue)) {
            onNewTokenDiscovered();
        }
        scheduleUiMetaRefresh();
    });

    function scanWindowGlobalsForTokens() {
        let added = false;
        const propHints = ['token', 'auth', 'user', 'session', 'jwt', 'config', 'state', 'app', 'nuxt', 'next', 'env'];
        try {
            const keys = Object.getOwnPropertyNames(window);
            for (let i = 0; i < Math.min(keys.length, 250); i++) {
                const k = keys[i];
                if (!k || k.startsWith('tm_m3u8_') || k.startsWith('webkit') || k.startsWith('chrome')) continue;
                const kl = k.toLowerCase();
                if (!propHints.some(h => kl.includes(h))) continue;
                let val;
                try { val = window[k]; } catch (_) { continue; }
                if (!val) continue;
                if (typeof val === 'string') {
                    if (extractTokensFromText(val, 'window', k) || (TOKEN_KEY_HINTS.some(h => kl.includes(h)) && isLikelyTokenValue(val))) {
                        if (addDetectedToken(val, 'window', k)) added = true;
                    }
                } else if (typeof val === 'object') {
                    try {
                        const serialized = JSON.stringify(val);
                        if (serialized && serialized.length <= 25000 && extractTokensFromText(serialized, 'window-obj', k)) {
                            added = true;
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}
        return added;
    }

    function scanMetaAndDomForTokens() {
        let added = false;
        try {
            document.querySelectorAll('meta[name], meta[property]').forEach(m => {
                const mName = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
                const content = m.getAttribute('content') || '';
                if (!content) return;
                if (extractTokensFromText(content, 'meta', mName) || (TOKEN_KEY_HINTS.some(h => mName.includes(h)) && isLikelyTokenValue(content))) {
                    if (addDetectedToken(content, 'meta', mName)) added = true;
                }
            });
        } catch (_) {}
        return added;
    }

    function scanIndexedDbForTokens() {
        try {
            if (!window.indexedDB || typeof window.indexedDB.databases !== 'function') return;
            window.indexedDB.databases().then(dbs => {
                if (!Array.isArray(dbs)) return;
                dbs.slice(0, 8).forEach(dbInfo => {
                    if (!dbInfo || !dbInfo.name) return;
                    const req = window.indexedDB.open(dbInfo.name);
                    req.onsuccess = () => {
                        try {
                            const db = req.result;
                            const storeNames = [...db.objectStoreNames].slice(0, 8);
                            if (!storeNames.length) { db.close(); return; }
                            const tx = db.transaction(storeNames, 'readonly');
                            storeNames.forEach(sn => {
                                const getAllReq = tx.objectStore(sn).getAll();
                                getAllReq.onsuccess = () => {
                                    try {
                                        const raw = JSON.stringify(getAllReq.result || []);
                                        if (raw && raw.length <= 35000 && extractTokensFromText(raw, 'indexedDB', `${dbInfo.name}.${sn}`)) {
                                            onNewTokenDiscovered();
                                        }
                                    } catch (_) {}
                                };
                            });
                            tx.oncomplete = () => db.close();
                        } catch (_) {}
                    };
                });
            }).catch(() => {});
        } catch (_) {}
    }

    function scanEnvironmentForTokens() {
        let added = false;
        if (scanLocalAndSessionStorage()) added = true;
        if (scanWindowGlobalsForTokens()) added = true;
        if (scanMetaAndDomForTokens()) added = true;
        scanIndexedDbForTokens();
        try {
            if (extractTokensFromText(location.href, 'url', 'Page URL')) added = true;
        } catch (_) {}
        try {
            if (document.cookie && extractTokensFromText(document.cookie, 'cookie', 'Cookie')) added = true;
        } catch (_) {}
        if (added) onNewTokenDiscovered();
    }

    function buildPreservedUrl(baseOrFullUrl, tokenVal, extraQueryStr = '') {
        const raw = (baseOrFullUrl || '').trim();
        if (!raw) return '';

        if (raw.includes('{token}')) {
            return raw.replace(/\{token\}/g, encodeURIComponent(tokenVal || ''));
        }

        try {
            const full = new URL(raw, location.origin);
            if (extraQueryStr && extraQueryStr.trim()) {
                const cleaned = extraQueryStr.trim().replace(/^[?&]+/, '');
                const extraParams = new URLSearchParams(cleaned);
                for (const [k, v] of extraParams.entries()) {
                    full.searchParams.set(k, v);
                }
            }
            if (tokenVal) {
                const tokenKeys = ['token', 'access_token', 'auth_token', 'vid_token', 'api_token'];
                const existingKey = tokenKeys.find(k => full.searchParams.has(k));
                full.searchParams.set(existingKey || 'token', tokenVal);
            }
            return full.toString();
        } catch (_) {
            if (!tokenVal) return raw;
            if (/([?&])(token|access_token|auth_token|vid_token)=[^&]*/i.test(raw)) {
                return raw.replace(/([?&])(token|access_token|auth_token|vid_token)=[^&]*/i, `$1$2=${encodeURIComponent(tokenVal)}`);
            }
            const sep = raw.includes('?') ? '&' : '?';
            return `${raw}${sep}token=${encodeURIComponent(tokenVal)}`;
        }
    }

    function isApiErrorJson(text) {
        try {
            const obj = JSON.parse(text);
            if (obj && typeof obj === 'object') {
                const msg = String(obj.msg || obj.message || '').toLowerCase();
                if ([4001, 5009, 401, 403, 500].includes(Number(obj.code))) return true;
                if (
                    msg.includes('invalid token') ||
                    msg.includes('parameters error') ||
                    msg.includes('parameter error') ||
                    msg.includes('unauthorized') ||
                    msg.includes('expired')
                ) {
                    return true;
                }
            }
        } catch (_) {}
        return false;
    }

    let autoMatchTimer = null;
    function scheduleAutoMatch() {
        if (autoMatchTimer) clearTimeout(autoMatchTimer);
        autoMatchTimer = setTimeout(() => {
            runAutoMatchApisAndTokens(false);
        }, 600);
    }

    async function runAutoMatchApisAndTokens(forceReset = false) {
        if (forceReset) testedPairs.clear();
        const tokens = getActiveTokens();
        if (!tokens.length || !origFetch) return;

        const candidateUrls = [];
        for (const tpl of capturedTemplates.values()) {
            candidateUrls.push(tpl.fullUrl);
        }
        for (const c of customApis) {
            if (/^https?:\/\//i.test(c)) candidateUrls.push(c);
            else if (c.startsWith('/')) candidateUrls.push(`${location.origin}${c}`);
        }
        if (builderUrlInput && builderUrlInput.value.trim()) {
            candidateUrls.unshift(builderUrlInput.value.trim());
        }

        const uniqueCandidates = [...new Set(candidateUrls)];
        const extraParams = (builderExtraInput && builderExtraInput.value.trim()) || builderState.extra || '';

        for (const rawTplUrl of uniqueCandidates.slice(0, 6)) {
            for (const tok of tokens.slice(0, 6)) {
                const testUrl = buildPreservedUrl(rawTplUrl, tok, extraParams);
                if (!testUrl || testedPairs.has(testUrl)) continue;
                testedPairs.add(testUrl);

                try {
                    const uObj = new URL(testUrl);
                    const tplMeta = capturedTemplates.get(`${uObj.origin}${uObj.pathname}`);
                    const reqHeaders = {
                        ...(tplMeta?.headers || {}),
                        'Authorization': `Bearer ${tok}`,
                        'token': tok
                    };

                    const res = await origFetch.call(window, testUrl, {
                        method: tplMeta?.method || 'GET',
                        headers: reqHeaders,
                        body: tplMeta?.method === 'POST' ? tplMeta.body : undefined
                    });
                    if (!res.ok) continue;

                    const bodyText = await res.text();
                    if (!bodyText || isApiErrorJson(bodyText)) continue;

                    tryStoreJsonResponse(testUrl, bodyText, 'auto-match');
                    if (builderUrlInput) builderUrlInput.value = rawTplUrl;
                    if (builderTokSelect) builderTokSelect.value = tok;
                    updateBuilderPreview();

                    recordItem(testUrl, 'VALID-API', `OK (${res.status})`);
                    const extracted = extractUrlsFromText(bodyText, testUrl);
                    extracted.forEach(u => recordItem(u, 'VALID-M3U8', 'Matched'));
                    return;
                } catch (_) {}
            }
        }
    }

    function detectFormat(url, source = '') {
        try {
            const u = new URL(url, location.href);
            const path = u.pathname.toLowerCase();
            const match = path.match(/\.([a-z0-9]{2,5})$/i);
            if (match) return `.${match[1].toLowerCase()}`;
            if (url.toLowerCase().includes('.m3u8')) return '.m3u8';
            if (url.toLowerCase().includes('.mp4')) return '.mp4';
            if (url.toLowerCase().includes('.js')) return '.js';
            if (url.toLowerCase().includes('.json') || capturedJsonBodies.has(url)) return '.json';
            if (source.startsWith('fetch') || source.startsWith('xhr') || source.includes('API') || path.includes('/api/')) {
                return 'API';
            }
        } catch (_) {}
        return 'OTHER';
    }

    function looksInteresting(str) {
        if (typeof str !== 'string' || !str) return false;
        const lower = str.toLowerCase();
        if (/\.(m3u8|mp4|webm|mpd|ts|js|json|vtt|srt)(\?|#|$)/i.test(lower)) return true;
        if (getAllHints().some(h => lower.includes(h.toLowerCase()))) return true;
        return getActiveTokens().some(t => t.length >= 8 && str.includes(t));
    }

    function extractM3u8CandidatesFromText(text, baseUrl = location.href) {
        const results = new Set();
        if (typeof text !== 'string' || !text || !text.includes('.m3u8')) return results;

        const sample = text.length > MAX_SCAN_TEXT_LEN ? text.slice(0, MAX_SCAN_TEXT_LEN) : text;
        const fullUrlRegex = /https?:\/\/[^\s"'<>\\)\]]+\.m3u8(?:[?#][^\s"'<>\\)\]]*)?/gi;
        const relUrlRegex = /(?:^|[\s"'=(:])(\/[^\s"'<>\\)\]]+\.m3u8(?:[?#][^\s"'<>\\)\]]*)?)/gi;

        for (const m of (sample.match(fullUrlRegex) || [])) {
            try {
                results.add(new URL(m, baseUrl).href);
            } catch (_) {
                results.add(m);
            }
        }

        let relMatch;
        while ((relMatch = relUrlRegex.exec(sample)) !== null) {
            if (relMatch[1]) {
                try {
                    results.add(new URL(relMatch[1], baseUrl).href);
                } catch (_) {
                    results.add(relMatch[1]);
                }
            }
        }

        return results;
    }

    function extractUrlsFromText(text, baseUrl = location.href) {
        const urls = new Set();
        if (typeof text !== 'string' || !text) return urls;
        const sample = text.length > MAX_SCAN_TEXT_LEN ? text.slice(0, MAX_SCAN_TEXT_LEN) : text;

        if (extractTokensFromText(sample, 'body', 'Response body')) {
            onNewTokenDiscovered();
        }

        try {
            const data = JSON.parse(sample);
            const scanObj = (obj, depth = 0) => {
                if (!obj || depth > 6) return;
                if (typeof obj === 'string') {
                    if (/\.m3u8(\?|#|$)/i.test(obj) || /\.(mp4|webm|mpd|js|json)(\?|#|$)/i.test(obj) || /^https?:\/\//i.test(obj)) {
                        try {
                            urls.add(new URL(obj, baseUrl).href);
                        } catch (_) {
                            urls.add(obj);
                        }
                    }
                } else if (Array.isArray(obj)) {
                    obj.slice(0, 40).forEach(v => scanObj(v, depth + 1));
                } else if (typeof obj === 'object') {
                    Object.values(obj).slice(0, 40).forEach(v => scanObj(v, depth + 1));
                }
            };
            scanObj(data, 0);
        } catch (_) {}

        extractM3u8CandidatesFromText(sample, baseUrl).forEach(u => urls.add(u));

        const regex = /https?:\/\/[^\s"'<>\\)\]]+\.(?:mp4|webm|mpd|js|json|ts|vtt)(?:[?#][^\s"'<>\\)\]]*)?/gi;
        const matches = sample.match(regex) || [];
        for (const m of matches) {
            try {
                urls.add(new URL(m, baseUrl).href);
            } catch (_) {
                urls.add(m);
            }
        }

        return urls;
    }

    let renderScheduled = false;
    function scheduleRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        setTimeout(() => {
            renderScheduled = false;
            renderFilterBar();
            renderList();
        }, 180);
    }

    let metaRefreshScheduled = false;
    function scheduleUiMetaRefresh() {
        if (metaRefreshScheduled) return;
        metaRefreshScheduled = true;
        setTimeout(() => {
            metaRefreshScheduled = false;
            renderTokenList();
            syncBuilderSelectors();
            renderApiTags();
            syncTemplateSelector();
            syncJsSourceSelector();
            syncJsonSourceSelector();
            renderStorageEditorList();
        }, 250);
    }

    function recordItem(url, source, note = '') {
        if (!url || typeof url !== 'string') return;
        const cleanUrl = url.replace(/\\+$/, '');
        captureRequestTemplate(cleanUrl);

        if (cleanUrl.length <= 600 && extractTokensFromText(cleanUrl, source, note || 'URL')) {
            onNewTokenDiscovered();
        }

        const existing = found.get(cleanUrl);
        if (existing) {
            if (note && !existing.note.includes(note)) {
                existing.note = existing.note ? `${existing.note} | ${note}` : note;
                scheduleRender();
            }
            return;
        }

        if (found.size >= MAX_ITEMS) {
            const oldestKey = found.keys().next().value;
            found.delete(oldestKey);
        }

        const ext = detectFormat(cleanUrl, source);
        found.set(cleanUrl, {
            url: cleanUrl,
            ext,
            source,
            note,
            time: new Date().toLocaleTimeString()
        });
        if (ext === '.js' || ext === '.json' || capturedJsonBodies.has(cleanUrl)) {
            scheduleUiMetaRefresh();
        }
        scheduleRender();
    }

    function copyText(text) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
        }
    }

    function safeOpenUrl(url, forceNewTab = openInNewTab) {
        if (!url) return;
        setQuickStatus('Membuka tautan...');
        setTimeout(() => {
            try {
                if (forceNewTab) {
                    const win = window.open(url, '_blank');
                    if (win) {
                        try { win.opener = null; } catch (_) {}
                        setQuickStatus('Tab baru dibuka.');
                        return;
                    }
                }
                const videoEl = document.querySelector('video');
                if (videoEl && /\.m3u8(\?|#|$)/i.test(url)) {
                    videoEl.src = url;
                    videoEl.load?.();
                    videoEl.play?.().catch(() => {});
                    setQuickStatus('Dimuat ke pemutar <video>.');
                } else {
                    window.location.assign(url);
                }
            } catch (_) {
                window.location.assign(url);
            }
        }, 30);
    }

    function scanPageScriptsAndMedia() {
        let added = 0;

        document.querySelectorAll('video, source, iframe[src]').forEach(el => {
            const src = el.currentSrc || el.src || el.getAttribute('src');
            if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
                recordItem(src, `dom-${el.tagName.toLowerCase()}`, el.tagName.toLowerCase());
                added++;
            }
        });

        const scripts = document.querySelectorAll('script');
        for (let i = 0; i < Math.min(scripts.length, 60); i++) {
            const script = scripts[i];
            if (script.src) {
                recordItem(script.src, 'dom-script', 'external');
            }
            const text = script.textContent || '';
            if (text && text.length <= MAX_SCAN_TEXT_LEN && text.includes('.m3u8')) {
                const m3u8List = extractM3u8CandidatesFromText(text, location.href);
                m3u8List.forEach(u => {
                    recordItem(u, 'inline-script', '.m3u8');
                    added++;
                });
            }
        }

        return added;
    }

    function queryApiWithGmXhr(targetUrl, tokenVal = '') {
        if (!targetUrl || typeof GM_xmlhttpRequest !== 'function') return;
        const headers = { 'Accept': 'application/json, text/plain, */*' };
        if (tokenVal) {
            headers['Authorization'] = `Bearer ${tokenVal}`;
            headers['token'] = tokenVal;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: targetUrl,
            headers,
            onload: (res) => {
                const body = res.responseText || '';
                if (!body) return;
                tryStoreJsonResponse(targetUrl, body, 'gm-xhr');
                if (isApiErrorJson(body)) return;
                recordItem(targetUrl, 'gm-xhr', `${res.status}`);
                const extracted = extractUrlsFromText(body, targetUrl);
                extracted.forEach(u => recordItem(u, 'gm-xhr-body', 'Extracted'));
            },
            onerror: () => {
                scanPageScriptsAndMedia();
            }
        });
    }

    // 1. Hook fetch() + JSON Response Live Override + Polling Guard
    const origFetch = window.fetch;
    if (origFetch) {
        window.fetch = async function (...args) {
            const input = args[0];
            const init = args[1] || {};
            const reqUrl = typeof input === 'string' ? input : (input && input.url) || '';
            const method = init.method || (input && input.method) || 'GET';

            if (stopServerPollingExp && reqUrl && /(poll|heartbeat|ping|check_status|keepalive|sync)/i.test(reqUrl)) {
                pushLiveLog('POLL', 'blocked.fetch', `${method} ${reqUrl}`);
                return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            const hdrs = {};
            try {
                const rawH = init.headers || (input && input.headers);
                if (rawH instanceof Headers) {
                    rawH.forEach((v, k) => { hdrs[k] = v; });
                } else if (rawH && typeof rawH === 'object') {
                    Object.assign(hdrs, rawH);
                }
            } catch (_) {}

            if (reqUrl) {
                captureRequestTemplate(reqUrl, method, hdrs, init.body || null);
                if (reqUrl.length <= 600 && extractTokensFromText(reqUrl, 'fetch-url', 'Request')) {
                    onNewTokenDiscovered();
                }
                try {
                    const hStr = JSON.stringify(hdrs);
                    if (hStr && extractTokensFromText(hStr, 'fetch-hdr', 'Request Header')) {
                        onNewTokenDiscovered();
                    }
                } catch (_) {}
            }
            if (looksInteresting(reqUrl)) {
                recordItem(reqUrl, 'fetch-req', method);
            }

            const jsonOverride = findMatchingJsonOverride(reqUrl);
            if (jsonOverride) {
                pushLiveLog('JSON', `override.fetch (${jsonOverride.name})`, reqUrl);
                recordItem(reqUrl, 'json-patch', jsonOverride.name || 'Mocked');
                tryStoreJsonResponse(reqUrl, jsonOverride.code, 'json-patch');
                return new Response(jsonOverride.code, {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                });
            }

            const res = await origFetch.apply(this, args);
            try {
                const finalUrl = res.url || reqUrl;
                if (looksInteresting(finalUrl)) {
                    recordItem(finalUrl, 'fetch-res', `${res.status}`);
                }

                const clone = res.clone();
                const ct = (clone.headers.get('content-type') || '').toLowerCase();
                if (
                    looksInteresting(finalUrl) ||
                    ct.includes('json') ||
                    ct.includes('mpegurl') ||
                    ct.includes('text') ||
                    ct.includes('plain')
                ) {
                    const bodyText = await clone.text();
                    const isJson = tryStoreJsonResponse(finalUrl, bodyText, 'fetch');
                    if (isJson && !found.has(finalUrl)) {
                        recordItem(finalUrl, 'fetch-json', `${res.status}`);
                    }
                    const extracted = extractUrlsFromText(bodyText, finalUrl);
                    extracted.forEach(u => recordItem(u, 'fetch-body', new URL(finalUrl, location.href).pathname));
                }
            } catch (_) {}
            return res;
        };
    }

    // 2. Hook XMLHttpRequest + JSON Response Live Override + Polling Guard
    const origOpen = XMLHttpRequest.prototype.open;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._m3u8Method = method || 'GET';
        this._m3u8Url = typeof url === 'string' ? url : String(url || '');
        this._m3u8Headers = {};
        if (this._m3u8Url && this._m3u8Url.length <= 600 && extractTokensFromText(this._m3u8Url, 'xhr-url', method)) {
            onNewTokenDiscovered();
        }
        if (looksInteresting(this._m3u8Url)) {
            recordItem(this._m3u8Url, 'xhr-req', method);
        }
        return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
        if (this._m3u8Headers) this._m3u8Headers[k] = v;
        try {
            if (k && v && (TOKEN_KEY_HINTS.some(h => String(k).toLowerCase().includes(h)) || extractTokensFromText(String(v), 'xhr-hdr', String(k)))) {
                if (addDetectedToken(String(v), 'xhr-hdr', String(k))) onNewTokenDiscovered();
            }
        } catch (_) {}
        return origSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        if (this._m3u8Url) {
            captureRequestTemplate(this._m3u8Url, this._m3u8Method, this._m3u8Headers, body);
        }

        if (stopServerPollingExp && this._m3u8Url && /(poll|heartbeat|ping|check_status|keepalive|sync)/i.test(this._m3u8Url)) {
            pushLiveLog('POLL', 'blocked.xhr', `${this._m3u8Method} ${this._m3u8Url}`);
            return;
        }

        const jsonOverride = findMatchingJsonOverride(this._m3u8Url);
        if (jsonOverride) {
            const mockText = jsonOverride.code;
            let parsedObj = null;
            try { parsedObj = JSON.parse(mockText); } catch (_) {}

            Object.defineProperty(this, 'readyState', { configurable: true, get: () => 4 });
            Object.defineProperty(this, 'status', { configurable: true, get: () => 200 });
            Object.defineProperty(this, 'statusText', { configurable: true, get: () => 'OK' });
            Object.defineProperty(this, 'responseText', { configurable: true, get: () => mockText });
            Object.defineProperty(this, 'response', {
                configurable: true,
                get: () => (this.responseType === 'json' ? parsedObj : mockText)
            });

            pushLiveLog('JSON', `override.xhr (${jsonOverride.name})`, this._m3u8Url);
            recordItem(this._m3u8Url, 'xhr-json-patch', jsonOverride.name || 'Mocked');
            tryStoreJsonResponse(this._m3u8Url, mockText, 'xhr-json-patch');

            setTimeout(() => {
                this.dispatchEvent(new Event('readystatechange'));
                this.dispatchEvent(new Event('load'));
                this.dispatchEvent(new Event('loadend'));
            }, 10);
            return;
        }

        this.addEventListener('load', function () {
            try {
                const respUrl = this.responseURL || this._m3u8Url || '';
                if (looksInteresting(respUrl)) {
                    recordItem(respUrl, 'xhr-res', `${this.status}`);
                }

                if (typeof this.responseText === 'string' && this.responseText) {
                    const isJson = tryStoreJsonResponse(respUrl, this.responseText, 'xhr');
                    if (isJson && !found.has(respUrl)) {
                        recordItem(respUrl, 'xhr-json', `${this.status}`);
                    }
                    if (looksInteresting(respUrl) || isJson || /\.(m3u8|mp4|js)/i.test(this.responseText)) {
                        const extracted = extractUrlsFromText(this.responseText, respUrl);
                        extracted.forEach(u => recordItem(u, 'xhr-body', 'XHR'));
                    } else if (extractTokensFromText(this.responseText, 'xhr-body', 'XHR Body')) {
                        onNewTokenDiscovered();
                    }
                }
            } catch (_) {}
        });
        return origSend.apply(this, arguments);
    };

    // 3. PerformanceObserver
    if (typeof PerformanceObserver !== 'undefined') {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.name) {
                        captureRequestTemplate(entry.name);
                        if (looksInteresting(entry.name)) {
                            recordItem(entry.name, 'perf', entry.initiatorType || 'res');
                        }
                    }
                }
            });
            observer.observe({ type: 'resource', buffered: true });
        } catch (_) {}
    }

    // 4. Scan DOM resources
    function scanDomResources() {
        document.querySelectorAll('video, source, iframe[src], script[src]').forEach(el => {
            const src = el.currentSrc || el.src || el.getAttribute('src');
            if (src && !src.startsWith('blob:') && !src.startsWith('data:') && looksInteresting(src)) {
                recordItem(src, el.tagName.toLowerCase(), 'DOM');
            }
        });
    }

    // =========================================================================
    // 5A. FLOATING PANEL: JS VIEWER & LIVE PATCH EDITOR (.PLIST MODE + LIVE LOG)
    // =========================================================================
    let jsPanelEl, jsSourceSelect, jsSavedSelect, jsNameInput, jsEditorArea, jsStatusEl, jsAutoRunCheck, jsPlistModeCheck;
    let rawJsBuffer = '';
    let jsInPlistMode = false;
    const jsSourceCache = new Map();

    function setJsStatus(msg, isError = false) {
        if (!jsStatusEl) return;
        jsStatusEl.textContent = msg;
        jsStatusEl.style.color = isError ? '#fca5a5' : '#86efac';
    }

    function executeLiveJsCode(code, label = 'live-patch') {
        let actualJs = code || '';
        try {
            actualJs = extractJsFromPlistOrRaw(actualJs);
        } catch (e) {
            setJsStatus(`Plist parse error: ${e.message}`, true);
            return false;
        }
        const trimmed = actualJs.trim();
        if (!trimmed) {
            setJsStatus('Kode JS kosong.', true);
            return false;
        }
        try {
            const scriptEl = document.createElement('script');
            scriptEl.type = 'text/javascript';
            scriptEl.dataset.tmLivePatch = label;
            scriptEl.textContent = `\n//# sourceURL=tm-live-patch-${encodeURIComponent(label)}.js\n${trimmed}`;
            (document.head || document.documentElement).appendChild(scriptEl);
            pushLiveLog('JS', `executeLiveJsCode (${label})`, `${trimmed.length} chars executed`);
            setJsStatus(`Dijalankan (${trimmed.length} chars) • ${new Date().toLocaleTimeString()}`);
            return true;
        } catch (err) {
            pushLiveLog('JS', `error:${label}`, err.message || String(err));
            setJsStatus(`Error eksekusi: ${err.message || err}`, true);
            return false;
        }
    }

    function toggleJsPlistMode(enablePlist) {
        if (!jsEditorArea) return;
        if (enablePlist && !jsInPlistMode) {
            rawJsBuffer = jsEditorArea.value || '';
            jsEditorArea.value = wrapJsInPlistDocument(rawJsBuffer);
            jsInPlistMode = true;
            setJsStatus('Mode .plist JS aktif (struktur fungsi & sumber).');
        } else if (!enablePlist && jsInPlistMode) {
            try {
                rawJsBuffer = extractJsFromPlistOrRaw(jsEditorArea.value || '');
            } catch (_) {}
            jsEditorArea.value = rawJsBuffer;
            jsInPlistMode = false;
            setJsStatus('Kembali ke mode raw JS.');
        }
    }

    function runAutoSavedPatches() {
        const entries = Object.values(savedJsPatches);
        let count = 0;
        for (const p of entries) {
            if (p && p.autoRun && p.code) {
                executeLiveJsCode(p.code, p.name || 'auto-patch');
                count++;
            }
        }
        if (count > 0) {
            setQuickStatus(`${count} saved JS patch dijalankan.`);
        }
    }

    function loadJsContentIntoEditor(jsUrl) {
        if (!jsUrl) return;
        ensureJsFloatingPanel();
        jsPanelEl.style.display = 'flex';

        const fileName = (() => {
            try {
                const u = new URL(jsUrl, location.href);
                return u.pathname.split('/').pop() || 'script.js';
            } catch (_) {
                return 'script.js';
            }
        })();

        if (jsNameInput) jsNameInput.value = fileName;
        if (jsSourceSelect) jsSourceSelect.value = jsUrl;

        const applyLoadedText = (text, fromCache = false) => {
            rawJsBuffer = text;
            if (jsPlistModeCheck && jsPlistModeCheck.checked) {
                jsInPlistMode = true;
                if (jsEditorArea) jsEditorArea.value = wrapJsInPlistDocument(text);
            } else {
                jsInPlistMode = false;
                if (jsEditorArea) jsEditorArea.value = text;
            }
            pushLiveLog('JS', 'loadJsContentIntoEditor', `${fileName} (${fromCache ? 'cache' : 'network'})`);
            setJsStatus(`${fromCache ? 'Loaded dari cache' : 'Selesai memuat'} ${fileName} (${text.length} chars).`);
        };

        if (jsSourceCache.has(jsUrl)) {
            applyLoadedText(jsSourceCache.get(jsUrl), true);
            return;
        }

        setJsStatus(`Mengambil sumber ${fileName}...`);
        if (jsEditorArea) jsEditorArea.value = `// Memuat ${jsUrl} ...`;

        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: jsUrl,
                onload: (res) => {
                    const txt = res.responseText || '// Kosong';
                    jsSourceCache.set(jsUrl, txt);
                    applyLoadedText(txt, false);
                },
                onerror: () => {
                    fetch(jsUrl)
                        .then(r => r.text())
                        .then(txt => {
                            jsSourceCache.set(jsUrl, txt);
                            applyLoadedText(txt, false);
                        })
                        .catch(e => setJsStatus(`Gagal memuat JS: ${e.message || e}`, true));
                }
            });
        } else {
            fetch(jsUrl)
                .then(r => r.text())
                .then(txt => {
                    jsSourceCache.set(jsUrl, txt);
                    applyLoadedText(txt, false);
                })
                .catch(e => setJsStatus(`Gagal memuat JS: ${e.message || e}`, true));
        }
    }

    function syncJsSourceSelector() {
        if (!jsSourceSelect) return;
        const prev = jsSourceSelect.value;
        jsSourceSelect.innerHTML = '';

        const jsItems = [...found.values()].filter(i => i.ext === '.js' || /\.js(\?|#|$)/i.test(i.url));
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = jsItems.length
            ? `-- Pilih File .JS Terdeteksi (${jsItems.length}) --`
            : '-- Belum ada file .JS terdeteksi --';
        jsSourceSelect.appendChild(opt0);

        jsItems.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.url;
            try {
                const u = new URL(item.url);
                opt.textContent = `${u.pathname.split('/').pop() || u.pathname} (${u.hostname})`;
            } catch (_) {
                opt.textContent = item.url.slice(0, 48);
            }
            if (item.url === prev) opt.selected = true;
            jsSourceSelect.appendChild(opt);
        });
    }

    function syncSavedPatchSelector() {
        if (!jsSavedSelect) return;
        const prev = jsSavedSelect.value;
        jsSavedSelect.innerHTML = '';

        const keys = Object.keys(savedJsPatches);
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = keys.length
            ? `-- Saved JS Patches (${keys.length}) --`
            : '-- Belum ada JS patch tersimpan --';
        jsSavedSelect.appendChild(opt0);

        keys.forEach(k => {
            const p = savedJsPatches[k];
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = `${p.autoRun ? '[AUTO] ' : ''}${p.name || k}`;
            if (k === prev) opt.selected = true;
            jsSavedSelect.appendChild(opt);
        });
    }

    function ensureJsFloatingPanel() {
        if (jsPanelEl && document.getElementById('m3u8-js-patch-panel')) return;

        jsPanelEl = document.createElement('div');
        jsPanelEl.id = 'm3u8-js-patch-panel';
        jsPanelEl.style.cssText = [
            'position:fixed',
            'left:12px',
            'top:52px',
            'z-index:2147483647',
            'width:365px',
            'max-width:calc(100vw - 24px)',
            'max-height:78vh',
            'background:#0f172a',
            'color:#f8fafc',
            'border:1px solid #a855f7',
            'border-radius:10px',
            'box-shadow:0 10px 28px rgba(0,0,0,.6)',
            'font-family:system-ui,-apple-system,sans-serif',
            'font-size:12px',
            'display:none',
            'flex-direction:column',
            'overflow:hidden'
        ].join(';');

        const jsHeader = document.createElement('div');
        jsHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#1e293b;border-bottom:1px solid #334155;font-weight:700;color:#d8b4fe;cursor:move;touch-action:none;user-select:none;';

        const jsTitle = document.createElement('span');
        jsTitle.textContent = '⠿ JS Viewer & Live Patch';

        const jsCloseBtn = document.createElement('button');
        jsCloseBtn.type = 'button';
        jsCloseBtn.textContent = '✕';
        jsCloseBtn.style.cssText = 'background:#475569;color:#fff;border:none;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px;';
        jsCloseBtn.onclick = () => { jsPanelEl.style.display = 'none'; };

        jsHeader.appendChild(jsTitle);
        jsHeader.appendChild(jsCloseBtn);

        const bodyWrap = document.createElement('div');
        bodyWrap.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:6px;overflow-y:auto;';

        jsSourceSelect = document.createElement('select');
        jsSourceSelect.style.cssText = 'width:100%;background:#1e293b;color:#d8b4fe;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        jsSourceSelect.onchange = () => {
            if (jsSourceSelect.value) loadJsContentIntoEditor(jsSourceSelect.value);
        };

        const savedRow = document.createElement('div');
        savedRow.style.cssText = 'display:flex;gap:5px;';

        jsSavedSelect = document.createElement('select');
        jsSavedSelect.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#e9d5ff;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        jsSavedSelect.onchange = () => {
            const key = jsSavedSelect.value;
            const entry = savedJsPatches[key];
            if (entry) {
                if (jsNameInput) jsNameInput.value = entry.name || key;
                rawJsBuffer = entry.code || '';
                if (jsEditorArea) {
                    jsEditorArea.value = jsPlistModeCheck?.checked
                        ? wrapJsInPlistDocument(rawJsBuffer)
                        : rawJsBuffer;
                }
                if (jsAutoRunCheck) jsAutoRunCheck.checked = Boolean(entry.autoRun);
                setJsStatus(`Patch "${entry.name || key}" dimuat.`);
            }
        };

        const delPatchBtn = document.createElement('button');
        delPatchBtn.type = 'button';
        delPatchBtn.textContent = 'Del';
        delPatchBtn.style.cssText = 'background:#7f1d1d;color:#fecaca;border:none;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:11px;';
        delPatchBtn.onclick = () => {
            const key = jsSavedSelect.value || (jsNameInput && jsNameInput.value.trim());
            if (!key || !savedJsPatches[key]) {
                setJsStatus('Pilih patch tersimpan untuk dihapus.', true);
                return;
            }
            delete savedJsPatches[key];
            saveJsonObj(STORAGE_KEY_JS_PATCHES, savedJsPatches);
            syncSavedPatchSelector();
            setJsStatus(`Patch "${key}" dihapus.`);
        };

        savedRow.appendChild(jsSavedSelect);
        savedRow.appendChild(delPatchBtn);

        const metaRow = document.createElement('div');
        metaRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

        jsNameInput = document.createElement('input');
        jsNameInput.type = 'text';
        jsNameInput.placeholder = 'Nama patch (mis: patch-player.js)';
        jsNameInput.value = 'custom-patch.js';
        jsNameInput.style.cssText = 'flex:1;min-width:110px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';

        const plistLabel = document.createElement('label');
        plistLabel.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#f0abfc;cursor:pointer;white-space:nowrap;';
        jsPlistModeCheck = document.createElement('input');
        jsPlistModeCheck.type = 'checkbox';
        jsPlistModeCheck.onchange = () => toggleJsPlistMode(jsPlistModeCheck.checked);
        plistLabel.appendChild(jsPlistModeCheck);
        plistLabel.appendChild(document.createTextNode('.plist'));

        const autoRunLabel = document.createElement('label');
        autoRunLabel.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#cbd5e1;cursor:pointer;white-space:nowrap;';
        jsAutoRunCheck = document.createElement('input');
        jsAutoRunCheck.type = 'checkbox';
        autoRunLabel.appendChild(jsAutoRunCheck);
        autoRunLabel.appendChild(document.createTextNode('Auto-Run'));

        metaRow.appendChild(jsNameInput);
        metaRow.appendChild(plistLabel);
        metaRow.appendChild(autoRunLabel);

        jsEditorArea = document.createElement('textarea');
        jsEditorArea.placeholder = '// Tulis atau edit kode JavaScript di sini...';
        jsEditorArea.spellcheck = false;
        jsEditorArea.style.cssText = 'width:100%;height:200px;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:7px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.4;resize:vertical;outline:none;';

        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;';

        const saveAndRunBtn = document.createElement('button');
        saveAndRunBtn.type = 'button';
        saveAndRunBtn.textContent = 'Save & Run';
        saveAndRunBtn.style.cssText = 'background:#059669;color:#fff;border:none;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:700;';
        saveAndRunBtn.onclick = () => {
            const name = (jsNameInput.value || '').trim() || `patch-${Date.now()}.js`;
            let code = jsEditorArea.value || '';
            try {
                code = extractJsFromPlistOrRaw(code);
            } catch (e) {
                setJsStatus(`Plist parse error: ${e.message}`, true);
                return;
            }
            if (!code.trim()) {
                setJsStatus('Isi kode JS terlebih dahulu.', true);
                return;
            }
            rawJsBuffer = code;
            savedJsPatches[name] = {
                name,
                url: jsSourceSelect.value || '',
                code,
                autoRun: jsAutoRunCheck.checked,
                updatedAt: new Date().toISOString()
            };
            saveJsonObj(STORAGE_KEY_JS_PATCHES, savedJsPatches);
            syncSavedPatchSelector();
            jsSavedSelect.value = name;
            executeLiveJsCode(code, name);
        };

        const runOnlyBtn = document.createElement('button');
        runOnlyBtn.type = 'button';
        runOnlyBtn.textContent = 'Run Only';
        runOnlyBtn.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:5px;padding:5px 9px;cursor:pointer;font-size:11px;font-weight:600;';
        runOnlyBtn.onclick = () => {
            const name = (jsNameInput.value || '').trim() || 'temp-run.js';
            executeLiveJsCode(jsEditorArea.value || '', name);
        };

        const liveLogBtn = document.createElement('button');
        liveLogBtn.type = 'button';
        liveLogBtn.textContent = 'Live Log';
        liveLogBtn.style.cssText = 'background:#16a34a;color:#fff;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;';
        liveLogBtn.onclick = openLogFloatingPanel;

        const copyJsBtn = document.createElement('button');
        copyJsBtn.type = 'button';
        copyJsBtn.textContent = 'Copy';
        copyJsBtn.style.cssText = 'background:#334155;color:#e2e8f0;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;';
        copyJsBtn.onclick = () => {
            copyText(jsEditorArea.value || '');
            setJsStatus('Konten editor JS disalin ke clipboard.');
        };

        actionRow.appendChild(saveAndRunBtn);
        actionRow.appendChild(runOnlyBtn);
        actionRow.appendChild(liveLogBtn);
        actionRow.appendChild(copyJsBtn);

        jsStatusEl = document.createElement('div');
        jsStatusEl.textContent = 'Siap membuka, memformat (.plist), atau live patch .js.';
        jsStatusEl.style.cssText = 'font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

        bodyWrap.appendChild(jsSourceSelect);
        bodyWrap.appendChild(savedRow);
        bodyWrap.appendChild(metaRow);
        bodyWrap.appendChild(jsEditorArea);
        bodyWrap.appendChild(actionRow);
        bodyWrap.appendChild(jsStatusEl);

        jsPanelEl.appendChild(jsHeader);
        jsPanelEl.appendChild(bodyWrap);
        document.documentElement.appendChild(jsPanelEl);

        applySavedPosition(jsPanelEl, STORAGE_KEY_JS_POS);
        enableDrag(jsHeader, jsPanelEl, STORAGE_KEY_JS_POS);
        syncJsSourceSelector();
        syncSavedPatchSelector();
    }

    function openJsFloatingPanel(initialUrl = '') {
        ensureJsFloatingPanel();
        syncJsSourceSelector();
        syncSavedPatchSelector();
        jsPanelEl.style.display = 'flex';
        if (initialUrl) loadJsContentIntoEditor(initialUrl);
    }

    // =========================================================================
    // 5B. FLOATING PANEL: JSON EDITOR & RESPONSE LIVE PATCH (.PLIST MODE)
    // =========================================================================
    let jsonPanelEl, jsonSourceSelect, jsonSavedSelect, jsonNameInput, jsonPatternInput, jsonEditorArea, jsonStatusEl, jsonEnabledCheck, jsonPlistCheck;
    let jsonInPlistMode = false;

    function setJsonStatus(msg, isError = false) {
        if (!jsonStatusEl) return;
        jsonStatusEl.textContent = msg;
        jsonStatusEl.style.color = isError ? '#fca5a5' : '#fde047';
    }

    function prettyFormatJson(rawStr) {
        const parsed = JSON.parse(rawStr);
        return JSON.stringify(parsed, null, 2);
    }

    function minifyJson(rawStr) {
        const parsed = JSON.parse(rawStr);
        return JSON.stringify(parsed);
    }

    function parseJsonOrPlistText(rawText) {
        const trimmed = (rawText || '').trim();
        if (!trimmed) throw new Error('Kosong');
        if (trimmed.startsWith('<?xml') || trimmed.startsWith('<plist') || trimmed.startsWith('<dict') || trimmed.startsWith('<array')) {
            return plistXmlToJsonObj(trimmed);
        }
        return JSON.parse(trimmed);
    }

    function toggleJsonPlistMode(enablePlist) {
        if (!jsonEditorArea) return;
        const cur = (jsonEditorArea.value || '').trim();
        if (!cur) {
            jsonInPlistMode = enablePlist;
            return;
        }
        try {
            if (enablePlist && !jsonInPlistMode) {
                jsonEditorArea.value = jsonToPlistXml(cur);
                jsonInPlistMode = true;
                setJsonStatus('Mode .plist JSON aktif.');
            } else if (!enablePlist && jsonInPlistMode) {
                const obj = plistXmlToJsonObj(cur);
                jsonEditorArea.value = JSON.stringify(obj, null, 2);
                jsonInPlistMode = false;
                setJsonStatus('Kembali ke mode JSON.');
            }
        } catch (err) {
            if (jsonPlistCheck) jsonPlistCheck.checked = jsonInPlistMode;
            setJsonStatus(`Konversi .plist gagal: ${err.message}`, true);
        }
    }

    function loadJsonIntoEditor(targetUrl) {
        if (!targetUrl) return;
        ensureJsonFloatingPanel();
        jsonPanelEl.style.display = 'flex';

        if (jsonSourceSelect) jsonSourceSelect.value = targetUrl;
        if (jsonPatternInput) {
            try {
                const u = new URL(targetUrl, location.href);
                jsonPatternInput.value = `${u.origin}${u.pathname}`;
                if (jsonNameInput) {
                    jsonNameInput.value = (u.pathname.split('/').pop() || 'api-response') + '.json';
                }
            } catch (_) {
                jsonPatternInput.value = targetUrl;
            }
        }

        const renderFormatted = (rawStr, label) => {
            if (jsonPlistCheck && jsonPlistCheck.checked) {
                try {
                    jsonEditorArea.value = jsonToPlistXml(rawStr);
                    jsonInPlistMode = true;
                    setJsonStatus(`${label} (ditampilkan sebagai .plist).`);
                    return;
                } catch (_) {}
            }
            jsonInPlistMode = false;
            try {
                jsonEditorArea.value = prettyFormatJson(rawStr);
                setJsonStatus(`${label} (JSON Pretty).`);
            } catch (_) {
                jsonEditorArea.value = rawStr;
                setJsonStatus(`${label} (raw).`);
            }
        };

        const cached = capturedJsonBodies.get(targetUrl);
        if (cached && cached.rawText) {
            renderFormatted(cached.rawText, `JSON capture (${cached.source} • ${cached.time})`);
            return;
        }

        setJsonStatus('Mengambil JSON dari URL...');
        jsonEditorArea.value = `{\n  "loading": "${targetUrl}"\n}`;

        const onLoaded = (text) => {
            tryStoreJsonResponse(targetUrl, text, 'manual-fetch');
            renderFormatted(text, 'JSON dimuat');
        };

        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: targetUrl,
                headers: { 'Accept': 'application/json, text/plain, */*' },
                onload: (res) => onLoaded(res.responseText || '{}'),
                onerror: () => {
                    fetch(targetUrl)
                        .then(r => r.text())
                        .then(onLoaded)
                        .catch(e => setJsonStatus(`Gagal mengambil JSON: ${e.message || e}`, true));
                }
            });
        } else {
            fetch(targetUrl)
                .then(r => r.text())
                .then(onLoaded)
                .catch(e => setJsonStatus(`Gagal mengambil JSON: ${e.message || e}`, true));
        }
    }

    function syncJsonSourceSelector() {
        if (!jsonSourceSelect) return;
        const prev = jsonSourceSelect.value;
        jsonSourceSelect.innerHTML = '';

        const urls = new Set([...capturedJsonBodies.keys()]);
        for (const item of found.values()) {
            if (item.ext === '.json' || item.ext === 'API' || /\.json(\?|#|$)/i.test(item.url)) {
                urls.add(item.url);
            }
        }

        const list = [...urls];
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = list.length
            ? `-- Pilih JSON / API Tertangkap (${list.length}) --`
            : '-- Belum ada JSON / API tertangkap --';
        jsonSourceSelect.appendChild(opt0);

        list.forEach(uStr => {
            const opt = document.createElement('option');
            opt.value = uStr;
            const hasCached = capturedJsonBodies.has(uStr);
            try {
                const u = new URL(uStr);
                opt.textContent = `${hasCached ? '[BODY] ' : ''}${u.pathname}${u.search.slice(0, 24)}`;
            } catch (_) {
                opt.textContent = uStr.slice(0, 50);
            }
            if (uStr === prev) opt.selected = true;
            jsonSourceSelect.appendChild(opt);
        });
    }

    function syncSavedJsonPatchSelector() {
        if (!jsonSavedSelect) return;
        const prev = jsonSavedSelect.value;
        jsonSavedSelect.innerHTML = '';

        const keys = Object.keys(savedJsonPatches);
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = keys.length
            ? `-- Saved JSON Patches (${keys.length}) --`
            : '-- Belum ada JSON patch tersimpan --';
        jsonSavedSelect.appendChild(opt0);

        keys.forEach(k => {
            const p = savedJsonPatches[k];
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = `${p.enabled ? '[ON] ' : '[OFF] '}${p.name || k}`;
            if (k === prev) opt.selected = true;
            jsonSavedSelect.appendChild(opt);
        });
    }

    function ensureJsonFloatingPanel() {
        if (jsonPanelEl && document.getElementById('m3u8-json-patch-panel')) return;

        jsonPanelEl = document.createElement('div');
        jsonPanelEl.id = 'm3u8-json-patch-panel';
        jsonPanelEl.style.cssText = [
            'position:fixed',
            'left:24px',
            'top:96px',
            'z-index:2147483647',
            'width:375px',
            'max-width:calc(100vw - 24px)',
            'max-height:80vh',
            'background:#0f172a',
            'color:#f8fafc',
            'border:1px solid #f59e0b',
            'border-radius:10px',
            'box-shadow:0 10px 28px rgba(0,0,0,.6)',
            'font-family:system-ui,-apple-system,sans-serif',
            'font-size:12px',
            'display:none',
            'flex-direction:column',
            'overflow:hidden'
        ].join(';');

        const jsonHeader = document.createElement('div');
        jsonHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#1e293b;border-bottom:1px solid #334155;font-weight:700;color:#fbbf24;cursor:move;touch-action:none;user-select:none;';

        const jsonTitle = document.createElement('span');
        jsonTitle.textContent = '⠿ JSON Editor & Response Override';

        const jsonCloseBtn = document.createElement('button');
        jsonCloseBtn.type = 'button';
        jsonCloseBtn.textContent = '✕';
        jsonCloseBtn.style.cssText = 'background:#475569;color:#fff;border:none;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px;';
        jsonCloseBtn.onclick = () => { jsonPanelEl.style.display = 'none'; };

        jsonHeader.appendChild(jsonTitle);
        jsonHeader.appendChild(jsonCloseBtn);

        const bodyWrap = document.createElement('div');
        bodyWrap.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:6px;overflow-y:auto;';

        jsonSourceSelect = document.createElement('select');
        jsonSourceSelect.style.cssText = 'width:100%;background:#1e293b;color:#fde68a;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        jsonSourceSelect.onchange = () => {
            if (jsonSourceSelect.value) loadJsonIntoEditor(jsonSourceSelect.value);
        };

        const savedRow = document.createElement('div');
        savedRow.style.cssText = 'display:flex;gap:5px;';

        jsonSavedSelect = document.createElement('select');
        jsonSavedSelect.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#fef08a;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        jsonSavedSelect.onchange = () => {
            const key = jsonSavedSelect.value;
            const entry = savedJsonPatches[key];
            if (entry) {
                if (jsonNameInput) jsonNameInput.value = entry.name || key;
                if (jsonPatternInput) jsonPatternInput.value = entry.targetPattern || '';
                const baseCode = entry.code || '';
                if (jsonEditorArea) {
                    if (jsonPlistCheck?.checked) {
                        try {
                            jsonEditorArea.value = jsonToPlistXml(baseCode);
                            jsonInPlistMode = true;
                        } catch (_) {
                            jsonEditorArea.value = baseCode;
                        }
                    } else {
                        jsonEditorArea.value = baseCode;
                        jsonInPlistMode = false;
                    }
                }
                if (jsonEnabledCheck) jsonEnabledCheck.checked = Boolean(entry.enabled);
                setJsonStatus(`JSON patch "${entry.name || key}" dimuat.`);
            }
        };

        const delJsonBtn = document.createElement('button');
        delJsonBtn.type = 'button';
        delJsonBtn.textContent = 'Del';
        delJsonBtn.style.cssText = 'background:#7f1d1d;color:#fecaca;border:none;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:11px;';
        delJsonBtn.onclick = () => {
            const key = jsonSavedSelect.value || (jsonNameInput && jsonNameInput.value.trim());
            if (!key || !savedJsonPatches[key]) {
                setJsonStatus('Pilih JSON patch tersimpan untuk dihapus.', true);
                return;
            }
            delete savedJsonPatches[key];
            saveJsonObj(STORAGE_KEY_JSON_PATCHES, savedJsonPatches);
            syncSavedJsonPatchSelector();
            setJsonStatus(`JSON patch "${key}" dihapus.`);
        };

        savedRow.appendChild(jsonSavedSelect);
        savedRow.appendChild(delJsonBtn);

        const metaRow = document.createElement('div');
        metaRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

        jsonNameInput = document.createElement('input');
        jsonNameInput.type = 'text';
        jsonNameInput.placeholder = 'Nama preset JSON (mis: user-vip.json)';
        jsonNameInput.value = 'custom-response.json';
        jsonNameInput.style.cssText = 'flex:1;min-width:110px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';

        const plistJsonLabel = document.createElement('label');
        plistJsonLabel.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#fcd34d;cursor:pointer;white-space:nowrap;';
        jsonPlistCheck = document.createElement('input');
        jsonPlistCheck.type = 'checkbox';
        jsonPlistCheck.onchange = () => toggleJsonPlistMode(jsonPlistCheck.checked);
        plistJsonLabel.appendChild(jsonPlistCheck);
        plistJsonLabel.appendChild(document.createTextNode('.plist'));

        const enabledLabel = document.createElement('label');
        enabledLabel.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#fde047;cursor:pointer;white-space:nowrap;';
        jsonEnabledCheck = document.createElement('input');
        jsonEnabledCheck.type = 'checkbox';
        jsonEnabledCheck.checked = true;
        enabledLabel.appendChild(jsonEnabledCheck);
        enabledLabel.appendChild(document.createTextNode('Hook API'));

        metaRow.appendChild(jsonNameInput);
        metaRow.appendChild(plistJsonLabel);
        metaRow.appendChild(enabledLabel);

        jsonPatternInput = document.createElement('input');
        jsonPatternInput.type = 'text';
        jsonPatternInput.placeholder = 'Target URL / Endpoint pattern (mis: /api/app/vid/m3u8)';
        jsonPatternInput.style.cssText = 'width:100%;background:#1e293b;color:#7dd3fc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';

        jsonEditorArea = document.createElement('textarea');
        jsonEditorArea.placeholder = '{\n  "code": 200,\n  "data": {}\n}';
        jsonEditorArea.spellcheck = false;
        jsonEditorArea.style.cssText = 'width:100%;height:195px;background:#020617;color:#fef3c7;border:1px solid #334155;border-radius:6px;padding:7px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.4;resize:vertical;outline:none;';

        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;';

        const saveApplyJsonBtn = document.createElement('button');
        saveApplyJsonBtn.type = 'button';
        saveApplyJsonBtn.textContent = 'Save & Hook';
        saveApplyJsonBtn.style.cssText = 'background:#d97706;color:#fff;border:none;border-radius:5px;padding:5px 9px;cursor:pointer;font-size:11px;font-weight:700;';
        saveApplyJsonBtn.onclick = () => {
            const name = (jsonNameInput.value || '').trim() || `json-${Date.now()}.json`;
            const targetPattern = (jsonPatternInput.value || '').trim();
            const rawInput = (jsonEditorArea.value || '').trim();

            if (!rawInput) {
                setJsonStatus('Isi JSON / Plist terlebih dahulu.', true);
                return;
            }
            let normalizedJson = '';
            try {
                const parsedObj = parseJsonOrPlistText(rawInput);
                normalizedJson = JSON.stringify(parsedObj, null, 2);
            } catch (err) {
                setJsonStatus(`Parse Error: ${err.message}`, true);
                return;
            }

            savedJsonPatches[name] = {
                name,
                targetPattern,
                code: normalizedJson,
                enabled: jsonEnabledCheck.checked,
                updatedAt: new Date().toISOString()
            };
            saveJsonObj(STORAGE_KEY_JSON_PATCHES, savedJsonPatches);
            syncSavedJsonPatchSelector();
            jsonSavedSelect.value = name;
            pushLiveLog('JSON', `saveAndHook (${name})`, targetPattern || 'saved');

            const extracted = extractUrlsFromText(normalizedJson, targetPattern || location.href);
            extracted.forEach(u => recordItem(u, 'json-editor', name));

            setJsonStatus(
                jsonEnabledCheck.checked && targetPattern
                    ? `Disimpan & aktif hook: ${targetPattern}`
                    : `JSON "${name}" tersimpan.`
            );
        };

        const formatJsonBtn = document.createElement('button');
        formatJsonBtn.type = 'button';
        formatJsonBtn.textContent = 'Format';
        formatJsonBtn.style.cssText = 'background:#0284c7;color:#fff;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;font-weight:600;';
        formatJsonBtn.onclick = () => {
            try {
                const obj = parseJsonOrPlistText(jsonEditorArea.value);
                if (jsonPlistCheck?.checked) {
                    jsonEditorArea.value = jsonToPlistXml(JSON.stringify(obj));
                    setJsonStatus('Plist diformat rapi.');
                } else {
                    jsonEditorArea.value = JSON.stringify(obj, null, 2);
                    setJsonStatus('JSON valid & diformat rapi.');
                }
            } catch (err) {
                setJsonStatus(`Format gagal: ${err.message}`, true);
            }
        };

        const minifyJsonBtn = document.createElement('button');
        minifyJsonBtn.type = 'button';
        minifyJsonBtn.textContent = 'Minify';
        minifyJsonBtn.style.cssText = 'background:#4f46e5;color:#fff;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;';
        minifyJsonBtn.onclick = () => {
            try {
                const obj = parseJsonOrPlistText(jsonEditorArea.value);
                jsonEditorArea.value = JSON.stringify(obj);
                if (jsonPlistCheck) jsonPlistCheck.checked = false;
                jsonInPlistMode = false;
                setJsonStatus('JSON berhasil di-minify.');
            } catch (err) {
                setJsonStatus(`Minify gagal: ${err.message}`, true);
            }
        };

        const liveLogJsonBtn = document.createElement('button');
        liveLogJsonBtn.type = 'button';
        liveLogJsonBtn.textContent = 'Live Log';
        liveLogJsonBtn.style.cssText = 'background:#16a34a;color:#fff;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;';
        liveLogJsonBtn.onclick = openLogFloatingPanel;

        const copyJsonBtn = document.createElement('button');
        copyJsonBtn.type = 'button';
        copyJsonBtn.textContent = 'Copy';
        copyJsonBtn.style.cssText = 'background:#334155;color:#e2e8f0;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;';
        copyJsonBtn.onclick = () => {
            copyText(jsonEditorArea.value || '');
            setJsonStatus('Disalin ke clipboard.');
        };

        actionRow.appendChild(saveApplyJsonBtn);
        actionRow.appendChild(formatJsonBtn);
        actionRow.appendChild(minifyJsonBtn);
        actionRow.appendChild(liveLogJsonBtn);
        actionRow.appendChild(copyJsonBtn);

        jsonStatusEl = document.createElement('div');
        jsonStatusEl.textContent = 'Siap membuka, memformat (.plist), atau override respons JSON.';
        jsonStatusEl.style.cssText = 'font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

        bodyWrap.appendChild(jsonSourceSelect);
        bodyWrap.appendChild(savedRow);
        bodyWrap.appendChild(metaRow);
        bodyWrap.appendChild(jsonPatternInput);
        bodyWrap.appendChild(jsonEditorArea);
        bodyWrap.appendChild(actionRow);
        bodyWrap.appendChild(jsonStatusEl);

        jsonPanelEl.appendChild(jsonHeader);
        jsonPanelEl.appendChild(bodyWrap);
        document.documentElement.appendChild(jsonPanelEl);

        applySavedPosition(jsonPanelEl, STORAGE_KEY_JSON_POS);
        enableDrag(jsonHeader, jsonPanelEl, STORAGE_KEY_JSON_POS);
        syncJsonSourceSelector();
        syncSavedJsonPatchSelector();
    }

    function openJsonFloatingPanel(initialUrl = '') {
        ensureJsonFloatingPanel();
        syncJsonSourceSelector();
        syncSavedJsonPatchSelector();
        jsonPanelEl.style.display = 'flex';
        if (initialUrl) loadJsonIntoEditor(initialUrl);
    }

    // =========================================================================
    // 5C. FLOATING PANEL BARU: STORAGE LIVE PATCH (.PLIST MODE + SEARCH)
    // =========================================================================
    let storagePanelEl, storageAreaSelect, storageSearchInput, storageKeySelect, storageKeyInput, storageEditorArea, storagePlistCheck, storageStatusEl;
    let storageInPlistMode = false;

    function setStorageStatus(msg, isError = false) {
        if (!storageStatusEl) return;
        storageStatusEl.textContent = msg;
        storageStatusEl.style.color = isError ? '#fca5a5' : '#7dd3fc';
    }

    function getTargetStorageObj() {
        return storageAreaSelect && storageAreaSelect.value === 'session'
            ? window.sessionStorage
            : window.localStorage;
    }

    function getOrigStorageSetter() {
        return storageAreaSelect && storageAreaSelect.value === 'session'
            ? origSessionSetItem
            : origLocalSetItem;
    }

    function collectStorageEntries(q = '') {
        const st = getTargetStorageObj();
        const query = (q || '').trim().toLowerCase();
        const items = [];
        try {
            for (let i = 0; i < st.length; i++) {
                const k = st.key(i);
                if (!k || k.startsWith('tm_m3u8_')) continue;
                const v = st.getItem(k) || '';
                if (!query || k.toLowerCase().includes(query) || v.toLowerCase().includes(query)) {
                    items.push({ key: k, value: v });
                }
            }
        } catch (_) {}
        return items;
    }

    function formatStorageValueForDisplay(rawVal, asPlist) {
        let parsedObj = null;
        try {
            parsedObj = JSON.parse(rawVal);
        } catch (_) {
            parsedObj = null;
        }
        if (asPlist) {
            const target = parsedObj !== null ? parsedObj : rawVal;
            return [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
                '<plist version="1.0">',
                valueToPlistNode(target, 2),
                '</plist>'
            ].join('\n');
        }
        return parsedObj !== null ? JSON.stringify(parsedObj, null, 2) : rawVal;
    }

    function renderStorageEditorList() {
        if (!storageKeySelect) return;
        const prev = storageKeySelect.value;
        const q = storageSearchInput ? storageSearchInput.value : '';
        const matches = collectStorageEntries(q);

        storageKeySelect.innerHTML = '';
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = matches.length
            ? `-- Pilih Key (${matches.length} cocok) --`
            : '-- Tidak ada key cocok --';
        storageKeySelect.appendChild(opt0);

        matches.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.key;
            opt.textContent = `${item.key} (${item.value.length}c)`;
            if (item.key === prev) opt.selected = true;
            storageKeySelect.appendChild(opt);
        });
    }

    function loadStorageKeyIntoEditor(keyName) {
        if (!keyName || !storageEditorArea) return;
        const st = getTargetStorageObj();
        let val = '';
        try {
            val = st.getItem(keyName) ?? '';
        } catch (_) {}
        if (storageKeyInput) storageKeyInput.value = keyName;
        if (storageKeySelect) storageKeySelect.value = keyName;
        const usePlist = Boolean(storagePlistCheck && storagePlistCheck.checked);
        storageInPlistMode = usePlist;
        storageEditorArea.value = formatStorageValueForDisplay(val, usePlist);
        setStorageStatus(`Key "${keyName}" dimuat (${val.length} chars).`);
    }

    function applyStorageLivePatch() {
        if (!storageKeyInput || !storageEditorArea) return;
        const keyName = (storageKeyInput.value || '').trim();
        if (!keyName) {
            setStorageStatus('Isi nama key storage terlebih dahulu.', true);
            return;
        }
        let rawText = storageEditorArea.value || '';
        const trimmed = rawText.trim();

        let finalValue = rawText;
        if (trimmed.startsWith('<?xml') || trimmed.startsWith('<plist') || trimmed.startsWith('<dict') || trimmed.startsWith('<array')) {
            try {
                const parsed = plistXmlToJsonObj(trimmed);
                finalValue = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
            } catch (err) {
                setStorageStatus(`Plist parse error: ${err.message}`, true);
                return;
            }
        } else {
            try {
                const parsedJson = JSON.parse(trimmed);
                finalValue = JSON.stringify(parsedJson);
            } catch (_) {
                finalValue = rawText;
            }
        }

        const areaName = storageAreaSelect?.value === 'session' ? 'sessionStorage' : 'localStorage';
        try {
            getOrigStorageSetter()(keyName, finalValue);
            if (extractTokensFromStorageEntry(areaName, keyName, finalValue)) {
                onNewTokenDiscovered();
            }
            pushLiveLog('STORAGE', `livePatch.${areaName}`, `${keyName} = ${finalValue.slice(0, 120)}`);
            renderStorageEditorList();
            setStorageStatus(`Live patch "${keyName}" diterapkan ke ${areaName}.`);
        } catch (err) {
            setStorageStatus(`Gagal menyimpan: ${err.message}`, true);
        }
    }

    function deleteStorageKeyPatch() {
        const keyName = (storageKeyInput?.value || storageKeySelect?.value || '').trim();
        if (!keyName) {
            setStorageStatus('Pilih atau isi key untuk dihapus.', true);
            return;
        }
        const st = getTargetStorageObj();
        const areaName = storageAreaSelect?.value === 'session' ? 'sessionStorage' : 'localStorage';
        try {
            st.removeItem(keyName);
            if (storageKeyInput) storageKeyInput.value = '';
            if (storageEditorArea) storageEditorArea.value = '';
            pushLiveLog('STORAGE', `removeItem.${areaName}`, keyName);
            renderStorageEditorList();
            setStorageStatus(`Key "${keyName}" dihapus dari ${areaName}.`);
        } catch (err) {
            setStorageStatus(`Gagal hapus: ${err.message}`, true);
        }
    }

    function ensureStorageFloatingPanel() {
        if (storagePanelEl && document.getElementById('m3u8-storage-patch-panel')) return;

        storagePanelEl = document.createElement('div');
        storagePanelEl.id = 'm3u8-storage-patch-panel';
        storagePanelEl.style.cssText = [
            'position:fixed',
            'left:20px',
            'top:84px',
            'z-index:2147483647',
            'width:375px',
            'max-width:calc(100vw - 24px)',
            'max-height:80vh',
            'background:#0f172a',
            'color:#f8fafc',
            'border:1px solid #38bdf8',
            'border-radius:10px',
            'box-shadow:0 10px 28px rgba(0,0,0,.65)',
            'font-family:system-ui,-apple-system,sans-serif',
            'font-size:12px',
            'display:none',
            'flex-direction:column',
            'overflow:hidden'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#1e293b;border-bottom:1px solid #334155;font-weight:700;color:#7dd3fc;cursor:move;touch-action:none;user-select:none;';

        const title = document.createElement('span');
        title.textContent = '⠿ Storage Live Patch (.plist & Search)';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:#475569;color:#fff;border:none;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px;';
        closeBtn.onclick = () => { storagePanelEl.style.display = 'none'; };

        header.appendChild(title);
        header.appendChild(closeBtn);

        const bodyWrap = document.createElement('div');
        bodyWrap.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:6px;overflow-y:auto;';

        const areaSearchRow = document.createElement('div');
        areaSearchRow.style.cssText = 'display:flex;gap:5px;';

        storageAreaSelect = document.createElement('select');
        storageAreaSelect.style.cssText = 'background:#1e293b;color:#7dd3fc;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        const optLocal = document.createElement('option');
        optLocal.value = 'local';
        optLocal.textContent = 'localStorage';
        const optSess = document.createElement('option');
        optSess.value = 'session';
        optSess.textContent = 'sessionStorage';
        storageAreaSelect.appendChild(optLocal);
        storageAreaSelect.appendChild(optSess);
        storageAreaSelect.onchange = () => {
            renderStorageEditorList();
            setStorageStatus(`Area: ${storageAreaSelect.value}Storage`);
        };

        storageSearchInput = document.createElement('input');
        storageSearchInput.type = 'text';
        storageSearchInput.placeholder = 'Search key atau value...';
        storageSearchInput.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';
        storageSearchInput.oninput = renderStorageEditorList;

        areaSearchRow.appendChild(storageAreaSelect);
        areaSearchRow.appendChild(storageSearchInput);

        storageKeySelect = document.createElement('select');
        storageKeySelect.style.cssText = 'width:100%;background:#1e293b;color:#e0f2fe;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        storageKeySelect.onchange = () => {
            if (storageKeySelect.value) loadStorageKeyIntoEditor(storageKeySelect.value);
        };

        const keyMetaRow = document.createElement('div');
        keyMetaRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

        storageKeyInput = document.createElement('input');
        storageKeyInput.type = 'text';
        storageKeyInput.placeholder = 'Key name (baru atau yang dipilih)...';
        storageKeyInput.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';

        const plistStLabel = document.createElement('label');
        plistStLabel.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#7dd3fc;cursor:pointer;white-space:nowrap;';
        storagePlistCheck = document.createElement('input');
        storagePlistCheck.type = 'checkbox';
        storagePlistCheck.checked = true;
        storagePlistCheck.onchange = () => {
            const curKey = storageKeyInput.value.trim();
            if (curKey && storageEditorArea.value.trim()) {
                try {
                    const currentVal = storageInPlistMode
                        ? (() => {
                            const parsed = plistXmlToJsonObj(storageEditorArea.value);
                            return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                        })()
                        : storageEditorArea.value;
                    storageInPlistMode = storagePlistCheck.checked;
                    storageEditorArea.value = formatStorageValueForDisplay(currentVal, storageInPlistMode);
                } catch (e) {
                    setStorageStatus(`Toggle .plist gagal: ${e.message}`, true);
                }
            } else {
                storageInPlistMode = storagePlistCheck.checked;
            }
        };
        plistStLabel.appendChild(storagePlistCheck);
        plistStLabel.appendChild(document.createTextNode('.plist Mode'));

        keyMetaRow.appendChild(storageKeyInput);
        keyMetaRow.appendChild(plistStLabel);

        storageEditorArea = document.createElement('textarea');
        storageEditorArea.placeholder = 'Nilai key storage (format .plist XML atau JSON/teks)...';
        storageEditorArea.spellcheck = false;
        storageEditorArea.style.cssText = 'width:100%;height:190px;background:#020617;color:#bae6fd;border:1px solid #334155;border-radius:6px;padding:7px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.4;resize:vertical;outline:none;';

        const actRow = document.createElement('div');
        actRow.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;';

        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.textContent = 'Live Patch';
        applyBtn.style.cssText = 'background:#0284c7;color:#fff;border:none;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:700;';
        applyBtn.onclick = applyStorageLivePatch;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = 'Delete Key';
        delBtn.style.cssText = 'background:#7f1d1d;color:#fecaca;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;';
        delBtn.onclick = deleteStorageKeyPatch;

        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.textContent = 'Refresh';
        reloadBtn.style.cssText = 'background:#334155;color:#e2e8f0;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;';
        reloadBtn.onclick = () => {
            renderStorageEditorList();
            setStorageStatus('Daftar storage diperbarui.');
        };

        const copyStBtn = document.createElement('button');
        copyStBtn.type = 'button';
        copyStBtn.textContent = 'Copy';
        copyStBtn.style.cssText = 'background:#475569;color:#fff;border:none;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;';
        copyStBtn.onclick = () => {
            copyText(storageEditorArea.value || '');
            setStorageStatus('Isi editor storage disalin.');
        };

        actRow.appendChild(applyBtn);
        actRow.appendChild(delBtn);
        actRow.appendChild(reloadBtn);
        actRow.appendChild(copyStBtn);

        storageStatusEl = document.createElement('div');
        storageStatusEl.textContent = 'Siap mencari & live patch localStorage / sessionStorage.';
        storageStatusEl.style.cssText = 'font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

        bodyWrap.appendChild(areaSearchRow);
        bodyWrap.appendChild(storageKeySelect);
        bodyWrap.appendChild(keyMetaRow);
        bodyWrap.appendChild(storageEditorArea);
        bodyWrap.appendChild(actRow);
        bodyWrap.appendChild(storageStatusEl);

        storagePanelEl.appendChild(header);
        storagePanelEl.appendChild(bodyWrap);
        document.documentElement.appendChild(storagePanelEl);

        applySavedPosition(storagePanelEl, STORAGE_KEY_STORAGE_POS);
        enableDrag(header, storagePanelEl, STORAGE_KEY_STORAGE_POS);
        renderStorageEditorList();
    }

    function openStorageFloatingPanel(initialKey = '') {
        ensureStorageFloatingPanel();
        renderStorageEditorList();
        storagePanelEl.style.display = 'flex';
        if (initialKey) loadStorageKeyIntoEditor(initialKey);
    }

    // =========================================================================
    // 6. MAIN FLOATING PANEL
    // =========================================================================
    let listEl, countEl, panelEl, configDrawerEl, filterBarEl, quickBarEl, statusLineEl;
    let apiTagsEl, apiInputEl, tokenTagsEl, tokenInputEl, tokenCountEl;
    let templateSelect, builderUrlInput, builderTokSelect, builderExtraInput, builderPreviewBox;

    function setQuickStatus(msg, isError = false) {
        if (!statusLineEl) return;
        statusLineEl.textContent = msg;
        statusLineEl.style.color = isError ? '#fca5a5' : '#86efac';
    }

    function applySavedPosition(el, storageKey = STORAGE_KEY_POS) {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const pos = JSON.parse(raw);
            if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                el.style.left = `${pos.left}px`;
                el.style.top = `${pos.top}px`;
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
        } catch (_) {}
    }

    function savePosition(el, storageKey = STORAGE_KEY_POS) {
        try {
            const rect = el.getBoundingClientRect();
            localStorage.setItem(storageKey, JSON.stringify({
                left: Math.round(rect.left),
                top: Math.round(rect.top)
            }));
        } catch (_) {}
    }

    function enableDrag(handle, target, storageKey = STORAGE_KEY_POS) {
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button, input, select, a, label, textarea')) return;
            dragging = true;
            const rect = target.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            target.style.left = `${rect.left}px`;
            target.style.top = `${rect.top}px`;
            target.style.right = 'auto';
            target.style.bottom = 'auto';
            handle.setPointerCapture?.(e.pointerId);
            e.preventDefault();
        });

        handle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const maxX = Math.max(0, window.innerWidth - target.offsetWidth);
            const maxY = Math.max(0, window.innerHeight - target.offsetHeight);
            const nextX = Math.min(Math.max(0, e.clientX - offsetX), maxX);
            const nextY = Math.min(Math.max(0, e.clientY - offsetY), maxY);
            target.style.left = `${nextX}px`;
            target.style.top = `${nextY}px`;
        });

        const stopDrag = () => {
            if (!dragging) return;
            dragging = false;
            savePosition(target, storageKey);
        };

        handle.addEventListener('pointerup', stopDrag);
        handle.addEventListener('pointercancel', stopDrag);
    }

    function updateBuilderPreview() {
        if (!builderPreviewBox || !builderUrlInput) return '';
        const tplUrl = builderUrlInput.value.trim();
        const tok = builderTokSelect ? builderTokSelect.value.trim() : '';
        const extra = builderExtraInput ? builderExtraInput.value.trim() : '';

        saveJsonObj(STORAGE_KEY_BUILDER, {
            url: tplUrl,
            tok,
            extra,
            autoMatch: autoMatchEnabled,
            openTab: openInNewTab
        });
        const built = buildPreservedUrl(tplUrl, tok, extra);
        builderPreviewBox.textContent = built || 'Pilih template URL asli / isi API & pilih token...';
        return built;
    }

    function getLatestM3u8Url() {
        for (const item of [...found.values()].reverse()) {
            if (item.ext === '.m3u8' || /\.m3u8(\?|#|$)/i.test(item.url)) {
                return item.url;
            }
        }
        return '';
    }

    function syncTemplateSelector() {
        if (!templateSelect) return;
        const currentVal = templateSelect.value;
        templateSelect.innerHTML = '';

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = capturedTemplates.size
            ? `-- Pilih Request Asli Tertangkap (${capturedTemplates.size}) --`
            : '-- Belum ada request API tertangkap --';
        templateSelect.appendChild(defaultOpt);

        for (const [, tpl] of capturedTemplates.entries()) {
            const opt = document.createElement('option');
            opt.value = tpl.fullUrl;
            const u = new URL(tpl.fullUrl);
            const params = [...u.searchParams.keys()].join(',');
            opt.textContent = `${u.pathname}${params ? ' ?' + params : ''}`;
            if (tpl.fullUrl === currentVal) opt.selected = true;
            templateSelect.appendChild(opt);
        }
    }

    function syncBuilderSelectors() {
        if (!builderTokSelect) return;
        const prev = builderTokSelect.value || builderState.tok || '';
        const tokens = getActiveTokens();

        builderTokSelect.innerHTML = '';
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = tokens.length ? '-- Pilih Token --' : '-- Belum ada token --';
        builderTokSelect.appendChild(emptyOpt);

        tokens.forEach((t, i) => {
            const opt = document.createElement('option');
            opt.value = t;
            const src = detectedTokens.get(t)?.source || (customTokens.includes(t) ? 'custom' : '');
            opt.textContent = `#${i + 1}${src ? ' [' + src.slice(0, 2) + ']' : ''} ${t.slice(0, 22)}...`;
            if (t === prev) opt.selected = true;
            builderTokSelect.appendChild(opt);
        });

        if (!builderTokSelect.value && tokens.length > 0) {
            builderTokSelect.value = tokens[0];
        }
        updateBuilderPreview();
    }

    function renderApiTags() {
        if (!apiTagsEl) return;
        apiTagsEl.innerHTML = '';

        const unique = [...new Set([...customApis, ...capturedTemplates.keys()])];
        unique.forEach((pattern) => {
            const isCustom = customApis.includes(pattern);
            const tplObj = capturedTemplates.get(pattern);
            const targetUrl = tplObj ? tplObj.fullUrl : pattern;

            const chip = document.createElement('span');
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:999px;padding:2px 8px;font-size:10px;cursor:pointer;';
            chip.title = targetUrl;

            const label = document.createElement('span');
            label.textContent = targetUrl;
            label.style.cssText = 'max-width:195px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            label.onclick = () => {
                if (builderUrlInput) {
                    builderUrlInput.value = targetUrl.startsWith('http')
                        ? targetUrl
                        : `${location.origin}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
                    updateBuilderPreview();
                }
            };

            chip.appendChild(label);

            if (isCustom) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.textContent = '×';
                delBtn.style.cssText = 'background:none;border:none;color:#f87171;cursor:pointer;padding:0 2px;font-size:12px;';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    customApis = customApis.filter(x => x !== pattern);
                    saveList(STORAGE_KEY_API, customApis);
                    renderApiTags();
                };
                chip.appendChild(delBtn);
            }

            apiTagsEl.appendChild(chip);
        });
    }

    function renderTokenList() {
        if (!tokenTagsEl) return;
        tokenTagsEl.innerHTML = '';

        const all = getActiveTokens();
        if (tokenCountEl) tokenCountEl.textContent = String(all.length);

        if (all.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'Belum ada token di localStorage / sessionStorage.';
            empty.style.cssText = 'color:#94a3b8;font-size:11px;';
            tokenTagsEl.appendChild(empty);
            return;
        }

        all.forEach((tok) => {
            const isCustom = customTokens.includes(tok);
            const metaInfo = detectedTokens.get(tok);

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:5px;background:#0f172a;border:1px solid #1e293b;border-radius:5px;padding:4px 6px;font-size:10px;';

            const info = document.createElement('div');
            info.style.cssText = 'min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#a5f3fc;cursor:pointer;';
            const srcLabel = isCustom ? 'CUSTOM' : `${metaInfo?.source || 'AUTO'}${metaInfo?.note ? ':' + metaInfo.note : ''}`;
            info.textContent = `[${srcLabel}] ${tok}`;
            info.onclick = () => {
                if (builderTokSelect) {
                    builderTokSelect.value = tok;
                    updateBuilderPreview();
                }
            };

            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';

            const useBtn = document.createElement('button');
            useBtn.type = 'button';
            useBtn.textContent = 'Use';
            useBtn.style.cssText = 'background:#0d9488;color:#fff;border:none;border-radius:4px;padding:2px 5px;cursor:pointer;font-size:10px;';
            useBtn.onclick = () => {
                if (builderTokSelect) {
                    builderTokSelect.value = tok;
                    updateBuilderPreview();
                }
            };

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.textContent = 'Copy';
            copyBtn.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:4px;padding:2px 5px;cursor:pointer;font-size:10px;';
            copyBtn.onclick = () => {
                copyText(tok);
                copyBtn.textContent = 'OK';
                setTimeout(() => (copyBtn.textContent = 'Copy'), 800);
            };

            btns.appendChild(useBtn);
            btns.appendChild(copyBtn);

            if (isCustom) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.textContent = '×';
                delBtn.style.cssText = 'background:#7f1d1d;color:#fecaca;border:none;border-radius:4px;padding:2px 5px;cursor:pointer;font-size:10px;';
                delBtn.onclick = () => {
                    customTokens = customTokens.filter(x => x !== tok);
                    saveList(STORAGE_KEY_TOKENS, customTokens);
                    renderTokenList();
                    syncBuilderSelectors();
                };
                btns.appendChild(delBtn);
            }

            row.appendChild(info);
            row.appendChild(btns);
            tokenTagsEl.appendChild(row);
        });
    }

    function renderFilterBar() {
        if (!filterBarEl) return;
        filterBarEl.innerHTML = '';

        const counts = new Map();
        for (const item of found.values()) {
            counts.set(item.ext, (counts.get(item.ext) || 0) + 1);
        }

        const baseFilters = ['ALL', '.m3u8', '.mp4', '.js', '.json', 'API'];
        const dynamicExts = [...counts.keys()].filter(e => !baseFilters.includes(e));
        const allFilters = [...baseFilters, ...dynamicExts];

        allFilters.forEach(fmt => {
            const count = fmt === 'ALL' ? found.size : (counts.get(fmt) || 0);
            const active = activeFilter === fmt;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = `${fmt} (${count})`;
            btn.style.cssText = [
                'border:none',
                'border-radius:999px',
                'padding:2px 8px',
                'font-size:10px',
                'cursor:pointer',
                'white-space:nowrap',
                active ? 'background:#2563eb;color:#fff;font-weight:700;' : 'background:#1e293b;color:#cbd5e1;'
            ].join(';');

            btn.onclick = () => {
                activeFilter = fmt;
                renderFilterBar();
                renderList();
            };

            filterBarEl.appendChild(btn);
        });
    }

    function addApiFromInput() {
        if (!apiInputEl) return;
        const val = apiInputEl.value.trim();
        if (!val) return;
        if (!customApis.includes(val)) {
            customApis.push(val);
            saveList(STORAGE_KEY_API, customApis);
            renderApiTags();
        }
        if (builderUrlInput) {
            builderUrlInput.value = val;
            updateBuilderPreview();
        }
        apiInputEl.value = '';
        if (autoMatchEnabled) scheduleAutoMatch();
    }

    function addTokenFromInput() {
        if (!tokenInputEl) return;
        const val = tokenInputEl.value.trim();
        if (!val) return;
        if (!customTokens.includes(val)) {
            customTokens.push(val);
            saveList(STORAGE_KEY_TOKENS, customTokens);
            renderTokenList();
            syncBuilderSelectors();
        }
        if (builderTokSelect) {
            builderTokSelect.value = val;
            updateBuilderPreview();
        }
        tokenInputEl.value = '';
        if (autoMatchEnabled) scheduleAutoMatch();
    }

    function createUI() {
        if (document.getElementById('m3u8-detector-panel')) return;

        panelEl = document.createElement('div');
        panelEl.id = 'm3u8-detector-panel';
        panelEl.style.cssText = [
            'position:fixed',
            'right:12px',
            'bottom:12px',
            'z-index:2147483647',
            'width:365px',
            'max-width:calc(100vw - 24px)',
            'max-height:78vh',
            'background:#14161f',
            'color:#f1f5f9',
            'border:1px solid #334155',
            'border-radius:10px',
            'box-shadow:0 8px 24px rgba(0,0,0,.45)',
            'font-family:system-ui,-apple-system,sans-serif',
            'font-size:12px',
            'display:flex',
            'flex-direction:column',
            'overflow:hidden'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#1e293b;border-bottom:1px solid #334155;font-weight:600;cursor:move;touch-action:none;user-select:none;';

        const title = document.createElement('span');
        title.innerHTML = '⠿ Media (<span id="m3u8-count">0</span>) • Tok (<span id="m3u8-tok-count">0</span>)';

        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:5px;';

        const cfgBtn = document.createElement('button');
        cfgBtn.type = 'button';
        cfgBtn.textContent = 'API/Tok';
        cfgBtn.style.cssText = 'background:#0f766e;color:#fff;border:none;border-radius:5px;padding:3px 7px;cursor:pointer;font-size:11px;';

        const matchBtn = document.createElement('button');
        matchBtn.type = 'button';
        matchBtn.textContent = 'Match';
        matchBtn.style.cssText = 'background:#4338ca;color:#fff;border:none;border-radius:5px;padding:3px 7px;cursor:pointer;font-size:11px;';
        matchBtn.onclick = () => {
            scanEnvironmentForTokens();
            scanDomResources();
            scanPageScriptsAndMedia();
            runAutoMatchApisAndTokens(true);
            setQuickStatus('Scan storage, DOM & auto-match dijalankan.');
        };

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';
        clearBtn.style.cssText = 'background:#334155;color:#fff;border:none;border-radius:5px;padding:3px 7px;cursor:pointer;font-size:11px;';
        clearBtn.onclick = () => {
            found.clear();
            detectedTokens.clear();
            testedPairs.clear();
            capturedJsonBodies.clear();
            renderFilterBar();
            renderList();
            renderTokenList();
            syncBuilderSelectors();
            syncJsSourceSelector();
            syncJsonSourceSelector();
            setQuickStatus('Daftar dibersihkan.');
        };

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.textContent = '−';
        toggleBtn.style.cssText = 'background:#475569;color:#fff;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:12px;';

        quickBarEl = document.createElement('div');
        quickBarEl.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:6px 8px;background:#111827;border-bottom:1px solid #1e293b;';

        const quickBtnRow = document.createElement('div');
        quickBtnRow.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;';

        const openJsPatchBtn = document.createElement('button');
        openJsPatchBtn.type = 'button';
        openJsPatchBtn.textContent = 'JS Editor';
        openJsPatchBtn.style.cssText = 'background:#9333ea;color:#fff;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;';
        openJsPatchBtn.onclick = () => openJsFloatingPanel('');

        const openJsonPatchBtn = document.createElement('button');
        openJsonPatchBtn.type = 'button';
        openJsonPatchBtn.textContent = 'JSON Editor';
        openJsonPatchBtn.style.cssText = 'background:#d97706;color:#fff;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;';
        openJsonPatchBtn.onclick = () => openJsonFloatingPanel('');

        const openStorageBtn = document.createElement('button');
        openStorageBtn.type = 'button';
        openStorageBtn.textContent = 'Storage Patch';
        openStorageBtn.style.cssText = 'background:#0284c7;color:#fff;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;';
        openStorageBtn.onclick = () => openStorageFloatingPanel('');

        const openLogBtn = document.createElement('button');
        openLogBtn.type = 'button';
        openLogBtn.textContent = 'Live Log';
        openLogBtn.style.cssText = 'background:#16a34a;color:#fff;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;';
        openLogBtn.onclick = openLogFloatingPanel;

        const clearTabBtn = document.createElement('button');
        clearTabBtn.type = 'button';
        clearTabBtn.textContent = 'Clear Cookie/Cache';
        clearTabBtn.style.cssText = 'background:#b91c1c;color:#fff;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:600;';
        clearTabBtn.onclick = clearActiveTabCookiesAndCache;

        const playLatestBtn = document.createElement('button');
        playLatestBtn.type = 'button';
        playLatestBtn.textContent = 'Play .m3u8';
        playLatestBtn.style.cssText = 'background:#059669;color:#fff;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:600;';
        playLatestBtn.onclick = () => {
            const m3u8 = getLatestM3u8Url();
            if (!m3u8) {
                setQuickStatus('Belum ada URL .m3u8 terdeteksi.', true);
                return;
            }
            copyText(m3u8);
            safeOpenUrl(m3u8, openInNewTab);
        };

        const expRow = document.createElement('div');
        expRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;padding-top:2px;border-top:1px solid #1e293b;';

        const expPollLabel = document.createElement('label');
        expPollLabel.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#fca5a5;cursor:pointer;font-weight:600;';
        const expPollCheck = document.createElement('input');
        expPollCheck.type = 'checkbox';
        expPollCheck.checked = stopServerPollingExp;
        expPollCheck.onchange = () => applyServerPollingToggle(expPollCheck.checked);
        expPollLabel.appendChild(expPollCheck);
        expPollLabel.appendChild(document.createTextNode('[EXP] Stop Server Poll (.js)'));

        const tabModeLabel = document.createElement('label');
        tabModeLabel.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#cbd5e1;cursor:pointer;';
        const tabModeCheck = document.createElement('input');
        tabModeCheck.type = 'checkbox';
        tabModeCheck.checked = openInNewTab;
        tabModeCheck.onchange = () => {
            openInNewTab = tabModeCheck.checked;
            updateBuilderPreview();
        };
        tabModeLabel.appendChild(tabModeCheck);
        tabModeLabel.appendChild(document.createTextNode('Tab'));

        statusLineEl = document.createElement('div');
        statusLineEl.textContent = stopServerPollingExp
            ? 'EXP ON: Server polling diblokir.'
            : 'Siap memantau JS, JSON, Storage & Live Log.';
        statusLineEl.style.cssText = 'font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

        quickBtnRow.appendChild(openJsPatchBtn);
        quickBtnRow.appendChild(openJsonPatchBtn);
        quickBtnRow.appendChild(openStorageBtn);
        quickBtnRow.appendChild(openLogBtn);
        quickBtnRow.appendChild(clearTabBtn);
        quickBtnRow.appendChild(playLatestBtn);

        expRow.appendChild(expPollLabel);
        expRow.appendChild(tabModeLabel);

        quickBarEl.appendChild(quickBtnRow);
        quickBarEl.appendChild(expRow);
        quickBarEl.appendChild(statusLineEl);

        filterBarEl = document.createElement('div');
        filterBarEl.style.cssText = 'display:flex;align-items:center;gap:5px;padding:6px 8px;background:#0f172a;border-bottom:1px solid #1e293b;overflow-x:auto;scrollbar-width:none;';

        configDrawerEl = document.createElement('div');
        configDrawerEl.style.cssText = 'display:none;flex-direction:column;gap:7px;padding:8px;background:#0b1120;border-bottom:1px solid #334155;max-height:280px;overflow-y:auto;';

        const builderHeaderRow = document.createElement('div');
        builderHeaderRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

        const builderTitle = document.createElement('span');
        builderTitle.textContent = 'Valid Link Builder (Preserve Params)';
        builderTitle.style.cssText = 'font-size:10px;font-weight:700;color:#38bdf8;text-transform:uppercase;';

        const autoToggleLabel = document.createElement('label');
        autoToggleLabel.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#cbd5e1;cursor:pointer;';
        const autoCheck = document.createElement('input');
        autoCheck.type = 'checkbox';
        autoCheck.checked = autoMatchEnabled;
        autoCheck.onchange = () => {
            autoMatchEnabled = autoCheck.checked;
            updateBuilderPreview();
            if (autoMatchEnabled) runAutoMatchApisAndTokens(false);
        };
        autoToggleLabel.appendChild(autoCheck);
        autoToggleLabel.appendChild(document.createTextNode('Auto-Match'));

        builderHeaderRow.appendChild(builderTitle);
        builderHeaderRow.appendChild(autoToggleLabel);

        templateSelect = document.createElement('select');
        templateSelect.style.cssText = 'width:100%;background:#1e293b;color:#38bdf8;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        templateSelect.onchange = () => {
            if (templateSelect.value && builderUrlInput) {
                builderUrlInput.value = templateSelect.value;
                updateBuilderPreview();
            }
        };

        builderUrlInput = document.createElement('input');
        builderUrlInput.type = 'text';
        builderUrlInput.placeholder = 'Full URL API (dengan ?vid=...&cdn=...&token=...)';
        builderUrlInput.value = builderState.url || '';
        builderUrlInput.style.cssText = 'width:100%;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';
        builderUrlInput.oninput = updateBuilderPreview;

        const builderSubRow = document.createElement('div');
        builderSubRow.style.cssText = 'display:flex;gap:5px;';

        builderTokSelect = document.createElement('select');
        builderTokSelect.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        builderTokSelect.onchange = updateBuilderPreview;

        builderExtraInput = document.createElement('input');
        builderExtraInput.type = 'text';
        builderExtraInput.placeholder = 'Extra: id=1&cdn=...';
        builderExtraInput.value = builderState.extra || '';
        builderExtraInput.style.cssText = 'width:125px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;';
        builderExtraInput.oninput = updateBuilderPreview;

        builderSubRow.appendChild(builderTokSelect);
        builderSubRow.appendChild(builderExtraInput);

        builderPreviewBox = document.createElement('div');
        builderPreviewBox.style.cssText = 'background:#020617;border:1px solid #334155;border-radius:5px;padding:5px 7px;font-size:10px;color:#7dd3fc;word-break:break-all;user-select:all;';

        const builderBtnRow = document.createElement('div');
        builderBtnRow.style.cssText = 'display:flex;gap:5px;';

        const copyBuiltBtn = document.createElement('button');
        copyBuiltBtn.type = 'button';
        copyBuiltBtn.textContent = 'Copy Link';
        copyBuiltBtn.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:10px;';
        copyBuiltBtn.onclick = () => {
            const url = updateBuilderPreview();
            if (!url) return;
            copyText(url);
            copyBuiltBtn.textContent = 'Copied!';
            setTimeout(() => (copyBuiltBtn.textContent = 'Copy Link'), 900);
        };

        const openBuiltBtn = document.createElement('button');
        openBuiltBtn.type = 'button';
        openBuiltBtn.textContent = 'Open Tab';
        openBuiltBtn.style.cssText = 'background:#059669;color:#fff;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:10px;';
        openBuiltBtn.onclick = () => {
            const url = updateBuilderPreview();
            if (url) safeOpenUrl(url, openInNewTab);
        };

        const testFetchBtn = document.createElement('button');
        testFetchBtn.type = 'button';
        testFetchBtn.textContent = 'Fetch & Extract';
        testFetchBtn.style.cssText = 'background:#7c3aed;color:#fff;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:10px;';
        testFetchBtn.onclick = async () => {
            const url = updateBuilderPreview();
            if (!url) return;
            testFetchBtn.textContent = 'Fetching...';
            try {
                await fetch(url);
            } catch (_) {
                queryApiWithGmXhr(url, builderTokSelect?.value || '');
                recordItem(url, 'manual-api', 'Built Link');
            } finally {
                testFetchBtn.textContent = 'Fetch & Extract';
            }
        };

        builderBtnRow.appendChild(copyBuiltBtn);
        builderBtnRow.appendChild(openBuiltBtn);
        builderBtnRow.appendChild(testFetchBtn);

        const apiRow = document.createElement('div');
        apiRow.style.cssText = 'display:flex;gap:5px;margin-top:2px;';

        apiInputEl = document.createElement('input');
        apiInputEl.type = 'text';
        apiInputEl.placeholder = 'Custom API URL / endpoint...';
        apiInputEl.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';
        apiInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') addApiFromInput(); });

        const addApiBtn = document.createElement('button');
        addApiBtn.type = 'button';
        addApiBtn.textContent = '+ API';
        addApiBtn.style.cssText = 'background:#0d9488;color:#fff;border:none;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:11px;';
        addApiBtn.onclick = addApiFromInput;

        apiTagsEl = document.createElement('div');
        apiTagsEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

        apiRow.appendChild(apiInputEl);
        apiRow.appendChild(addApiBtn);

        const tokRow = document.createElement('div');
        tokRow.style.cssText = 'display:flex;gap:5px;';

        tokenInputEl = document.createElement('input');
        tokenInputEl.type = 'text';
        tokenInputEl.placeholder = 'Tambah token manual...';
        tokenInputEl.style.cssText = 'flex:1;min-width:0;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:4px 7px;font-size:11px;outline:none;';
        tokenInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTokenFromInput(); });

        const addTokBtn = document.createElement('button');
        addTokBtn.type = 'button';
        addTokBtn.textContent = '+ Token';
        addTokBtn.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:11px;';
        addTokBtn.onclick = addTokenFromInput;

        tokenTagsEl = document.createElement('div');
        tokenTagsEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

        tokRow.appendChild(tokenInputEl);
        tokRow.appendChild(addTokBtn);

        configDrawerEl.appendChild(builderHeaderRow);
        configDrawerEl.appendChild(templateSelect);
        configDrawerEl.appendChild(builderUrlInput);
        configDrawerEl.appendChild(builderSubRow);
        configDrawerEl.appendChild(builderPreviewBox);
        configDrawerEl.appendChild(builderBtnRow);
        configDrawerEl.appendChild(apiRow);
        configDrawerEl.appendChild(apiTagsEl);
        configDrawerEl.appendChild(tokRow);
        configDrawerEl.appendChild(tokenTagsEl);

        listEl = document.createElement('div');
        listEl.style.cssText = 'padding:8px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;-webkit-overflow-scrolling:touch;';

        let cfgOpen = false;
        cfgBtn.onclick = () => {
            cfgOpen = !cfgOpen;
            configDrawerEl.style.display = cfgOpen ? 'flex' : 'none';
            if (cfgOpen) {
                syncTemplateSelector();
                renderApiTags();
                renderTokenList();
                syncBuilderSelectors();
            }
        };

        let minimized = false;
        toggleBtn.onclick = () => {
            minimized = !minimized;
            listEl.style.display = minimized ? 'none' : 'flex';
            quickBarEl.style.display = minimized ? 'none' : 'flex';
            filterBarEl.style.display = minimized ? 'none' : 'flex';
            if (minimized) configDrawerEl.style.display = 'none';
            else if (cfgOpen) configDrawerEl.style.display = 'flex';
            toggleBtn.textContent = minimized ? '+' : '−';
        };

        controls.appendChild(cfgBtn);
        controls.appendChild(matchBtn);
        controls.appendChild(clearBtn);
        controls.appendChild(toggleBtn);
        header.appendChild(title);
        header.appendChild(controls);

        panelEl.appendChild(header);
        panelEl.appendChild(quickBarEl);
        panelEl.appendChild(filterBarEl);
        panelEl.appendChild(configDrawerEl);
        panelEl.appendChild(listEl);
        document.documentElement.appendChild(panelEl);

        applySavedPosition(panelEl, STORAGE_KEY_POS);
        enableDrag(header, panelEl, STORAGE_KEY_POS);

        countEl = document.getElementById('m3u8-count');
        tokenCountEl = document.getElementById('m3u8-tok-count');
        syncTemplateSelector();
        renderApiTags();
        renderTokenList();
        syncBuilderSelectors();
        renderFilterBar();
        renderList();
    }

    function renderList() {
        if (!listEl || !countEl) return;
        countEl.textContent = String(found.size);
        listEl.innerHTML = '';

        const items = [...found.values()]
            .reverse()
            .filter(item => activeFilter === 'ALL' || item.ext === activeFilter);

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = activeFilter === 'ALL'
                ? 'Menunggu request resource / media...'
                : `Belum ada item berformat ${activeFilter}.`;
            empty.style.cssText = 'color:#94a3b8;text-align:center;padding:12px 4px;';
            listEl.appendChild(empty);
            return;
        }

        items.slice(0, 60).forEach(item => {
            const card = document.createElement('div');
            card.style.cssText = 'background:#0f172a;border:1px solid #1e293b;border-radius:7px;padding:7px;display:flex;flex-direction:column;gap:5px;';

            const meta = document.createElement('div');
            meta.style.cssText = 'display:flex;justify-content:space-between;color:#94a3b8;font-size:10px;';
            meta.textContent = `[${item.ext}] ${item.source} ${item.note ? '(' + item.note + ')' : ''} • ${item.time}`;

            const urlBox = document.createElement('div');
            urlBox.textContent = item.url;
            urlBox.style.cssText = 'word-break:break-all;color:#38bdf8;user-select:all;line-height:1.35;max-height:72px;overflow:hidden;';

            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.textContent = 'Copy';
            copyBtn.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:11px;';
            copyBtn.onclick = () => {
                copyText(item.url);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => (copyBtn.textContent = 'Copy'), 900);
            };

            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.textContent = 'Open';
            openBtn.style.cssText = 'background:#334155;color:#e2e8f0;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:11px;';
            openBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                safeOpenUrl(item.url, openInNewTab);
            };

            actions.appendChild(copyBtn);
            actions.appendChild(openBtn);

            if (item.ext === '.js' || /\.js(\?|#|$)/i.test(item.url)) {
                const patchJsBtn = document.createElement('button');
                patchJsBtn.type = 'button';
                patchJsBtn.textContent = 'Patch .JS';
                patchJsBtn.style.cssText = 'background:#9333ea;color:#fff;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:11px;font-weight:600;';
                patchJsBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openJsFloatingPanel(item.url);
                };
                actions.appendChild(patchJsBtn);
            }

            if (item.ext === '.json' || item.ext === 'API' || capturedJsonBodies.has(item.url) || /\.json(\?|#|$)/i.test(item.url)) {
                const editJsonBtn = document.createElement('button');
                editJsonBtn.type = 'button';
                editJsonBtn.textContent = 'Edit JSON';
                editJsonBtn.style.cssText = 'background:#d97706;color:#fff;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:11px;font-weight:600;';
                editJsonBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openJsonFloatingPanel(item.url);
                };
                actions.appendChild(editJsonBtn);
            }

            card.appendChild(meta);
            card.appendChild(urlBox);
            card.appendChild(actions);
            listEl.appendChild(card);
        });
    }

    scanLocalAndSessionStorage();

    let domScanTimer = null;
    function scheduleDomScan() {
        if (domScanTimer) return;
        domScanTimer = setTimeout(() => {
            domScanTimer = null;
            scanDomResources();
        }, 700);
    }

    function init() {
        createUI();
        ensureJsFloatingPanel();
        ensureJsonFloatingPanel();
        ensureStorageFloatingPanel();
        ensureLogFloatingPanel();
        scanEnvironmentForTokens();
        scanDomResources();
        scanPageScriptsAndMedia();
        runAutoSavedPatches();
        if (autoMatchEnabled) scheduleAutoMatch();

        const mo = new MutationObserver((mutations) => {
            for (let i = 0; i < mutations.length; i++) {
                if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
                    scheduleDomScan();
                    break;
                }
            }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    window.addEventListener('DOMContentLoaded', init);

    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        init();
    }
})();
