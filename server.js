require('dotenv').config();
const http = require('http');
const path = require('path');
const { createApiHandler, seedInitialUsers } = require('./src/api');
const { json } = require('./src/utils');

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_ADMIN_DIST_DIR = path.join(__dirname, 'web-admin', 'dist');

function staticHandler(req, res, pathname) {
  const fs = require('fs');
  if (!fs.existsSync(WEB_ADMIN_DIST_DIR)) {
    return json(res, 503, {
      error: 'Web admin app is not built.',
      hint: 'Run `npm run web:build` to serve web-admin from this server, or use `npm run web:dev` for development.'
    });
  }

  const normalized = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(WEB_ADMIN_DIST_DIR, normalized);
  const resolved = path.resolve(filePath);
  const root = path.resolve(WEB_ADMIN_DIST_DIR);

  if (!resolved.startsWith(root)) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }

  let target = resolved;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(WEB_ADMIN_DIST_DIR, 'index.html');
    if (!fs.existsSync(target)) {
      json(res, 404, { error: 'Not found' });
      return;
    }
  }

  const ext = path.extname(target).toLowerCase();
  const mime =
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(target).pipe(res);
}

const apiHandler = createApiHandler();

function setApiCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const server = http.createServer(async (req, res) => {
  try {
    const { URL } = require('url');
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsed.pathname;
    const query = Object.fromEntries(parsed.searchParams.entries());
    if (pathname.startsWith('/api/')) {
      setApiCorsHeaders(res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      return await apiHandler(req, res, pathname, query);
    }
    return staticHandler(req, res, pathname);
  } catch (err) {
    json(res, 500, { error: 'Internal server error', details: err.message });
  }
});

let currentHost = HOST;
let currentPort = PORT;
let retryCount = 0;
const MAX_PORT_RETRIES = 20;

server.on('error', err => {
  if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES') && retryCount < MAX_PORT_RETRIES) {
    retryCount += 1;
    currentPort += 1;
    // eslint-disable-next-line no-console
    console.warn(`Cannot use ${currentHost}:${currentPort - 1} (${err.code}). Retrying on http://${currentHost}:${currentPort}`);
    server.listen(currentPort, currentHost);
    return;
  }

  throw err;
});

async function startServer() {
  await seedInitialUsers();
  server.listen(currentPort, currentHost, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running at http://${currentHost}:${currentPort}`);
  });
}

startServer().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err.message || err);
  process.exit(1);
});
