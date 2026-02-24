export const config = {
  runtime: 'edge',
};

const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
    'access-control-allow-headers': '*',
  }),
};

function newUrl(urlStr) {
  try {
    return new URL(urlStr);
  } catch (err) {
    return null;
  }
}

/**
 * 核心代理函数：处理请求转发、递归重定向和 CORS 注入
 */
async function proxy(urlObj, reqInit) {
  const res = await fetch(urlObj.href, reqInit);
  const resHeaderNew = new Headers(res.headers);

  const status = res.status;

  // 递归处理重定向 (Status 301, 302, 307, 308)
  if (resHeaderNew.has('location')) {
    let _location = resHeaderNew.get('location');
    return proxy(newUrl(_location), { ...reqInit, redirect: 'follow' });
  }

  // 注入跨域头，允许前端调用
  resHeaderNew.set('access-control-expose-headers', '*');
  resHeaderNew.set('access-control-allow-origin', '*');

  // 移除安全策略限制，防止目标站点的策略干扰代理页面的渲染
  resHeaderNew.delete('content-security-policy');
  resHeaderNew.delete('content-security-policy-report-only');
  resHeaderNew.delete('clear-site-data');

  return new Response(res.body, {
    status,
    headers: resHeaderNew,
  });
}

export default async function handler(req) {
  const { pathname, search, href } = new URL(req.url);

  // 1. 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response(null, PREFLIGHT_INIT);
  }

  // 2. 提取并修复 URL
  // Vercel 会合并斜杠，我们需要把 https:/example.com 还原成 https://example.com
  let targetPath = href.split('/x/')[1]; 
  if (!targetPath) {
    return new Response('Usage: /x/https://example.com', { status: 400 });
  }

  // 修复被合并的斜杠 (正则匹配 http:/ 或 https:/ 后面不是双斜杠的情况)
  let fixedUrlStr = targetPath.replace(/^(https?):\/+(?!\/)/, '$1://');

  const urlObj = newUrl(fixedUrlStr);
  if (!urlObj) {
    return new Response(`Invalid URL: ${fixedUrlStr}`, { status: 400 });
  }

  // 3. 构造请求参数
  const reqHeaderNew = new Headers(req.headers);
  // 伪造 IP 信息，绕过某些站点的简单限制
  reqHeaderNew.set('x-forwarded-for', '1.2.3.4');
  reqHeaderNew.set('x-real-ip', '1.2.3.4');
  // 必须删除 host，否则目标服务器会因为 Host 不匹配拒绝访问
  reqHeaderNew.delete('host');

  const reqInit = {
    method: req.method,
    headers: reqHeaderNew,
    redirect: 'manual', // 手动处理，以便在 proxy 函数中注入跨域头
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : null,
  };

  return proxy(urlObj, reqInit);
}
