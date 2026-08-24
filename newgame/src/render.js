// ============================================
// 《我是鸽手·城市迷宫》像素渲染层
// 复用 minigame 的像素鸽子网格 + 面板/按钮，新增城市/道路/羽毛/捕手绘制
// 升级版美术：车道线 / 路缘 / 斑马线 / 建筑立面 / 公园树木 / 车流 / 精致羽毛
// ============================================
const C = {
  border: '#2b2b45',
  panel: '#fffdf5',
  primary: '#f2a24b',
  primaryDark: '#c97d2b',
  accent: '#5b9be0',
  green: '#5fc46b',
  red: '#e05b5b',
  gold: '#f5c542',
  purple: '#a06be0',
  textDark: '#2b2b45',
  textWhite: '#ffffff',
  // 道路 / 建筑
  road: '#3a3f4b',
  roadNoise: '#2f343d',
  roadEdge: '#e6e9f0',
  lane: '#f2c14e',
  grass: '#7bbf6a',
  windowLit: '#ffe2a0',
  glass: '#aacdf0',
  build: {
    1: '#c98a5e', // 家
    2: '#6c7a92', // 公司
    3: '#d98ab0', // 商场
    4: '#8ab0d9', // 学校
    5: '#b58ad9', // 影院
    6: '#9bd98a', // 公园
  },
};

// 网格枚举（与 map.js 保持一致）
const T_BUILD = 0;
const T_ROAD = 1;
const B_HOME = 1, B_COMPANY = 2, B_MALL = 3, B_SCHOOL = 4, B_CINEMA = 5, B_PARK = 6;
// 借口卡 tag 配色 / 中文（与捕手颜色一致，便于"看到对应卡"）
const TAG_COLOR = { work: '#a8c4dd', sick: '#f4d8a8', family: '#cdb9ec', rest: '#b8e6d9', home: '#8a8a9e' };
const TAG_LETTER = { work: '班', sick: '病', family: '亲', rest: '休', home: '家' };

