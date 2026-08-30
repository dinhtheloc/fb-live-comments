# Live Comments — hệ thống tối giản để hiểu cơ chế

Mô phỏng kiến trúc bình luận realtime kiểu Facebook Live, viết bằng Node.js
thuần, **không có bất kỳ npm dependency nào**. Mục đích là để đọc và hiểu,
không phải để chạy production.

```
                                 ┌──────────────────────┐        ┌─────────────────┐
                                 │  Comment Management  │◄──────►│   Comments DB   │
                    ┌───────────►│       Service        │        │  (4 shard, RAM) │
                    │  /create   │      :4001 :4002     │        │      :7001      │
                    │            └──────────┬───────────┘        └─────────────────┘
┌───────────┐  ┌────┴─────┐                 │ comment mới
│ Commenter │  │   Load   │                 ▼
│  Client   │◄─┤ Balancer │      ┌──────────────────────┐
│   (CLI)   │  │ layer 7  │      │      Dispatcher      │  chọn server bằng
└───────────┘  │  :8080   │      │        :5001         │  consistent hashing
                    │       └───►└──────────┬───────────┘
                    │  /subscribe           │ HTTP thẳng (không pub/sub)
                    │  (SSE)                ▼
                    │            ┌──────────────────────┐
                    └────────────┤  Realtime Messaging  │
                       proxy SSE │  :6001 :6002 :6003   │
                                 └──────────────────────┘
```

## Chạy thử

```bash
npm start          # bật cả 9 process, log gộp chung một terminal
```

Mở các terminal khác:

```bash
node client.js watch   live-123                  # người xem 1
node client.js watch   live-123                  # người xem 2 (terminal khác)
node client.js post    live-123 Loc "xin chao"   # gửi comment
```

Comment hiện ngay ở cả hai terminal đang `watch`. Terminal chạy `npm start`
cho bạn thấy đường đi đầy đủ của nó.

```bash
npm test           # kiểm chứng tính chất của consistent hashing
```

## Ý tưởng cốt lõi

Câu hỏi khó nhất của bài toán này là:

> Có 3 messaging server. Người xem video X đang cắm SSE vào server nào?
> Comment mới của video X phải gửi tới đâu?

Cách dễ nhất là dùng pub/sub: bắn comment tới **tất cả** server, server nào
có người xem thì phát, còn lại vứt đi. Chạy được, nhưng lãng phí tỉ lệ thuận
với số server.

Hệ thống này làm khác. **Load balancer và dispatcher cùng chạy một hàm hash
trên `videoId`**, dùng chung một danh sách node trong `config.js`:

- Load balancer xếp mọi người xem video X vào **cùng một** server.
- Dispatcher tính ra **đúng server đó** và gọi HTTP thẳng tới nó.

Hai bên không hề trao đổi thông tin. Chúng chỉ cùng ra một đáp án vì cùng
làm một phép tính. Đó là ý nghĩa của dòng chữ "HTTPS (not pub/sub)" trong sơ
đồ gốc.

Tự kiểm chứng:

```bash
node client.js route live-123     # cả hai cùng chọn :6001
node client.js route live-42      # cả hai cùng chọn :6003
```

## Vì sao là *consistent* hashing, không phải `hash % 3`?

`hash % 3` cũng cho kết quả nhất quán giữa hai bên. Vấn đề nằm ở lúc thêm
hoặc bớt server: `3` thành `4` thì **gần như mọi** `videoId` bị ánh xạ sang
server khác, và toàn bộ người xem bị rớt kết nối cùng lúc.

Consistent hashing đặt các server lên một vòng tròn số. Thêm một server chỉ
"cướp" phần cung ngay trước nó, nên chỉ khoảng 1/4 số key phải đổi chỗ.
`test/hashring.test.js` đo chính con số này.

## Bản đồ file

| File | Nội dung |
|---|---|
| `config.js` | Toàn bộ topology. Muốn thêm messaging server thì sửa ở đây. |
| `lib/hashring.js` | Consistent hashing. **File đáng đọc nhất.** |
| `lib/http.js` | Helper HTTP nhỏ, để service khỏi lặp code |
| `lib/log.js` | Log có màu theo service |
| `services/db.js` | Comments DB: partition key, sort key, shard |
| `services/comment-service.js` | Ghi DB trước, báo dispatcher sau — và vì sao thứ tự đó quan trọng |
| `services/dispatcher.js` | Tra ring rồi gọi thẳng messaging server |
| `services/messaging.js` | Giữ kết nối SSE, phát comment |
| `services/load-balancer.js` | Layer 7: `/create` round-robin, `/subscribe` theo ring |
| `client.js` | CLI: `watch`, `post`, `history`, `route` |

Thứ tự đọc gợi ý: `config.js` → `lib/hashring.js` → `services/load-balancer.js`
→ `services/dispatcher.js` → `services/messaging.js`.

## Những thứ đáng thử để hiểu sâu hơn

**1. Chứng minh mỗi video chỉ nằm ở một server**

```bash
node client.js watch live-123 &
node client.js watch live-42 &
curl -s localhost:6001/stats     # thấy live-123
curl -s localhost:6003/stats     # thấy live-42
curl -s localhost:6002/stats     # trống
```

**2. Xem shard của DB**

```bash
curl -s localhost:7001/stats
```

Mỗi video luôn nằm gọn trong một shard — đó là tác dụng của partition key.
Nếu một video quá hot, shard đó nóng theo. Chính là "hot partition problem".

**3. Phá cho hỏng**

Giết một messaging server (`kill` process `:6001`) rồi gửi comment cho
`live-123`. Comment **vẫn được lưu vào DB**, nhưng không tới được ai —
client báo `CẢNH BÁO`. Đó là đánh đổi có chủ ý trong
`services/comment-service.js`: mất realtime còn hơn mất dữ liệu.

Hệ thống này không tự phục hồi sau sự cố đó, vì cố ý bỏ registry và health
check cho đơn giản (xem phần dưới).

**4. Thêm một messaging server**

Thêm `6004` vào `config.js`, khởi động lại. Chạy `node client.js route` với
vài videoId — chỉ một phần đổi server, phần lớn giữ nguyên.

## Cố ý không có

Để code đủ nhỏ mà đọc hết trong một lượt:

- **SSE reconnect + replay.** Client rớt mạng là mất comment trong khoảng
  đó. Hệ thống thật dùng header `Last-Event-ID` để client báo mình đã nhận
  tới đâu, rồi server đọc lại từ DB — và đó chính là lý do `createdAt` được
  chọn làm sort key.
- **Service registry + health check.** Danh sách messaging server ở đây là
  tĩnh trong `config.js`. Hệ thống thật để server tự đăng ký và gửi
  heartbeat, ring được cập nhật khi có server chết.
- **Web UI, xác thực, rate limit, chống spam.**
- **Persistence.** Restart là mất sạch dữ liệu.

## Ghi chú

- Cần Node 18 trở lên (dùng `fetch` có sẵn).
- Trên macOS, cổng 5000 và 7000 bị AirPlay Receiver chiếm, nên project dùng
  5001 và 7001.
- Trên GitHub Codespaces, cổng 8080 được forward tự động. Client CLI chạy
  ngay trong terminal của Codespace nên không cần cấu hình gì thêm.
