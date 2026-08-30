// Log có màu để bạn nhìn ra ngay request đang đi qua service nào.
// Toàn bộ 9 process ghi chung vào một terminal, màu là thứ duy nhất
// giúp phân biệt.

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Mỗi loại service một màu cố định.
const SERVICE_COLORS = {
  'load-balancer': 'magenta',
  'comment-service': 'green',
  db: 'yellow',
  dispatcher: 'cyan',
  messaging: 'blue',
  client: 'reset',
};

export function createLogger(name) {
  const base = name.split(':')[0];
  const color = COLORS[SERVICE_COLORS[base] ?? 'reset'] ?? COLORS.reset;
  const label = `${color}[${name.padEnd(18)}]${COLORS.reset}`;

  const write = (message) => {
    const time = new Date().toISOString().slice(11, 23);
    console.log(`${COLORS.dim}${time}${COLORS.reset} ${label} ${message}`);
  };

  return {
    info: write,
    error: (message) => write(`${COLORS.red}LỖI${COLORS.reset} ${message}`),
  };
}