function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}
function pixelPanel(ctx, x, y, w, h, opts) {
  const o = opts || {};
  const bg = o.bg || C.panel;
  const border = o.border || C.border;
  const bw = o.bw || 3;
  px(ctx, x, y, w, h, border);
  px(ctx, x + bw, y + bw, w - bw * 2, h - bw * 2, bg);
  px(ctx, x + bw, y + bw, w - bw * 2, 1, 'rgba(255,255,255,0.5)');
  px(ctx, x, y, bw, bw, bg);
  px(ctx, x + w - bw, y + h - bw, bw, bw, bg);
}
function pixelButton(ctx, x, y, w, h, text, opts) {
  const o = opts || {};
  const bg = o.disabled ? '#bdbdbd' : (o.bg || C.primary);
  const border = o.disabled ? '#8a8a8a' : C.border;
  pixelPanel(ctx, x, y, w, h, { bg, border, bw: 3 });
  if (!o.disabled) px(ctx, x + 3, y + h - 6, w - 6, 3, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = o.disabled ? '#e8e8e8' : (o.textColor || '#ffffff');
  ctx.font = 'bold ' + (o.fontSize || 16) + 'px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 - 1);
}

// ---------- 像素鸽子（12×12 字符网格） ----------
const PIGEON_GRIDS = {
  default: [
    '....dddd....', '...dbbbbd...', '..dbbeebbd..', '..dbbeebbd..',
    '..dbbbbdbod.', '.dbbbbbbbdd.', '.dbwwwwbbad.', '.dbwwwwbbad.',
    '..dbwwbbad..', '...dbbbbd...', '....d..d....', '...oo..oo...',
  ],
  ruange: [
    '....dddd....', '...dbtbbtd..', '..dbbbbbbd..', '..dlbbblbd..',
    '.dybbbbydod.', '.dbbbbbbdbd.', '.dbwwwwbbdd.', 'dbbwwwwbbbdd',
    'dbwwwwwwbbdd', '.dbwwwwbbdd.', '..dbbbbbbd..', '...oo..oo...',
  ],
  tiege: [
    '..hhhhhhhh..', '.hhhhhhhhhh.', '..dbbbbbbd..', '..dBBBBBBd..',
    '..dbpbbpbd..', '..dbbbbbdod.', '.dbwwwwbbdd.', '.dbwwwwbbdd.',
    '.dbwwwwbbdd.', '.dbbwwbbbdd.', '..dbbbbbbd..', '...oo..oo...',
  ],
  geywang: [
    '..k..kk..k..', '..kkkkkkkk..', '..dbbbbbbd..', '..dbdbbdbd..',
    '..dbpbbpbd..', '..dbbbbbdod.', '.dbwwwwbbad.', '.dbwwwwbbad.',
    '.dbwwwwbbad.', '..dbwwbbad..', '..dbbbbbbd..', '...oo..oo...',
  ],
  mengge: [
    '....dddd....', '...dbbbbd...', '..dbbeebbd..', '.dpeebbeepd.',
    '.dbbbbbbdbd.', '..dbbbbodod.', '.dbwwwwbbdd.', 'dbwwwwwwbbdd',
    'dbwwwwwwbbdd', '.dbwwwwbbdd.', '..dbbbbbbd..', '...oo..oo...',
  ],
  laoge: [
    '....dddd....', '...dbbbbd...', '..dbbbbbbd..', '.dssdssdssd.',
    '.dbbbbbbdbd.', '..dbbbbodcd.', '.dbwwwwbbdd.', '.dbwwwwbbad.',
    '..dbwwbbad..', '..dbbbbbdd..', '..dbbbbbdd..', '...oo..oo...',
  ],
};
const VARIANT_BODY = {
  default: '#9db3c9', ruange: '#f4d8a8', tiege: '#a8c4dd',
  geywang: '#cdb9ec', mengge: '#b8e6d9', laoge: '#8a8a9e',
};
function drawPixelPigeon(ctx, x, y, size, opts) {
  const o = opts || {};
  const grid = PIGEON_GRIDS[o.variant] || PIGEON_GRIDS.default;
  const body = o.body || VARIANT_BODY[o.variant] || '#9db3c9';
  const accent = o.accent || '#f2a24b';
  const dark = '#2b2b45';
  const cols = {
    b: body, d: dark, w: '#f2f2f7', e: '#ffffff', o: '#f2a24b',
    a: accent, t: accent, s: '#1a1a2e', c: '#f5f5f5',
    h: '#f5c542', k: '#ffd24d', y: '#ffb3c1', p: dark, l: dark, B: dark,
  };
  const cell = size / 12;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      px(ctx, x + c * cell, y + r * cell, Math.ceil(cell), Math.ceil(cell), cols[ch] || body);
    }
  }
  if (o.emotion === 'angry') {
    px(ctx, x + 3 * cell, y + 2 * cell, cell * 2, Math.max(1, cell * 0.5), '#d43a3a');
    px(ctx, x + 7 * cell, y + 2 * cell, cell * 2, Math.max(1, cell * 0.5), '#d43a3a');
  }
}

// ---------- 城市瓦片 ----------
// 斑马线（十字路口四向白色条纹）
function drawZebra(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  const n = 4, lw = (s / n) * 0.42;
  for (let i = 0; i < n; i++) {
    const o = (i + 0.5) * s / n;
    ctx.fillRect(x + 2, o - lw / 2 + y, s * 0.16, lw);           // 左
    ctx.fillRect(x + s - s * 0.16 - 2, o - lw / 2 + y, s * 0.16, lw); // 右
    ctx.fillRect(o - lw / 2 + x, y + 2, lw, s * 0.16);           // 上
    ctx.fillRect(o - lw / 2 + x, y + s - s * 0.16 - 2, lw, s * 0.16); // 下
  }
}

