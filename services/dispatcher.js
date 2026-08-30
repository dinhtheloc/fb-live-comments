// Dispatcher.
//
// Trong sơ đồ: "responsible for sending to correct messaging servers",
// và mũi tên đi xuống ghi rõ "HTTPS (not pub/sub)".
//
// Vì sao không dùng pub/sub? Vì với pub/sub, comment của một video sẽ được
// bắn tới TẤT CẢ messaging server, rồi 99% trong số đó phát hiện mình
// không giữ người xem nào của video này và vứt đi. Tốn băng thông và tốn
// CPU tỉ lệ thuận với số server.
//
// Thay vào đó, dispatcher TỰ TÍNH ra server nào đang giữ người xem của
// video này, rồi gọi HTTP thẳng tới đúng một server đó.
//
// Nó tính được là nhờ consistent hashing — và điều này chỉ chạy đúng vì
// load balancer dùng CHÍNH XÁC cùng một ring khi xếp người xem vào server.
// Hai bên không hề nói chuyện với nhau; chúng chỉ cùng chạy một phép tính.

import http from 'node:http';
import { config, messagingNodes } from '../config.js';
import { createRing } from '../lib/hashring.js';
import { createLogger } from '../lib/log.js';
import { readJson, sendJson, postJson, parseUrl } from '../lib/http.js';

const log = createLogger('dispatcher');

// Ring dựng từ danh sách node trong config.js — hệt như bên load balancer.
const ring = createRing(messagingNodes);

const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);

  try {
    if (req.method === 'POST' && url.pathname === '/dispatch') {
      const comment = await readJson(req);

      // Đây là toàn bộ "trí tuệ" của dispatcher: một lời gọi hàm.
      const target = ring.get(comment.videoId);

      log.info(`videoId=${comment.videoId} --hash ring--> ${target}`);

      const result = await postJson(`${target}/broadcast`, comment);
      log.info(`${target} đã phát tới ${result.subscribers} người xem`);

      return sendJson(res, 200, { deliveredTo: target, subscribers: result.subscribers });
    }

    // Chỉ để debug: xem videoId này rơi vào server nào mà không cần gửi gì.
    if (req.method === 'GET' && url.pathname === '/route') {
      const videoId = url.searchParams.get('videoId');
      if (!videoId) return sendJson(res, 400, { error: 'thiếu videoId' });
      return sendJson(res, 200, { videoId, target: ring.get(videoId), nodes: ring.nodes });
    }

    sendJson(res, 404, { error: 'không có route này' });
  } catch (error) {
    log.error(error.message);
    sendJson(res, 502, { error: error.message });
  }
});

server.listen(config.dispatcher, () => {
  log.info(`sẵn sàng trên :${config.dispatcher}`);
  log.info(`ring có ${messagingNodes.length} node: ${messagingNodes.join(', ')}`);
});
