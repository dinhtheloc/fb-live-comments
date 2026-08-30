// Bật cả 9 process bằng một lệnh.
//
// Thật ra bạn hoàn toàn có thể mở 9 terminal rồi chạy tay từng cái — file
// này chỉ làm đúng việc đó thay bạn, và gom log về chung một chỗ.

import { spawn } from 'node:child_process';
import { config } from '../config.js';

// Thứ tự khởi động có ý nghĩa: cái nào bị phụ thuộc thì lên trước.
// DB <- comment service, messaging <- dispatcher <- comment service.
const services = [
  ['services/db.js'],
  ...config.messagingServers.map((port) => ['services/messaging.js', String(port)]),
  ['services/dispatcher.js'],
  ...config.commentServices.map((port) => ['services/comment-service.js', String(port)]),
  ['services/load-balancer.js'],
];

const children = [];

for (const args of services) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  children.push(child);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n${args[0]} chết với mã ${code} — đang tắt tất cả.`);
      shutdown();
    }
  });
}

function shutdown() {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

setTimeout(() => {
  console.log(`
Tất cả service đã chạy. Mở terminal khác và thử:

  node client.js watch   live-123          (mo o 2 terminal khac nhau)
  node client.js post    live-123 Loc "xin chao"
  node client.js route   live-123           -> messaging :6001
  node client.js route   live-42            -> messaging :6003
`);
}, 800);