// drawRoadTile(ctx, x, y, s, info)
//   info: { up, down, left, right } 每项为 'road' | 'rail' | 'build'
//   不传 info 时退化为纯沥青纹理（向后兼容旧调用）
function drawRoadTile(ctx, x, y, s, info) {
  info = info || {};
  px(ctx, x, y, s, s, C.road);
  // 沥青噪点（基于坐标的确定性随机，避免逐帧闪烁）
  let seed = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  ctx.fillStyle = C.roadNoise;
  for (let i = 0; i < 5; i++) {
    const nx = x + rnd() * (s - 2), ny = y + rnd() * (s - 2), ns = 1 + rnd() * 2;
    ctx.fillRect(nx, ny, ns, ns);
  }
  const isR = (v) => v === 'road';
  const horiz = isR(info.left) && isR(info.right);
  const vert = isR(info.up) && isR(info.down);
  const all = horiz && vert;
  ctx.strokeStyle = C.lane;
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.lineCap = 'butt';
  if (all) {
    drawZebra(ctx, x, y, s);
  } else if (horiz) {
    ctx.setLineDash([s * 0.3, s * 0.22]);
    ctx.beginPath(); ctx.moveTo(x, y + s / 2); ctx.lineTo(x + s, y + s / 2); ctx.stroke();
    ctx.setLineDash([]);
  } else if (vert) {
    ctx.setLineDash([s * 0.3, s * 0.22]);
    ctx.beginPath(); ctx.moveTo(x + s / 2, y); ctx.lineTo(x + s / 2, y + s); ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // 道路尽头：向唯一连通方向画黄色实线引导
    ctx.setLineDash([]);
    if (isR(info.left)) { ctx.beginPath(); ctx.moveTo(x, y + s / 2); ctx.lineTo(x + s / 2, y + s / 2); ctx.stroke(); }
    if (isR(info.right)) { ctx.beginPath(); ctx.moveTo(x + s / 2, y + s / 2); ctx.lineTo(x + s, y + s / 2); ctx.stroke(); }
    if (isR(info.up)) { ctx.beginPath(); ctx.moveTo(x + s / 2, y); ctx.lineTo(x + s / 2, y + s / 2); ctx.stroke(); }
    if (isR(info.down)) { ctx.beginPath(); ctx.moveTo(x + s / 2, y + s / 2); ctx.lineTo(x + s / 2, y + s); ctx.stroke(); }
  }
  // 路缘白线（仅与建筑相邻的边）
  ctx.fillStyle = C.roadEdge;
  const ew = Math.max(1, s * 0.09);
  if (info.up === 'build') px(ctx, x, y, s, ew, C.roadEdge);
  if (info.down === 'build') px(ctx, x, y + s - ew, s, ew, C.roadEdge);
  if (info.left === 'build') px(ctx, x, y, ew, s, C.roadEdge);
  if (info.right === 'build') px(ctx, x + s - ew, y, ew, s, C.roadEdge);
}

// 行道树 / 公园树（俯视）
function drawTree(ctx, cx, cy, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(cx + r * 0.25, cy + r * 0.3, r * 1.05, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f8f4a'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5fc46b'; ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7fd98a'; ctx.beginPath(); ctx.arc(cx - r * 0.4, cy - r * 0.4, r * 0.35, 0, Math.PI * 2); ctx.fill();
}

// 公园瓦片（草地 + 路径 + 树）
function drawPark(ctx, x, y, s) {
  px(ctx, x, y, s, s, C.grass);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 1; i <= 3; i++) ctx.fillRect(x, y + i * s / 4, s, 1);
  px(ctx, x, y + s * 0.46, s, Math.max(1, s * 0.08), '#caa46a'); // 小径
  drawTree(ctx, x + s * 0.3, y + s * 0.34, s * 0.16);
  drawTree(ctx, x + s * 0.7, y + s * 0.7, s * 0.18);
  drawTree(ctx, x + s * 0.62, y + s * 0.24, s * 0.13);
}

function drawParkTile(ctx, x, y, s, c, r, reg) {
  px(ctx, x, y, s, s, C.grass);
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let i = 1; i <= 3; i++) ctx.fillRect(x, y + i * s / 4, s, 1);
  px(ctx, x, y + s * 0.46, s, Math.max(1, s * 0.08), '#caa46a');
  // 树按全局哈希稀疏分布，避免每瓦片重复
  const h = (c * 7 + r * 13 + (reg ? reg.id : 0) * 3) % 5;
  if (h === 0) drawTree(ctx, x + s * 0.5, y + s * 0.5, s * 0.22);
}

