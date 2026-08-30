import test from 'node:test';
import assert from 'node:assert/strict';
import { createRing } from '../lib/hashring.js';

const threeNodes = ['http://a:6001', 'http://b:6002', 'http://c:6003'];

test('cùng một key luôn cho ra cùng một node', () => {
  const ring = createRing(threeNodes);
  const first = ring.get('live-123');

  // Đây là tính chất mà cả load balancer lẫn dispatcher đều dựa vào.
  for (let i = 0; i < 100; i++) {
    assert.equal(ring.get('live-123'), first);
  }
});

test('hai ring dựng độc lập vẫn cho cùng kết quả', () => {
  // Load balancer và dispatcher là hai process khác nhau, mỗi bên tự dựng
  // ring của mình. Chúng phải đồng ý với nhau mà không cần trao đổi gì.
  const loadBalancerRing = createRing(threeNodes);
  const dispatcherRing = createRing(threeNodes);

  for (let i = 0; i < 500; i++) {
    const videoId = `live-${i}`;
    assert.equal(loadBalancerRing.get(videoId), dispatcherRing.get(videoId));
  }
});

test('key phân bố đều, không dồn hết vào một node', () => {
  const ring = createRing(threeNodes);
  const counts = new Map(threeNodes.map((node) => [node, 0]));

  for (let i = 0; i < 3000; i++) {
    const node = ring.get(`live-${i}`);
    counts.set(node, counts.get(node) + 1);
  }

  // Chia đều tuyệt đối là 1000 mỗi node. Cho phép lệch, nhưng không node
  // nào được nhận dưới 15% tổng tải.
  for (const [node, count] of counts) {
    assert.ok(count > 450, `${node} chỉ nhận ${count}/3000 — ring bị lệch`);
  }
});

test('thêm node chỉ xáo trộn một phần nhỏ key', () => {
  // Đây là lý do tồn tại của consistent hashing.
  const before = createRing(threeNodes);
  const after = createRing([...threeNodes, 'http://d:6004']);

  let moved = 0;
  const total = 3000;
  for (let i = 0; i < total; i++) {
    const videoId = `live-${i}`;
    if (before.get(videoId) !== after.get(videoId)) moved++;
  }

  const ratio = moved / total;

  // Lý thuyết: chỉ ~1/4 số key phải chuyển sang node mới.
  // Nếu dùng hash % n thì con số này sẽ là ~75%: gần như mọi người xem
  // bị đá sang server khác chỉ vì ta thêm một máy.
  assert.ok(ratio < 0.4, `có tới ${(ratio * 100).toFixed(1)}% key phải đổi chỗ`);
  assert.ok(ratio > 0.05, 'gần như không key nào đổi chỗ — node mới không nhận tải?');
});
