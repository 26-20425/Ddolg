// YouTube + Poki 전용 웹 프록시 (외부 패키지 없음, Node 18+)
// 실행: node server.js  →  http://localhost:8080
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const PORT = process.env.PORT || 8080;

// 허용 도메인 (이 도메인과 하위 도메인만 프록시됨)
const ALLOWED = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'ytimg.com', 'googlevideo.com',
  'ggpht.com', 'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'google.com',
  'poki.com', 'poki-gdn.com', 'poki.io', 'poki-cdn.com',
  'crazygames.com',
  // 네이버 웹툰 (로그인 서버 nid.naver.com 은 일부러 제외)
  'comic.naver.com', 'apis.naver.com', 'pstatic.net', 'naver.net',
];
const allowed = (h) => ALLOWED.some((d) => h === d || h.endsWith('.' + d));

const toProxy = (url, base) => {
  try {
    if (/^(data|blob|javascript|about|mailto|#)/i.test(url)) return url;
    const u = new URL(url, base);
    if (!/^https?:$/.test(u.protocol) || !allowed(u.hostname)) return url;
    return '/p/' + encodeURIComponent(u.origin) + u.pathname + u.search + u.hash;
  } catch { return url; }
};

// 브라우저에서 실행되는 스크립트: fetch/XHR/동적 src 등을 프록시 경로로 변환
function client(real) {
  const ORIGIN = location.origin;
  const px = (u) => {
    try {
      u = String(u);
      if (u.startsWith('/p/') || u.startsWith(ORIGIN + '/p/')) return u;
      if (/^(data|blob|javascript|about|mailto|#)/i.test(u)) return u;
      const a = new URL(u, real);
      if (!/^https?:$/.test(a.protocol)) return u;
      return '/p/' + encodeURIComponent(a.origin) + a.pathname + a.search + a.hash;
    } catch { return u; }
  };
  const f = window.fetch;
  window.fetch = (i, o) => f(i instanceof Request ? new Request(px(i.url), i) : px(i), o);
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { return xo.call(this, m, px(u), ...r); };
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    if (/^(src|href|action|poster)$/i.test(n)) v = px(v);
    return sa.call(this, n, v);
  };
  [[HTMLScriptElement, 'src'], [HTMLImageElement, 'src'], [HTMLIFrameElement, 'src'],
   [HTMLLinkElement, 'href'], [HTMLAnchorElement, 'href'], [HTMLSourceElement, 'src'],
   [HTMLMediaElement, 'src'], [HTMLFormElement, 'action'], [HTMLEmbedElement, 'src']]
    .forEach(([C, p]) => {
      const d = Object.getOwnPropertyDescriptor(C.prototype, p);
      if (d && d.set) Object.defineProperty(C.prototype, p, { ...d, set(v) { d.set.call(this, px(v)); } });
    });
  ['pushState', 'replaceState'].forEach((k) => {
    const o = history[k];
    history[k] = function (s, t, u) { return o.call(this, s, t, u == null ? u : px(u)); };
  });
  const wo = window.open; window.open = (u, ...r) => wo.call(window, u ? px(u) : u, ...r);
  const W = window.Worker;
  window.Worker = function (u, o) { return new W(px(u), o); };
  const sb = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (sb) navigator.sendBeacon = (u, d) => sb(px(u), d);
}

const rewriteHtml = (html, base) => {
  html = html
    .replace(/\s(integrity|nonce)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '')
    .replace(/(\s(?:href|src|action|poster|data-src)\s*=\s*)(["'])(.*?)\2/gi,
      (_, a, q, v) => a + q + toProxy(v.replace(/&amp;/g, '&'), base).replace(/&/g, '&amp;') + q)
    .replace(/(\ssrcset\s*=\s*)(["'])(.*?)\2/gi, (_, a, q, v) =>
      a + q + v.split(',').map((s) => {
        const [u, ...r] = s.trim().split(/\s+/);
        return [toProxy(u, base), ...r].join(' ');
      }).join(', ') + q);
  const inject = `<script>(${client})(${JSON.stringify(base)})</script>`;
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => m + inject)
    : inject + html;
};
const rewriteCss = (css, base) =>
  css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_, q, u) => `url(${q}${toProxy(u, base)}${q})`);

const HOME = `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Proxy</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 20px;text-align:center}
input{width:100%;box-sizing:border-box;padding:14px;font-size:16px;border:1px solid #888;border-radius:10px}
.row{display:flex;gap:8px;margin-top:12px;justify-content:center}
button,a.b{padding:10px 18px;border:0;border-radius:10px;background:#222;color:#fff;font-size:15px;text-decoration:none;cursor:pointer}
small{color:#777;display:block;margin-top:16px}</style>
<h2>YouTube · Poki</h2>
<form action="/go"><input name="q" placeholder="유튜브 링크 / 검색어 / poki 주소" autofocus>
<div class="row"><button>이동</button><a class="b" href="/go?q=https://www.youtube.com/">YouTube</a>
<a class="b" href="/go?q=https://poki.com/">Poki</a></div></form>
<small>유튜브 영상 링크를 붙여넣으면 재생 페이지로 바로 연결됩니다.</small></html>`;

function go(q) {
  q = (q || '').trim();
  if (!q) return '/';
  if (!/^https?:\/\//i.test(q) && !/^[\w-]+(\.[\w-]+)+(\/|$)/.test(q))
    return toProxy('https://www.youtube.com/results?search_query=' + encodeURIComponent(q));
  const u = new URL(/^https?:/i.test(q) ? q : 'https://' + q);
  let id = null;
  if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
  else if (/youtube\.com$/.test(u.hostname) && u.pathname === '/watch') id = u.searchParams.get('v');
  if (id) return toProxy('https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1');
  return toProxy(u.href);
}

http.createServer((req, res) => {
  const fail = (c, m) => { res.writeHead(c, { 'content-type': 'text/plain; charset=utf-8' }); res.end(m); };

  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HOME); }
  if (req.url.startsWith('/go')) {
    const q = new URL(req.url, 'http://x').searchParams.get('q');
    res.writeHead(302, { location: go(q) }); return res.end();
  }

  let m = req.url.match(/^\/p\/([^/?]+)(.*)$/);
  if (!m) {
    // 프록시 경로가 빠진 요청 → Referer 기준으로 다시 프록시 경로로 보냄
    const r = (req.headers.referer || '').match(/\/p\/([^/?]+)/);
    if (r) { res.writeHead(307, { location: '/p/' + r[1] + req.url }); return res.end(); }
    return fail(404, 'Not found');
  }

  let origin;
  try { origin = new URL(decodeURIComponent(m[1])); } catch { return fail(400, 'Bad URL'); }
  if (!allowed(origin.hostname)) return fail(403, '허용되지 않은 사이트입니다.');
  let rest = m[2] || '/';
  if (rest[0] === '?') rest = '/' + rest;
  const target = new URL(rest, origin.origin);

  const h = { ...req.headers };
  delete h.host; delete h['x-forwarded-for']; delete h['x-forwarded-proto'];
  h['accept-encoding'] = 'gzip, deflate, br';
  h.origin = origin.origin;
  // 이미지 등은 원래 페이지(예: comic.naver.com)를 Referer로 보내야 핫링크 차단에 안 걸림
  const cr = (req.headers.referer || '').match(/\/p\/([^/?]+)/);
  try { h.referer = (cr ? new URL(decodeURIComponent(cr[1])).origin : origin.origin) + '/'; }
  catch { h.referer = origin.origin + '/'; }
  if (!h.origin || req.method === 'GET' || req.method === 'HEAD') { if (!req.headers.origin) delete h.origin; }

  const up = https.request({
    hostname: target.hostname, port: 443, path: target.pathname + target.search,
    method: req.method, headers: h,
  }, (ur) => {
    const hd = { ...ur.headers };
    ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options',
     'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
     'cross-origin-resource-policy', 'report-to', 'nel'].forEach((k) => delete hd[k]);
    hd['access-control-allow-origin'] = req.headers.origin || '*';
    hd['access-control-allow-credentials'] = 'true';
    if (hd.location) hd.location = toProxy(hd.location, target.href);
    if (hd['set-cookie'])
      hd['set-cookie'] = hd['set-cookie'].map((c) => c.replace(/;\s*domain=[^;]*/i, '').replace(/;\s*secure/i, '').replace(/;\s*samesite=[^;]*/i, ''));

    const type = String(hd['content-type'] || '');
    const isHtml = /text\/html/i.test(type), isCss = /text\/css/i.test(type);
    if (!isHtml && !isCss) { res.writeHead(ur.statusCode, hd); return ur.pipe(res); }

    const enc = hd['content-encoding'];
    let s = ur;
    if (enc === 'gzip') s = ur.pipe(zlib.createGunzip());
    else if (enc === 'br') s = ur.pipe(zlib.createBrotliDecompress());
    else if (enc === 'deflate') s = ur.pipe(zlib.createInflate());
    const chunks = [];
    s.on('data', (c) => chunks.push(c));
    s.on('error', () => fail(502, 'decode error'));
    s.on('end', () => {
      const txt = Buffer.concat(chunks).toString('utf8');
      const out = isHtml ? rewriteHtml(txt, target.href) : rewriteCss(txt, target.href);
      delete hd['content-encoding']; delete hd['content-length'];
      res.writeHead(ur.statusCode, hd); res.end(out);
    });
  });
  up.on('error', (e) => { if (!res.headersSent) fail(502, '업스트림 오류: ' + e.message); else res.end(); });
  req.pipe(up);
}).listen(PORT, '0.0.0.0', () => console.log('Proxy running: http://localhost:' + PORT));
