// Toàn bộ "topology" của hệ thống nằm ở đây.
// Mọi service đều đọc file này, nên bạn chỉ cần sửa một chỗ khi muốn
// thêm/bớt instance.

export const HOST = '127.0.0.1';

export const config = {
  // Cổng duy nhất mà client biết tới.
  loadBalancer: 8080,

  // Nhiều instance -> để thấy load balancer round-robin.
  commentServices: [4001, 4002],

  // Một instance, nhưng bên trong chia thành nhiều shard.
  db: 7000,
  dbShards: 4,

  dispatcher: 5000,

  // Nhiều instance -> để thấy consistent hashing chọn đúng một cái.
  messagingServers: [6001, 6002, 6003],
};

// Địa chỉ của các messaging server, dạng chuỗi.
// ĐÂY LÀ DANH SÁCH NODE CỦA HASH RING.
// Cả load balancer lẫn dispatcher đều dựng ring từ chính danh sách này,
// nên hai bên luôn chọn ra cùng một server cho cùng một videoId.
export const messagingNodes = config.messagingServers.map(
  (port) => `http://${HOST}:${port}`
);

export const dbUrl = `http://${HOST}:${config.db}`;
export const dispatcherUrl = `http://${HOST}:${config.dispatcher}`;
export const loadBalancerUrl = `http://${HOST}:${config.loadBalancer}`;
export const commentServiceUrls = config.commentServices.map(
  (port) => `http://${HOST}:${port}`
);