// 环岛岛心（草地 + 中心装饰）
function drawRoundaboutIsland(ctx, x, y, s) {
  px(ctx, x, y, s, s, '#6ab56a');
  // 中心浅色圆环
  ctx.fillStyle = '#8fd98f';
  ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.36, 0, Math.PI * 2); ctx.fill();
  // 小灌木 / 花坛
  drawTree(ctx, x + s * 0.5, y + s * 0.5, s * 0.14);
  // 外缘路缘
  ctx.strokeStyle = '#e6e9f0'; ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.46, 0, Math.PI * 2); ctx.stroke();
}

// 建筑：以连通区域( reg )为单位绘制，不同 subtype 画成不同建筑外观
function drawBuildingTile(ctx, x, y, s, subtype, reg, c, r, map) {
  // 环岛中心格：四面都是道路 → 画岛心
  if (map) {
    const G = map.grid, COLS = map.cols, ROWS = map.rows;
    const road = (nc, nr) => nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && G[nr * COLS + nc] === T_ROAD;
    if (road(c - 1, r) && road(c + 1, r) && road(c, r - 1) && road(c, r + 1)) {
      drawRoundaboutIsland(ctx, x, y, s); return;
    }
  }

  if (subtype === 6) { drawParkTile(ctx, x, y, s, c, r, reg); return; }

  // 通用外墙 + 外轮廓描边
  const base = C.build[subtype] || C.build[1];
  px(ctx, x, y, s, s, base);

  // 外轮廓：仅与道路 / 异区相邻的边描边
  if (reg && map) {
    const G = map.grid, BR = map.bregion, COLS = map.cols, ROWS = map.rows;
    const same = (nc, nr) => {
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) return false;
      const i = nr * COLS + nc;
      return G[i] === T_BUILD && BR[i] === reg.id;
    };
    ctx.fillStyle = 'rgba(20,18,30,0.5)';
    const ew = Math.max(1, s * 0.08);
    if (!same(c, r - 1)) px(ctx, x, y, s, ew);
    if (!same(c, r + 1)) px(ctx, x, y + s - ew, s, ew);
    if (!same(c - 1, r)) px(ctx, x, y, ew, s);
    if (!same(c + 1, r)) px(ctx, x + s - ew, y, ew, s);
  }

  // 顶部高光 / 底部阴影
  if (!reg || r === reg.r0) px(ctx, x, y, s, Math.max(2, s * 0.06), 'rgba(255,255,255,0.30)');
  if (!reg || r === reg.r1) px(ctx, x, y + s - Math.max(2, s * 0.06), s, Math.max(2, s * 0.06), 'rgba(0,0,0,0.28)');

  // 按建筑类型画具体外观
  const regId = reg ? reg.id : 0;
  switch (subtype) {
    case B_HOME:     drawHome(ctx, x, y, s, reg, c, r, regId); break;
    case B_COMPANY:  drawCompany(ctx, x, y, s, reg, c, r, regId); break;
    case B_MALL:     drawMall(ctx, x, y, s, reg, c, r, regId); break;
    case B_SCHOOL:   drawSchool(ctx, x, y, s, reg, c, r, regId); break;
    case B_CINEMA:   drawCinema(ctx, x, y, s, reg, c, r, regId); break;
  }
}

