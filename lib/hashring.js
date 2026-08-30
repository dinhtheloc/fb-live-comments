import { createHash } from 'node:crypto';

// Consistent hashing.
//
// Vấn đề cần giải: có N messaging server, phải chọn ra MỘT server cho mỗi
// videoId, và mọi thành phần trong hệ thống phải chọn ra cùng một kết quả.
//
// Cách ngây thơ:  server = servers[hash(videoId) % N]
// Nhược điểm: thêm hoặc bớt một server thì N đổi, và gần như MỌI videoId
// bị ánh xạ sang server khác -> toàn bộ người xem bị đá ra khỏi kết nối.
//
// Consistent hashing: đặt các server lên một vòng tròn số. Muốn tìm server
// cho videoId thì hash videoId ra một điểm trên vòng, rồi đi theo chiều kim
// đồng hồ tới server gần nhất. Thêm một server chỉ "cướp" phần cung nằm
// ngay trước nó -> chỉ một phần nhỏ videoId phải đổi chỗ.

// Mỗi server thật được rải thành nhiều điểm ảo trên vòng tròn.
// Nếu mỗi server chỉ có 1 điểm, các cung sẽ dài ngắn rất chênh lệch và tải
// bị lệch. Càng nhiều điểm ảo thì phân bố càng đều.
const VIRTUAL_NODES = 150;

// Lấy 8 ký tự hex đầu của MD5 -> một số nguyên 32 bit. Đây là "vị trí"
// trên vòng tròn. Dùng MD5 vì nhanh và phân bố đều; ở đây không có nhu cầu
// bảo mật nào cả.
function hashToPoint(key) {
  return parseInt(createHash('md5').update(key).digest('hex').slice(0, 8), 16);
}

/**
 * @param {string[]} nodes - danh sách server, ví dụ ['http://...:6001', ...]
 */
export function createRing(nodes) {
  if (nodes.length === 0) throw new Error('hash ring cần ít nhất 1 node');

  // Vòng tròn = mảng { point, node } đã sắp xếp tăng dần theo point.
  const ring = [];
  for (const node of nodes) {
    for (let i = 0; i < VIRTUAL_NODES; i++) {
      ring.push({ point: hashToPoint(`${node}#${i}`), node });
    }
  }
  ring.sort((a, b) => a.point - b.point);

  return {
    nodes,

    /** Trả về server phụ trách key (ở đây key là videoId). */
    get(key) {
      const point = hashToPoint(String(key));

      // Đi theo chiều kim đồng hồ: điểm ảo đầu tiên có vị trí >= point.
      // Quét tuyến tính cho dễ đọc. Ring thật dùng binary search vì mảng
      // đã sắp xếp sẵn -- O(log n) thay vì O(n).
      for (const entry of ring) {
        if (entry.point >= point) return entry.node;
      }

      // Không tìm thấy nghĩa là point nằm sau điểm ảo cuối cùng.
      // Vòng tròn thì đi tiếp sẽ quay về đầu.
      return ring[0].node;
    },
  };
}
