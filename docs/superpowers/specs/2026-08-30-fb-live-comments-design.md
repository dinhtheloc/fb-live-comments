# Live Comments — Design

Ngày: 2026-08-30

## Mục tiêu

Dựng một hệ thống Node.js tối giản để **hiểu cơ chế** của kiến trúc live
comments (kiểu Facebook Live): comment được ghi bền vững, rồi đẩy realtime
tới đúng những người đang xem cùng một video — không dùng pub/sub.

Đây là code để đọc và học, không phải code production. Ưu tiên: rõ ràng >
đầy đủ tính năng > hiệu năng.

## Phạm vi

Có:
- Load balancer layer 7 (định tuyến theo path và theo videoId)
- Comment management service (nhiều instance)
- Comments DB mô phỏng DynamoDB: partition key `videoId`, sort key `createdAt`, chia shard
- Dispatcher định tuyến bằng consistent hashing
- Realtime messaging service (nhiều instance) giữ kết nối SSE
- Client CLI

Không có (cố ý bỏ, có thể thêm sau):
- SSE reconnect + replay bằng `Last-Event-ID`
- Service registry / health check / rebalance khi node chết
- Web UI
- Xác thực, phân quyền, rate limit
- Persistence sau khi restart

## Ràng buộc

- **Zero npm dependency.** Chỉ dùng module built-in của Node (`node:http`,
  `node:crypto`, `node:child_process`, `node:test`). Người đọc không phải
  học framework nào để hiểu code.
- ESM (`"type": "module"`).
- Mỗi service là một process riêng, giao tiếp qua HTTP thật — để ranh giới
  service là thật, không phải lời gọi hàm.
- Chạy được trên GitHub Codespaces chỉ với `npm start`.

## Topology

| Service | Port | Số instance |
|---|---|---|
| Load balancer | 8080 | 1 |
| Comment service | 4001, 4002 | 2 |
| Comments DB | 7000 | 1 (4 shard bên trong) |
| Dispatcher | 5000 | 1 |
| Realtime messaging | 6001, 6002, 6003 | 3 |

Toàn bộ topology khai báo ở `config.js` — một chỗ duy nhất.

## Luồng dữ liệu

### Ghi comment

```
client --POST /create--> LB :8080
  LB: path = /create -> round-robin -> comment-service :4001
    comment-service: sinh commentId (uuid) + createdAt (ISO)
      --POST /put--> DB :7000
          DB: shard = hash(videoId) % 4; lưu vào shard đó, sort theo createdAt
      --POST /dispatch--> dispatcher :5000
          dispatcher: ring.get(videoId) -> messaging :6002
            --POST /broadcast--> messaging :6002
                messaging: ghi SSE event tới mọi client đang xem videoId đó
```

### Đọc realtime

```
client --GET /subscribe?videoId=X--> LB :8080
  LB: path = /subscribe -> ring.get(X) -> messaging :6002
      proxy stream, giữ kết nối mở
```

## Điểm mấu chốt

`lib/hashring.js` được **cả load balancer và dispatcher import**. Cùng một
hàm hash, cùng một danh sách node ⇒ cùng một kết quả.

Vì vậy:
- LB đưa mọi người xem `videoId = X` vào **cùng một** messaging server.
- Dispatcher gửi comment của `videoId = X` tới **đúng server đó**.

Hai bên gặp nhau mà không cần message broker. Đây là lý do trong sơ đồ gốc
mũi tên Dispatcher → Realtime Messaging ghi "HTTPS (not pub/sub)".

Hệ quả cần thấy rõ khi demo: đổi videoId thì cả LB lẫn dispatcher cùng đổi
sang server khác — chứ không phải mỗi bên chọn một nơi.

## Các unit

| File | Làm gì | Phụ thuộc |
|---|---|---|
| `config.js` | Khai báo port của mọi service | — |
| `lib/hashring.js` | `createRing(nodes)` → `{ get(key) }`. Consistent hashing với virtual node | `node:crypto` |
| `lib/log.js` | `createLogger(name)` → log có màu, có timestamp | — |
| `lib/http.js` | `serveJson`, `readJson`, `postJson` — bớt lặp code | `node:http` |
| `services/db.js` | Store chia shard. `POST /put`, `GET /comments`, `GET /stats` | lib/* |
| `services/comment-service.js` | `POST /create`: ghi DB rồi báo dispatcher | lib/*, config |
| `services/dispatcher.js` | `POST /dispatch`: ring → messaging server. `GET /route` để debug | lib/hashring |
| `services/messaging.js` | `GET /stream` (SSE), `POST /broadcast`, `GET /stats` | lib/* |
| `services/load-balancer.js` | `/create`, `/comments` → round-robin; `/subscribe` → ring | lib/hashring |
| `client.js` | CLI: `watch`, `post`, `history`, `route` | — |
| `scripts/start-all.js` | Spawn 9 process, tắt sạch khi Ctrl-C | `node:child_process` |

## Xử lý lỗi

Nguyên tắc: lỗi phải **nhìn thấy được**, không nuốt im lặng, nhưng cũng
không làm sập cả hệ thống khi demo.

- Comment service không gọi được DB → trả 503, không dispatch.
- Comment service ghi DB xong nhưng dispatcher lỗi → vẫn trả 201 kèm
  `delivered: false`. Comment đã bền vững, chỉ là realtime miss.
  (Đây đúng là đánh đổi thật của kiến trúc này — README sẽ nói rõ.)
- Dispatcher không gọi được messaging server đích → log lỗi, trả 502.
- Client SSE mất kết nối → in thông báo rồi thoát. Không tự reconnect
  (nằm ngoài phạm vi).
- Mọi service log request vào/ra để người đọc lần được đường đi.

## Kiểm thử

- `test/hashring.test.js` (`node --test`) — phần duy nhất có logic thật:
  - cùng key luôn ra cùng node (ổn định)
  - key phân bố trên cả 3 node, không dồn hết vào một node
  - thêm một node chỉ làm đổi chỗ một phần nhỏ key, không xáo trộn toàn bộ
    (đây chính là điểm khác biệt so với `hash % n`)
- Phần còn lại kiểm bằng kịch bản demo thủ công trong README.

## Kịch bản demo

1. `npm start`
2. Terminal 2: `node client.js watch live-123`
3. Terminal 3: `node client.js watch live-123`
4. Terminal 4: `node client.js post live-123 Loc "xin chao"`
   → cả hai terminal watch hiện comment; terminal 1 hiện đường đi đầy đủ.
5. `node client.js route live-123` và `node client.js route live-999`
   → hai videoId khác nhau rơi vào hai messaging server khác nhau.
6. `node client.js history live-123` → đọc lại từ DB.
