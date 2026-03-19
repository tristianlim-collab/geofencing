const crypto = require('crypto');

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function text(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...extraHeaders
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};

  return header.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);

  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.maxAgeSeconds) parts.push(`Max-Age=${options.maxAgeSeconds}`);

  const existing = res.getHeader('Set-Cookie');
  const next = existing
    ? Array.isArray(existing)
      ? [...existing, parts.join('; ')]
      : [existing, parts.join('; ')]
    : parts.join('; ');

  res.setHeader('Set-Cookie', next);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAgeSeconds: 0, sameSite: 'Lax' });
}

function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = (storedHash || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeToMinutes(timeStr) {
  const [h, m] = (timeStr || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function routeMatch(pathname, pattern) {
  const p1 = pathname.split('/').filter(Boolean);
  const p2 = pattern.split('/').filter(Boolean);
  if (p1.length !== p2.length) return null;

  const params = {};
  for (let i = 0; i < p1.length; i += 1) {
    if (p2[i].startsWith(':')) {
      params[p2[i].slice(1)] = decodeURIComponent(p1[i]);
    } else if (p1[i] !== p2[i]) {
      return null;
    }
  }
  return params;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const earthRadius = 6_371_000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, faceDescriptor, ...rest } = user;
  return {
    ...rest,
    faceEnrolled: Boolean(faceDescriptor)
  };
}

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function isWithinRange(dateStr, fromStr, toStr) {
  if (!fromStr && !toStr) return true;
  const t = new Date(`${dateStr}T00:00:00`).getTime();
  if (fromStr && t < new Date(`${fromStr}T00:00:00`).getTime()) return false;
  if (toStr && t > new Date(`${toStr}T00:00:00`).getTime()) return false;
  return true;
}

// Ray-casting algorithm for Point in Polygon
function isPointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

module.exports = {
  clearCookie,
  csvEscape,
  dateKey,
  hashPassword,
  haversineMeters,
  isPointInPolygon,
  isWithinRange,
  json,
  nowMinutes,
  parseBody,
  parseCookies,
  randomId,
  routeMatch,
  safeUser,
  setCookie,
  text,
  timeToMinutes,
  verifyPassword
};