// 家：小房子，三角屋顶 + 门 + 窗
function drawHome(ctx, x, y, s, reg, c, r, regId) {
  const isTop = !reg || r === reg.r0;
  const isBot = !reg || r === reg.r1;
  // 屋顶：仅区域顶行画棕色三角，下面瓦片补墙色
  if (isTop) {
    ctx.fillStyle = '#a05a2c';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.15, y + s * 0.42);
    ctx.lineTo(x + s * 0.5, y + s * 0.08);
    ctx.lineTo(x + s * 0.85, y + s * 0.42);
    ctx.closePath(); ctx.fill();
  }
  // 门：区域底部居中
  if (isBot) {
    px(ctx, x + s * 0.42, y + s * 0.55, s * 0.16, s * 0.35, '#6b4423');
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + s * 0.42 + 2, y + s * 0.55, 2, s * 0.35);
  }
  // 窗：左右墙，按列哈希决定是否亮灯
  const lit = (((c * 13 + r * 7 + regId * 5) & 7) < 3);
  ctx.fillStyle = lit ? C.windowLit : 'rgba(255,255,255,0.35)';
  if ((!reg || c === reg.c0) && !isTop) ctx.fillRect(x + s * 0.18, y + s * 0.48, s * 0.18, s * 0.22);
  if ((!reg || c === reg.c1) && !isTop) ctx.fillRect(x + s * 0.64, y + s * 0.48, s * 0.18, s * 0.22);
}

// 公司：玻璃办公楼，横向条纹 + 连续窗格
function drawCompany(ctx, x, y, s, reg, c, r, regId) {
  // 玻璃幕墙：连续窗格
  const pitch = Math.max(10, Math.round(s * 0.32));
  const wsize = Math.round(pitch * 0.55);
  const ax = reg ? reg.c0 * s : c * s;
  const ay = reg ? reg.r0 * s : r * s;
  const startC = Math.floor((x - ax) / pitch);
  const startR = Math.floor((y - ay) / pitch);
  for (let kc = startC; kc * pitch + ax < x + s; kc++) {
    for (let kr = startR; kr * pitch + ay < y + s; kr++) {
      const wx = ax + kc * pitch + Math.floor((pitch - wsize) / 2);
      const wy = ay + kr * pitch + Math.floor((pitch - wsize) / 2);
      if (wx < x + 1 || wy < y + 1 || wx + wsize > x + s || wy + wsize > y + s) continue;
      const lit = (((kc * 13 + kr * 7 + regId * 5) & 7) < 2);
      px(ctx, wx, wy, wsize, wsize, lit ? C.windowLit : 'rgba(255,255,255,0.18)');
    }
  }
  // 横向结构线
  ctx.fillStyle = 'rgba(30,35,45,0.35)';
  if (!reg || (r - reg.r0) % 2 === 0) ctx.fillRect(x, y + s * 0.48, s, Math.max(1, s * 0.05));
}

// 商场：大橱窗 + 招牌
function drawMall(ctx, x, y, s, reg, c, r, regId) {
  const isTop = !reg || r === reg.r0;
  const isBot = !reg || r === reg.r1;
  // 大橱窗
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  if (!reg || c > reg.c0) ctx.fillRect(x + s * 0.10, y + s * 0.40, s * 0.80, s * 0.40);
  // 橱窗分割线
  ctx.fillStyle = 'rgba(40,30,30,0.35)';
  ctx.fillRect(x + s * 0.48, y + s * 0.40, Math.max(1, s * 0.04), s * 0.40);
  // 招牌：顶行
  if (isTop) {
    ctx.fillStyle = '#f4a6c6';
    ctx.fillRect(x + s * 0.12, y + s * 0.10, s * 0.76, s * 0.18);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.max(8, Math.round(s * 0.12)) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MALL', x + s * 0.5, y + s * 0.19);
  }
  // 入口雨棚：底行
  if (isBot) {
    ctx.fillStyle = '#e0703a';
    ctx.fillRect(x + s * 0.25, y + s * 0.72, s * 0.50, s * 0.10);
  }
}

