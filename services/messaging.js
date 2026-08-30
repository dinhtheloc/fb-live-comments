// Realtime Messaging Service.
//
// Đây là nơi giữ các kết nối SSE đang mở. Mỗi instance chỉ biết về những
// người xem đang cắm vào CHÍNH NÓ — nó không biết gì về các instance khác.
//
// SSE (Server-Sent Events) là gì:
//   - Client gọi GET một lần, server KHÔNG đóng response.
//   - Server cứ thế ghi thêm text vào response đó khi có dữ liệu mới.
//   - Định dạng mỗi sự kiện:  "data: <chuỗi>\n\n"  (hai xuống dòng để kết thúc)
//   - Trình duyệt có sẵn EventSource để đọc; ở đây client CLI tự parse.
//
// Vì sao SSE mà không phải WebSocket: comment chỉ chảy một chiều
// server -> client (chiều ngược lại đã có POST /create rồi). SSE chạy trên
// HTTP thường nên đi qua load balancer, proxy, CDN mà không cần cấu hình gì
// đặc biệt.

import http from 'node:http';
import { createLogger } from '../lib/log.js';
import { readJson, sendJson, parseUrl, listen } from '../lib/http.js';

const port = Number(process.argv[2]);
if (!port) throw new Error('cách dùng: node services/messaging.js <port>');

const log = createLogger(`messaging:${port}`);

// videoId -> tập các response đang mở của người xem video đó.
// Đây chính là "phòng chat" của mỗi live video, và nó chỉ tồn tại trong RAM
// của đúng process này.
const rooms = new Map();

function subscribe(videoId, res) {
  // Header bắt buộc của SSE.
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // Tắt buffering của proxy — nếu proxy gom dữ liệu lại thì realtime
    // hết realtime.
    'x-accel-buffering': 'no',
  });
  // Đẩy ngay một sự kiện để client biết đã kết nối xong.
  res.write(`event: connected\ndata: ${JSON.stringify({ videoId, server: port })}\n\n`);

  const room = rooms.get(videoId) ?? new Set();
  room.add(res);
  rooms.set(videoId, room);

  log.info(`+ người xem mới cho videoId=${videoId} (phòng này giờ có ${room.size})`);

  // Ping định kỳ để kết nối không bị proxy/OS đóng vì tưởng đã chết.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  // Dọn dẹp khi client ngắt. Không dọn thì rò rỉ bộ nhớ và ghi vào socket
  // đã chết.
  res.on('close', () => {
    clearInterval(heartbeat);
    room.delete(res);
    if (room.size === 0) rooms.delete(videoId);
    log.info(`- người xem rời videoId=${videoId} (còn ${room.size})`);
  });
}

function broadcast(comment) {
  const room = rooms.get(comment.videoId);
  if (!room || room.size === 0) {
    log.info(`videoId=${comment.videoId} không có ai đang xem ở server này`);
    return 0;
  }

  const payload = `data: ${JSON.stringify(comment)}\n\n`;
  for (const res of room) res.write(payload);

  log.info(`phát comment của ${comment.author} tới ${room.size} người xem`);
  return room.size;
}

const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);

  try {
    if (req.method === 'GET' && url.pathname === '/stream') {
      const videoId = url.searchParams.get('videoId');
      if (!videoId) return sendJson(res, 400, { error: 'thiếu videoId' });
      return subscribe(videoId, res);
    }

    if (req.method === 'POST' && url.pathname === '/broadcast') {
      const comment = await readJson(req);
      return sendJson(res, 200, { subscribers: broadcast(comment) });
    }

    if (req.method === 'GET' && url.pathname === '/stats') {
      return sendJson(res, 200, {
        port,
        rooms: [...rooms].map(([videoId, room]) => ({ videoId, subscribers: room.size })),
      });
    }

    sendJson(res, 404, { error: 'không có route này' });
  } catch (error) {
    log.error(error.message);
    sendJson(res, 500, { error: error.message });
  }
});

// SSE là kết nối sống lâu, đừng để Node tự đóng vì "idle".
server.headersTimeout = 0;
server.requestTimeout = 0;
server.timeout = 0;

listen(server, port, log, `sẵn sàng trên :${port}`);
