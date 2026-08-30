// Load Balancer — layer 7.
//
// "Layer 7" nghĩa là nó đọc được nội dung HTTP (method, path, query), chứ
// không chỉ chuyển tiếp gói TCP mù như layer 4. Nhờ vậy nó định tuyến khác
// nhau cho hai loại traffic:
//
//   POST /create     -> round-robin sang comment service bất kỳ.
//                       Request nào cũng như request nào, ai xử lý cũng được.
//
//   GET  /subscribe  -> KHÔNG được round-robin.
//                       Người xem cùng một video PHẢI vào cùng một messaging
//                       server, nếu không dispatcher biết gửi comment đi đâu?
//                       Nên ở đây định tuyến bằng consistent hashing trên
//                       videoId — đúng cái ring mà dispatcher dùng.
//
// Đây là toàn bộ mấu chốt của kiến trúc này. Load balancer và dispatcher
// không trao đổi thông tin gì với nhau. Chúng chỉ cùng chạy một phép tính
// trên cùng một danh sách node, nên luôn ra cùng một đáp án.

import http from 'node:http';
import { config, commentServiceUrls, messagingNodes, dispatcherUrl } from '../config.js';
import { createRing } from '../lib/hashring.js';
import { createLogger } from '../lib/log.js';
import { sendJson, getJson, parseUrl, listen } from '../lib/http.js';

const log = createLogger('load-balancer');

// Cùng danh sách node, cùng thuật toán -> cùng kết quả với dispatcher.
const ring = createRing(messagingNodes);

// Con trỏ round-robin cho nhóm comment service.
let nextCommentService = 0;
function pickCommentService() {
  const url = commentServiceUrls[nextCommentService];
  nextCommentService = (nextCommentService + 1) % commentServiceUrls.length;
  return url;
}

/** Chuyển tiếp nguyên vẹn request sang backend, kể cả stream SSE. */
function proxy(req, res, targetBase, targetPath) {
  const target = new URL(targetPath, targetBase);

  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      // pipe chứ không gom vào bộ nhớ: với SSE thì response không bao giờ
      // kết thúc, gom lại là treo vĩnh viễn.
      upstreamRes.pipe(res);
    }
  );

  upstream.on('error', (error) => {
    log.error(`không gọi được ${targetBase}: ${error.message}`);
    if (!res.headersSent) sendJson(res, 502, { error: `backend lỗi: ${error.message}` });
    else res.end();
  });

  // Client ngắt -> đóng luôn kết nối tới backend, đừng để nó treo lơ lửng.
  res.on('close', () => upstream.destroy());

  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);

  // --- Traffic ghi: ai xử lý cũng được ---
  if (url.pathname === '/create' || url.pathname === '/comments') {
    const target = pickCommentService();
    log.info(`${req.method} ${url.pathname} --round-robin--> ${target}`);
    return proxy(req, res, target, req.url);
  }

  // --- Traffic realtime: phải đúng server, không được round-robin ---
  if (url.pathname === '/subscribe') {
    const videoId = url.searchParams.get('videoId');
    if (!videoId) return sendJson(res, 400, { error: 'thiếu videoId' });

    const target = ring.get(videoId);
    log.info(`SSE videoId=${videoId} --hash ring--> ${target}`);
    return proxy(req, res, target, `/stream?videoId=${encodeURIComponent(videoId)}`);
  }

  // --- Endpoint để học: chứng minh LB và dispatcher chọn giống nhau ---
  if (url.pathname === '/route') {
    const videoId = url.searchParams.get('videoId');
    if (!videoId) return sendJson(res, 400, { error: 'thiếu videoId' });

    const loadBalancerPicks = ring.get(videoId);
    let dispatcherPicks = null;
    try {
      const data = await getJson(`${dispatcherUrl}/route?videoId=${encodeURIComponent(videoId)}`);
      dispatcherPicks = data.target;
    } catch (error) {
      log.error(`không hỏi được dispatcher: ${error.message}`);
    }

    return sendJson(res, 200, {
      videoId,
      loadBalancerPicks,
      dispatcherPicks,
      agree: loadBalancerPicks === dispatcherPicks,
    });
  }

  sendJson(res, 404, {
    error: 'không có route này',
    routes: ['POST /create', 'GET /subscribe?videoId=', 'GET /comments?videoId=', 'GET /route?videoId='],
  });
});

// SSE cần kết nối sống lâu.
server.headersTimeout = 0;
server.requestTimeout = 0;
server.timeout = 0;

listen(server, config.loadBalancer, log, `sẵn sàng trên :${config.loadBalancer} — đây là cổng duy nhất client cần biết`);