// 学校：操场 + 旗杆 + 窗户
function drawSchool(ctx, x, y, s, reg, c, r, regId) {
  const isTop = !reg || r === reg.r0;
  const isBot = !reg || r === reg.r1;
  const isLeft = !reg || c === reg.c0;
  // 操场：区域左上角大片草地
  if (isTop && isLeft) {
    ctx.fillStyle = C.grass;
    ctx.fillRect(x + s * 0.08, y + s * 0.18, s * 0.42, s * 0.42);
    // 跑道
    ctx.strokeStyle = '#caa46a'; ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.strokeRect(x + s * 0.12, y + s * 0.22, s * 0.34, s * 0.34);
  }
  // 旗杆：顶行居中
  if (isTop) {
    ctx.fillStyle = '#ddd';
    ctx.fillRect(x + s * 0.64, y + s * 0.20, Math.max(1, s * 0.04), s * 0.35);
    ctx.fillStyle = '#e05b5b';
    ctx.beginPath(); ctx.moveTo(x + s * 0.66, y + s * 0.22); ctx.lineTo(x + s * 0.78, y + s * 0.28); ctx.lineTo(x + s * 0.66, y + s * 0.34); ctx.fill();
  }
  // 窗户
  const lit = (((c * 13 + r * 7 + regId * 5) & 7) < 3);
  ctx.fillStyle = lit ? C.windowLit : 'rgba(255,255,255,0.30)';
  if (!isTop && !isBot) ctx.fillRect(x + s * 0.20, y + s * 0.25, s * 0.60, s * 0.18);
}

// 影院：海报框 + 霓虹灯条
function drawCinema(ctx, x, y, s, reg, c, r, regId) {
  const isTop = !reg || r === reg.r0;
  const isBot = !reg || r === reg.r1;
  // 霓虹招牌：顶行
  if (isTop) {
    ctx.fillStyle = '#b58ad9';
    ctx.fillRect(x + s * 0.10, y + s * 0.12, s * 0.80, s * 0.16);
    ctx.fillStyle = '#ffd9ec';
    ctx.font = 'bold ' + Math.max(8, Math.round(s * 0.12)) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CINE', x + s * 0.5, y + s * 0.20);
  }
  // 海报框：底部左右
  if (isBot) {
    ctx.fillStyle = '#2b2b45';
    ctx.fillRect(x + s * 0.12, y + s * 0.55, s * 0.22, s * 0.30);
    ctx.fillRect(x + s * 0.66, y + s * 0.55, s * 0.22, s * 0.30);
    ctx.fillStyle = '#f5c542';
    ctx.fillRect(x + s * 0.15, y + s * 0.62, s * 0.16, s * 0.12);
    ctx.fillRect(x + s * 0.69, y + s * 0.62, s * 0.16, s * 0.12);
  }
  // 入口红地毯
  if (isBot) {
    ctx.fillStyle = '#d94040';
    ctx.fillRect(x + s * 0.40, y + s * 0.70, s * 0.20, s * 0.22);
  }
}

// 散落世界的借口卡拾取物：tag 配色光柱 + 小卡（标注 班/病/亲/休/家）
function drawExcusePickup(ctx, x, y, s, tag, t) {
  const bob = Math.sin((t || 0) / 220 + x * 0.05) * 2;
  ctx.save(); ctx.translate(x, y + bob);
  const col = TAG_COLOR[tag] || '#fff';
  ctx.globalAlpha = 0.25; ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  const w = s * 0.5, h = s * 0.64;
  pixelPanel(ctx, -w / 2, -h / 2, w, h, { bg: '#fffdf5', border: col, bw: 3 });
  ctx.fillStyle = col;
  ctx.font = 'bold ' + Math.round(s * 0.26) + 'px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(TAG_LETTER[tag] || '?', 0, 1);
  ctx.restore();
}

