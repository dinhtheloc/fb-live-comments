// Comment Management Service.
//
// Nhiệm vụ trong sơ đồ: "When a new comment is posted, persist in DB and
// send to dispatcher."
//
// Thứ tự hai việc đó rất quan trọng:
//   1. GHI DB TRƯỚC. Nếu ghi hỏng thì coi như comment chưa từng tồn tại,
//      không được phát cho ai cả.
//   2. Đẩy sang dispatcher SAU. Nếu bước này hỏng, comment vẫn còn trong
//      DB — người xem chỉ không thấy nó realtime, nhưng reload trang là có.
//
// Ngược lại (phát trước, ghi sau) sẽ dẫn tới cảnh comment hiện trên màn
// hình rồi biến mất khi reload. Sai kiểu đó khó chịu hơn nhiều.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { dbUrl, dispatcherUrl } from '../config.js';
import { createLogger } from '../lib/log.js';
import { readJson, sendJson, postJson, getJson, parseUrl } from '../lib/http.js';

const port = Number(process.argv[2]);
if (!port) throw new Error('cách dùng: node services/comment-service.js <port>');

const log = createLogger(`comment-service:${port}`);

async function createComment({ videoId, author, content }) {
  const comment = {
    commentId: randomUUID(),
    videoId,
    author,
    content,
    createdAt: new Date().toISOString(),
  };

  log.info(`nhận comment mới cho videoId=${videoId} từ ${author}`);

  // Bước 1: ghi bền vững. Lỗi ở đây thì dừng hẳn.
  await postJson(`${dbUrl}/put`, comment);
  log.info(`đã ghi DB, commentId=${comment.commentId.slice(0, 8)}`);

  // Bước 2: báo dispatcher để phát realtime. Lỗi ở đây không làm mất
  // comment, nên chỉ ghi nhận rồi đi tiếp.
  try {
    const result = await postJson(`${dispatcherUrl}/dispatch`, comment);
    log.info(`đã chuyển cho dispatcher -> ${result.deliveredTo}`);
    return { comment, delivered: true };
  } catch (error) {
    log.error(`dispatcher lỗi (comment vẫn an toàn trong DB): ${error.message}`);
    return { comment, delivered: false };
  }
}

const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);

  try {
    if (req.method === 'POST' && url.pathname === '/create') {
      const body = await readJson(req);
      if (!body.videoId || !body.content) {
        return sendJson(res, 400, { error: 'cần có videoId và content' });
      }
      const { comment, delivered } = await createComment({
        videoId: body.videoId,
        author: body.author ?? 'ẩn danh',
        content: body.content,
      });
      return sendJson(res, 201, { ...comment, delivered });
    }

    // Đọc lịch sử comment. Đường này KHÔNG đi qua messaging service —
    // realtime và lịch sử là hai con đường tách biệt.
    if (req.method === 'GET' && url.pathname === '/comments') {
      const videoId = url.searchParams.get('videoId');
      if (!videoId) return sendJson(res, 400, { error: 'thiếu videoId' });
      const data = await getJson(`${dbUrl}/comments?videoId=${encodeURIComponent(videoId)}`);
      return sendJson(res, 200, data);
    }

    sendJson(res, 404, { error: 'không có route này' });
  } catch (error) {
    log.error(error.message);
    sendJson(res, 503, { error: error.message });
  }
});

server.listen(port, () => {
  log.info(`sẵn sàng trên :${port}`);
});
