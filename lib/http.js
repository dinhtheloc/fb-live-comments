// Vài helper HTTP nhỏ, chỉ để các service không phải lặp lại cùng một
// đoạn code đọc body / trả JSON.

/** Đọc toàn bộ body của request rồi parse JSON. */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(`body không phải JSON hợp lệ: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

/** Trả về một response JSON. */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Gọi POST JSON tới service khác. Ném lỗi nếu status không phải 2xx. */
export async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`POST ${url} trả về ${response.status}`);
  }
  return response.json();
}

/** Gọi GET JSON tới service khác. */
export async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} trả về ${response.status}`);
  }
  return response.json();
}

/** Tách pathname và query của một request. */
export function parseUrl(req) {
  return new URL(req.url, 'http://placeholder');
}

/**
 * Mở cổng, kèm thông báo dễ hiểu khi cổng đã bị chiếm.
 * (Trên macOS, cổng 5000 và 7000 mặc định bị AirPlay Receiver giữ.)
 */
export function listen(server, port, log, description) {
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      log.error(`cổng ${port} đang bị tiến trình khác chiếm.`);
      log.error(`xem ai đang giữ:  lsof -nP -iTCP:${port} -sTCP:LISTEN`);
      log.error(`hoặc đổi cổng trong config.js`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, () => log.info(description));
}