function drawRailTile(ctx, x, y, s, vertical) {
  // 障碍基底：偏蓝的深色，明显区别于道路暖灰；叠加橙黑 hazard 斜条纹，一眼是"不可通行"
  px(ctx, x, y, s, s, '#2e3340');
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
  const stripe = s * 0.3;
  for (let o = -s; o < s * 2; o += stripe) {
    ctx.fillStyle = '#ef9a3d';
    ctx.beginPath();
    ctx.moveTo(x + o, y);
    ctx.lineTo(x + o + stripe * 0.5, y);
    ctx.lineTo(x + o + stripe * 0.5 - s, y + s);
    ctx.lineTo(x + o - s, y + s);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // 栅栏立柱（近黑），强化"栏杆"质感
  ctx.fillStyle = '#15171f';
  if (vertical) { for (let i = 4; i < s; i += 11) px(ctx, x + i, y, 3, s); }
  else { for (let i = 4; i < s; i += 11) px(ctx, x, y + i, s, 3); }
}

function drawCar(ctx, cx, cy, s, color, dir) {
  const w = s * 0.64, h = s * 0.42;
  const x = cx - w / 2, y = cy - h / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + 2, y + 3, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  if (dir === 'h') ctx.fillRect(x + w * 0.18, y + 2, w * 0.32, h - 4);
  else ctx.fillRect(x + 2, y + h * 0.18, w - 4, h * 0.32);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  if (dir === 'h') { ctx.fillRect(x + 2, y + h - 3, w * 0.2, 3); ctx.fillRect(x + w - w * 0.2 - 2, y + h - 3, w * 0.2, 3); }
  else { ctx.fillRect(x + w - 3, y + 2, 3, h * 0.2); ctx.fillRect(x + w - 3, y + h - h * 0.2 - 2, 3, h * 0.2); }
}

function drawFeather(ctx, x, y, s, t) {
  const bob = Math.sin((t || 0) / 200 + x * 0.05) * 2;
  ctx.save();
  ctx.translate(x, y + bob);
  // 微光
  ctx.globalAlpha = 0.25; ctx.fillStyle = C.accent;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // 羽片
  ctx.fillStyle = '#f2f7ff';
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.28, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  // 羽轴
  ctx.strokeStyle = '#9bd9f0'; ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(0, s * 0.5); ctx.stroke();
  // 羽枝
  ctx.strokeStyle = 'rgba(155,217,240,0.85)'; ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    const yy = i * s * 0.12;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(s * 0.22, yy - s * 0.06); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(-s * 0.22, yy - s * 0.06); ctx.stroke();
  }
  ctx.restore();
}

// 捕手光环（显示其类型色 + 追捕状态）
function drawChaserAura(ctx, x, y, r, color, alert) {
  ctx.save();
  ctx.globalAlpha = alert ? 0.55 : 0.28;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (alert) {
    ctx.fillStyle = '#ff3b3b';
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', x, y - r - 4);
  }
}

// 抽卡点（光柱 + 问号牌；used 时显示已用暗台）
function drawCardPoint(ctx, x, y, s, t, used) {
  if (used) {
    px(ctx, x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4, 'rgba(120,120,120,0.5)');
    ctx.strokeStyle = 'rgba(120,120,120,0.7)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4);
    return;
  }
  const pulse = 0.5 + 0.5 * Math.sin((t || 0) / 250);
  ctx.save();
  const g = ctx.createRadialGradient(x + s / 2, y + s / 2, 1, x + s / 2, y + s / 2, s * 0.95);
  g.addColorStop(0, 'rgba(245,197,66,' + (0.5 + 0.35 * pulse) + ')');
  g.addColorStop(1, 'rgba(245,197,66,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.95, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  px(ctx, x + s * 0.22, y + s * 0.22, s * 0.56, s * 0.56, '#fff3c4');
  ctx.strokeStyle = C.border; ctx.lineWidth = 2; ctx.strokeRect(x + s * 0.22, y + s * 0.22, s * 0.56, s * 0.56);
  ctx.fillStyle = C.border;
  ctx.font = 'bold ' + Math.round(s * 0.42) + 'px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('?', x + s / 2, y + s / 2 + 1);
}

// 脚下椭圆阴影（玩家 / 捕手通用）
function drawShadow(ctx, cx, cy, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.5, r * 0.7, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
}

const API = {
  C, px, pixelPanel, pixelButton, drawPixelPigeon,
  drawRoadTile, drawBuildingTile, drawRailTile, drawFeather, drawChaserAura, drawCardPoint,
  drawTree, drawCar, drawShadow, drawZebra, drawExcusePickup, TAG_COLOR, TAG_LETTER,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.R = API;
