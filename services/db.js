// Comments DB — mô phỏng DynamoDB bằng bộ nhớ.
//
// Trong sơ đồ gốc, bảng Comment có:
//   commentId  (PK của item)
//   videoId    (shard key / partition key)
//   content
//   author
//   createdAt  (SK - sort key)
//
// Ba khái niệm cần thấy ở đây:
//
// 1. PARTITION KEY quyết định item nằm ở shard nào. Mọi comment của cùng
//    một video luôn nằm chung một shard -> đọc "toàn bộ comment của video
//    X" chỉ cần chạm vào ĐÚNG MỘT shard, không phải hỏi cả cụm.
//
// 2. SORT KEY quyết định thứ tự item bên trong partition. Nhờ createdAt là
//    sort key mà "lấy 50 comment mới nhất" là một lát cắt liên tiếp, không
//    phải quét rồi sắp xếp.
//
// 3. SHARD là cách chia tải. Video hot nằm ở shard nào thì shard đó nóng —
//    đó cũng chính là "hot partition problem" của DynamoDB.

import http from 'node:http';
import { config } from '../config.js';
import { createLogger } from '../lib/log.js';
import { readJson, sendJson, parseUrl, listen } from '../lib/http.js';

const log = createLogger('db');

// Mỗi shard là một Map: videoId -> mảng comment đã sắp xếp theo createdAt.
const shards = Array.from({ length: config.dbShards }, () => new Map());

/** Băm partition key ra chỉ số shard. */
function shardIndexFor(videoId) {
  let sum = 0;
  for (const char of videoId) sum = (sum * 31 + char.charCodeAt(0)) >>> 0;
  return sum % config.dbShards;
}

function put(comment) {
  const index = shardIndexFor(comment.videoId);
  const shard = shards[index];

  const items = shard.get(comment.videoId) ?? [];
  items.push(comment);

  // Giữ mảng luôn sắp xếp theo sort key. DynamoDB thật cũng lưu item trong
  // partition theo đúng thứ tự sort key, vì lý do y hệt.
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  shard.set(comment.videoId, items);

  log.info(
    `PUT   videoId=${comment.videoId} -> shard ${index} ` +
      `(video này giờ có ${items.length} comment)`
  );
  return index;
}

function query(videoId, limit) {
  const index = shardIndexFor(videoId);
  const items = shards[index].get(videoId) ?? [];

  // Chỉ đọc một shard duy nhất — đó là lợi ích của partition key.
  log.info(`QUERY videoId=${videoId} <- shard ${index} (${items.length} comment)`);
  return items.slice(-limit);
}

const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);

  try {
    if (req.method === 'POST' && url.pathname === '/put') {
      const comment = await readJson(req);
      const shard = put(comment);
      return sendJson(res, 201, { ok: true, shard });
    }

    if (req.method === 'GET' && url.pathname === '/comments') {
      const videoId = url.searchParams.get('videoId');
      if (!videoId) return sendJson(res, 400, { error: 'thiếu videoId' });
      const limit = Number(url.searchParams.get('limit') ?? 50);
      return sendJson(res, 200, { videoId, comments: query(videoId, limit) });
    }

    if (req.method === 'GET' && url.pathname === '/stats') {
      return sendJson(res, 200, {
        shards: shards.map((shard, index) => ({
          shard: index,
          videos: shard.size,
          comments: [...shard.values()].reduce((sum, items) => sum + items.length, 0),
        })),
      });
    }

    sendJson(res, 404, { error: 'không có route này' });
  } catch (error) {
    log.error(error.message);
    sendJson(res, 500, { error: error.message });
  }
});

listen(server, config.db, log, `sẵn sàng trên :${config.db} với ${config.dbShards} shard`);
