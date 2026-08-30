#!/usr/bin/env node
// Commenter Client — bản CLI.
//
// Client chỉ biết MỘT địa chỉ duy nhất: load balancer. Nó không hề biết có
// bao nhiêu comment service hay messaging server phía sau. Đó là cả mục
// đích của load balancer.
//
// Cách dùng:
//   node client.js watch   <videoId>                  mở kết nối SSE, xem comment realtime
//   node client.js post    <videoId> <author> <nội dung...>
//   node client.js history <videoId>                  đọc lại từ DB
//   node client.js route   <videoId>                  xem videoId này rơi vào server nào

import { loadBalancerUrl } from './config.js';

const base = process.env.LB_URL ?? loadBalancerUrl;
const [command, ...args] = process.argv.slice(2);

const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const bold = (text) => `\x1b[1m${text}\x1b[0m`;

function usage() {
  console.log(`
Cách dùng:
  node client.js watch   <videoId>
  node client.js post    <videoId> <author> <nội dung...>
  node client.js history <videoId>
  node client.js route   <videoId>
`);
  process.exit(1);
}

// --- watch: đọc luồng SSE ---------------------------------------------
//
// Trình duyệt có sẵn EventSource làm việc này. Ở đây tự parse để bạn thấy
// giao thức SSE thực ra đơn giản đến mức nào: một luồng text, mỗi sự kiện
// là vài dòng "khoá: giá trị", kết thúc bằng một dòng trống.
async function watch(videoId) {
  console.log(dim(`đang kết nối tới ${base}/subscribe?videoId=${videoId} ...`));

  const response = await fetch(`${base}/subscribe?videoId=${encodeURIComponent(videoId)}`, {
    headers: { accept: 'text/event-stream' },
  });
  if (!response.ok) {
    console.error(`kết nối thất bại: ${response.status}`);
    process.exit(1);
  }

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    // Một sự kiện SSE kết thúc bằng dòng trống.
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;             // dòng ping, bỏ qua
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      const payload = JSON.parse(data);
      if (eventName === 'connected') {
        console.log(dim(`đã kết nối — messaging server đang phục vụ bạn: :${payload.server}`));
        console.log(dim('đang chờ comment... (Ctrl-C để thoát)\n'));
      } else {
        const time = payload.createdAt.slice(11, 19);
        console.log(`${dim(time)} ${bold(payload.author)}: ${payload.content}`);
      }
    }
  }

  console.log(dim('\nkết nối đã đóng.'));
}

// --- post -------------------------------------------------------------
async function post(videoId, author, content) {
  const response = await fetch(`${base}/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ videoId, author, content }),
  });
  const result = await response.json();

  if (!response.ok) {
    console.error('gửi thất bại:', result.error);
    process.exit(1);
  }
  console.log(`đã gửi. commentId=${result.commentId.slice(0, 8)}`);
  if (!result.delivered) {
    console.log('CẢNH BÁO: đã lưu vào DB nhưng KHÔNG phát realtime được.');
  } else if (result.subscribers === 0) {
    console.log('đã lưu vào DB. Hiện không có ai đang xem video này.');
  } else {
    console.log(`đã phát realtime tới ${result.subscribers} người đang xem.`);
  }
}

// --- history ----------------------------------------------------------
async function history(videoId) {
  const response = await fetch(`${base}/comments?videoId=${encodeURIComponent(videoId)}`);
  const { comments } = await response.json();

  if (!comments?.length) return console.log('video này chưa có comment nào.');
  for (const comment of comments) {
    console.log(`${dim(comment.createdAt.slice(11, 19))} ${bold(comment.author)}: ${comment.content}`);
  }
}

// --- route ------------------------------------------------------------
async function route(videoId) {
  const response = await fetch(`${base}/route?videoId=${encodeURIComponent(videoId)}`);
  const result = await response.json();

  console.log(`videoId          : ${result.videoId}`);
  console.log(`load balancer chọn: ${result.loadBalancerPicks}`);
  console.log(`dispatcher chọn   : ${result.dispatcherPicks}`);
  console.log(result.agree ? '=> KHỚP NHAU. Comment sẽ tới được người xem.' : '=> LỆCH NHAU!');
}

const commands = { watch, post: (id, author, ...rest) => post(id, author, rest.join(' ')), history, route };

if (!commands[command] || args.length === 0) usage();

commands[command](...args).catch((error) => {
  console.error(`lỗi: ${error.message}`);
  console.error(`(load balancer đã chạy chưa? thử: npm start)`);
  process.exit(1);
});
