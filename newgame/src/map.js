// ============================================
// 随机像素城市地图生成器
//   道路网络（1~3 车道宽度，玩家只能在道路上走）
//   建筑（flood-fill 整块上色：家/公司/商场/学校/影院/公园）
//   栏杆障碍（只挡部分车道，永远留通道）
//   BFS 连通性校验，保证起点能到达所有羽毛与抽卡点
// ============================================
const { randInt, shuffle } = require('./utils.js');
const { EXCUSES } = require('./cards.js');

const TILE = 36;
const T_BUILD = 0, T_ROAD = 1, T_RAIL = 2;

// 建筑子类型
const B_HOME = 1, B_COMPANY = 2, B_MALL = 3, B_SCHOOL = 4, B_CINEMA = 5, B_PARK = 6;
const B_TYPES = [B_HOME, B_COMPANY, B_MALL, B_SCHOOL, B_CINEMA, B_PARK];

function generate(cols, rows) {
  const grid = new Array(cols * rows).fill(T_BUILD);
  const btype = new Array(cols * rows).fill(B_HOME);
  const idx = (c, r) => r * cols + c;
  // 汽车精确碰撞体：停在道路格内但不阻断整格道路，玩家/捕手需绕过

  // 1) 水平主路
  let y = randInt(2, 3);
  while (y < rows - 3) {
    const w = randInt(1, 3);
    for (let yy = y; yy < y + w && yy < rows; yy++)
      for (let x = 1; x < cols - 1; x++) grid[idx(x, yy)] = T_ROAD;
    y += w + randInt(3, 6);
  }
  // 2) 垂直主路
  let x = randInt(2, 3);
  while (x < cols - 3) {
    const w = randInt(1, 3);
    for (let xx = x; xx < x + w && xx < cols; xx++)
      for (let yy = 1; yy < rows - 1; yy++) grid[idx(xx, yy)] = T_ROAD;
    x += w + randInt(3, 6);
  }

  // 3) 斜向连接：在建筑区块对角之间打通斜路，增加路网灵活度
  addDiagonalRoads(grid, cols, rows);
  // 4) 环岛：把部分十字路口改成 roundabout
  addRoundabouts(grid, cols, rows);
  // 5) 弯曲小路：在建筑街区里随机穿几条 S 形/曲线小路
  addWindingPaths(grid, cols, rows);

  // 6) 建筑 flood-fill 整块上色 + 记录连通区域（供连贯楼体绘制）
  const assigned = new Array(cols * rows).fill(false);
  const bregion = new Array(cols * rows).fill(-1);
  const buildings = [];
  let regionId = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (grid[i] === T_BUILD && bregion[i] === -1) {
        const sub = B_TYPES[randInt(0, B_TYPES.length - 1)];
        const stack = [[c, r]];
        bregion[i] = regionId;
        let minC = c, maxC = c, minR = r, maxR = r;
        while (stack.length) {
          const [cc, rr] = stack.pop();
          btype[idx(cc, rr)] = sub;
          minC = Math.min(minC, cc); maxC = Math.max(maxC, cc);
          minR = Math.min(minR, rr); maxR = Math.max(maxR, rr);
          const nb = [[cc + 1, rr], [cc - 1, rr], [cc, rr + 1], [cc, rr - 1]];
          for (const [nc, nr] of nb) {
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const ni = idx(nc, nr);
            if (grid[ni] === T_BUILD && bregion[ni] === -1) { bregion[ni] = regionId; stack.push([nc, nr]); }
          }
        }
        buildings.push({ id: regionId, c0: minC, r0: minR, c1: maxC, r1: maxR, subtype: sub });
        regionId++;
      }
    }
  }

  // 4) 起点：左下角附近的可行走道路
  let startCell = null;
  for (let r = rows - 2; r > 2 && !startCell; r--) {
    for (let c = 2; c < cols - 2 && !startCell; c++) {
      if (grid[idx(c, r)] === T_ROAD) startCell = { c, r };
    }
  }
  if (!startCell) startCell = { c: 2, r: 2 };

  const map = {
    cols, rows, tile: TILE, grid, btype, buildings, bregion, startCell,
    walkable(col, row) {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
      return grid[idx(col, row)] === T_ROAD;
    },
    walkableAt(wx, wy) {
      return this.walkable(Math.floor(wx / TILE), Math.floor(wy / TILE));
    },
    // 圆 (x,y,r) 是否与任意汽车碰撞框相碰（精确碰撞，汽车只挡部分道路）
    carHit(wx, wy, r) {
      if (!this.cars) return false;
      for (const car of this.cars) {
        const cx = car.colCx || car.cx;
        const cy = car.colCy || car.cy;
        const dx = Math.abs(wx - cx);
        const dy = Math.abs(wy - cy);
        if (dx > car.hw + r || dy > car.hh + r) continue;
        if (dx <= car.hw || dy <= car.hh) return true;
        const cx2 = dx - car.hw, cy2 = dy - car.hh;
        if (cx2 * cx2 + cy2 * cy2 <= r * r) return true;
      }
      return false;
    },
    isRail(col, row) {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
      return grid[idx(col, row)] === T_RAIL;
    },
    start: { x: startCell.c * TILE + TILE / 2, y: startCell.r * TILE + TILE / 2 },
    worldW: cols * TILE, worldH: rows * TILE,
  };

  // 5) 栏杆：在"至少有 3 个道路邻居"的路面放置，放置后做连通性校验
  const roadCells = [];
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++)
      if (grid[idx(c, r)] === T_ROAD) roadCells.push({ c, r });
  const roadNeighbors = (c, r) => {
    let n = 0;
    if (grid[idx(c + 1, r)] === T_ROAD) n++;
    if (grid[idx(c - 1, r)] === T_ROAD) n++;
    if (grid[idx(c, r + 1)] === T_ROAD) n++;
    if (grid[idx(c, r - 1)] === T_ROAD) n++;
    return n;
  };
  const candidates = shuffle(roadCells.filter((p) =>
    roadNeighbors(p.c, p.r) >= 3 &&
    !(p.c === startCell.c && p.r === startCell.r))); // 起点永远不被栏杆占用
  let railCount = 0;
  const railLimit = Math.floor(roadCells.length * 0.05);
  // 基准：起点当前可达的所有道路瓦片数（用于校验栏杆不会切断道路）
  const baseReach = reachableSet(map, startCell).size;
  for (const p of candidates) {
    if (railCount >= railLimit) break;
    grid[idx(p.c, p.r)] = T_RAIL;
    // 放置后若起点可达的道路数变少，说明切断了某条道路 → 回退
    if (reachableSet(map, startCell).size >= baseReach) railCount++;
    else grid[idx(p.c, p.r)] = T_ROAD; // 阻断则回退
  }

  // 6) 羽毛（仅放在仍可行走的路面，且从起点可达）
  const featherCount = Math.floor(roadCells.length * 0.06) + 12;
  const fpool = shuffle(roadCells.slice());
  const reach = reachableSet(map, startCell);
  const feathers = [];
  for (let i = 0; i < fpool.length && feathers.length < featherCount; i++) {
    const p = fpool[i];
    if (grid[idx(p.c, p.r)] !== T_ROAD) continue;       // 可能被栏杆占用
    if (!reach.has(idx(p.c, p.r))) continue;            // 不可达则跳过
    feathers.push({ x: p.c * TILE + TILE / 2, y: p.r * TILE + TILE / 2, got: false });
  }

  // 7) 抽卡点（放在路口：上下左右都有道路，且不是栏杆）
  const cardPoints = [];
  // 候选：可达路面；按"道路邻居数"排序，路口优先
  const roadNb = (c, r) => {
    let n = 0;
    if (grid[idx(c + 1, r)] === T_ROAD) n++;
    if (grid[idx(c - 1, r)] === T_ROAD) n++;
    if (grid[idx(c, r + 1)] === T_ROAD) n++;
    if (grid[idx(c, r - 1)] === T_ROAD) n++;
    return n;
  };
  const cand = shuffle(roadCells.filter((p) => grid[idx(p.c, p.r)] === T_ROAD && reach.has(idx(p.c, p.r))));
  cand.sort((a, b) => roadNb(b.c, b.r) - roadNb(a.c, a.r));
  const cpTarget = 4;
  const placed = [];
  const tryPlace = (minGap) => {
    for (const p of cand) {
      if (placed.length >= cpTarget) break;
      if (placed.some((q) => Math.abs(q.c - p.c) < minGap || Math.abs(q.r - p.r) < minGap)) continue;
      placed.push(p);
      cardPoints.push({ x: p.c * TILE + TILE / 2, y: p.r * TILE + TILE / 2, used: false, cd: 0 });
    }
  };
  tryPlace(4);          // 优先满足间距
  if (placed.length < 3) tryPlace(2);   // 放宽间距补足
  if (placed.length < 3) tryPlace(0);   // 兜底：任意可达路面

  map.feathers = feathers;
  map.cardPoints = cardPoints;

  // 8) 车流障碍物：停在道路边缘，真实阻挡玩家/捕手，但不阻断整格道路
  const carColors = ['#e05b5b', '#5b9be0', '#f5c542', '#f0f0f0', '#7a7a8a'];
  const carCount = Math.floor(roadCells.length * 0.04);
  const startWX = startCell.c * TILE + TILE / 2, startWY = startCell.r * TILE + TILE / 2;
  const cars = [];
  for (const p of shuffle(roadCells)) {
    if (cars.length >= carCount) break;
    if (grid[idx(p.c, p.r)] !== T_ROAD) continue;
    const left = grid[idx(p.c - 1, p.r)] === T_ROAD;
    const right = grid[idx(p.c + 1, p.r)] === T_ROAD;
    if (!(left || right)) continue; // 只放在水平直道
    const wx = p.c * TILE + TILE / 2, wy = p.r * TILE + TILE / 2;
    if (Math.hypot(wx - startWX, wy - startWY) < 100) continue; // 远离起点
    if (cardPoints.some((q) => Math.abs(q.x - wx) < TILE && Math.abs(q.y - wy) < TILE)) continue; // 避开卡点
    // 汽车：视觉矩形较大，碰撞框很薄且贴道路边缘，留出宽通道
    const side = Math.random() < 0.5 ? -1 : 1; // -1 左, +1 右
    const vw = TILE * 0.50, vh = TILE * 0.30; // 视觉尺寸
    const cx = wx + side * TILE * 0.14;
    const cy = wy - TILE * 0.5 + vh / 2;
    // 碰撞框：贴在道路最边缘的窄条，玩家从路中间走不会碰
    const cw = TILE * 0.30, ch = 3;
    const colCy = wy - TILE * 0.5 + ch / 2 + 1;
    cars.push({
      x: cx - vw / 2, y: cy - vh / 2, // 视觉
      cx, cy, // 视觉中心
      hw: cw / 2, hh: ch / 2, // 碰撞半宽高
      colCx: cx, colCy, // 碰撞中心
      color: carColors[randInt(0, carColors.length - 1)], dir: 'h'
    });
  }
  map.cars = cars;
  map.featherTotal = feathers.length;
  return map;
}

// 按本局捕手 tag，在可达路面随机散布借口卡拾取物（保证"生成了某捕手就有应对卡"）
function placeExcusePickups(map, tags) {
  const { cols, rows, tile, grid } = map;
  const idx = (c, r) => r * cols + c;
  const startCell = { c: Math.floor(map.start.x / tile), r: Math.floor(map.start.y / tile) };
  const reach = reachableSet(map, startCell);
  const byTag = {};
  for (const e of EXCUSES) (byTag[e.tag] = byTag[e.tag] || []).push(e);
  const pool = [];
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    const i = idx(c, r);
    if (grid[i] === T_ROAD && reach.has(i)) pool.push({ c, r });
  }
  const shuffled = shuffle(pool);
  const pickups = [];
  const used = new Set();
  const nearStart = (cc, rr) => Math.hypot(cc * tile - map.start.x, rr * tile - map.start.y) < tile * 3;
  const nearCard = (cc, rr) => (map.cardPoints || []).some(
    (p) => Math.abs(p.x - (cc * tile + tile / 2)) < tile * 1.5 && Math.abs(p.y - (rr * tile + tile / 2)) < tile * 1.5);
  const PER = 2; // 每个 tag 撒 2 张，足够应对一只捕手
  for (const tag of tags) {
    const excs = byTag[tag];
    if (!excs || !excs.length) continue;
    let placed = 0;
    for (const cell of shuffled) {
      if (placed >= PER) break;
      const i = idx(cell.c, cell.r);
      if (used.has(i)) continue;
      if (nearStart(cell.c, cell.r) || nearCard(cell.c, cell.r)) continue;
      const card = excs[randInt(0, excs.length - 1)];
      pickups.push({
        x: cell.c * tile + tile / 2, y: cell.r * tile + tile / 2,
        tag, rarity: card.rarity, id: card.id, name: card.name, got: false,
      });
      used.add(i); placed++;
    }
  }
  return pickups;
}

// ---------- 道路升级：斜路 / 环岛 / 弯曲小路 ----------
function isRoad(grid, cols, rows, c, r) {
  if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
  return grid[r * cols + c] === T_ROAD;
}
function isBuild(grid, cols, rows, c, r) {
  if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
  return grid[r * cols + c] === T_BUILD;
}

// 斜向连接：把"两个对角都是道路"的建筑格打通，形成斜穿街区
function addDiagonalRoads(grid, cols, rows) {
  const idx = (c, r) => r * cols + c;
  let changed = true, passes = 0;
  while (changed && passes < 3) {
    changed = false; passes++;
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (grid[idx(c, r)] !== T_BUILD) continue;
        // 左上-右下对角
        const d1 = isRoad(grid, cols, rows, c - 1, r - 1) && isRoad(grid, cols, rows, c + 1, r + 1);
        // 右上-左下对角
        const d2 = isRoad(grid, cols, rows, c + 1, r - 1) && isRoad(grid, cols, rows, c - 1, r + 1);
        if ((d1 || d2) && Math.random() < 0.45) {
          grid[idx(c, r)] = T_ROAD;
          changed = true;
        }
      }
    }
  }
}

// 环岛：把部分十字路口中心变成岛，四周环形可走
function addRoundabouts(grid, cols, rows) {
  const idx = (c, r) => r * cols + c;
  const centers = [];
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      if (isRoad(grid, cols, rows, c, r) &&
          isRoad(grid, cols, rows, c - 1, r) && isRoad(grid, cols, rows, c + 1, r) &&
          isRoad(grid, cols, rows, c, r - 1) && isRoad(grid, cols, rows, c, r + 1)) {
        centers.push({ c, r });
      }
    }
  }
  shuffle(centers);
  const limit = Math.floor(centers.length * 0.25) + randInt(1, 2);
  for (let k = 0; k < Math.min(limit, centers.length); k++) {
    const { c, r } = centers[k];
    // 3x3 环岛：中心为岛，四周环形道路
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (dr === 0 && dc === 0) grid[idx(nc, nr)] = T_BUILD;
        else grid[idx(nc, nr)] = T_ROAD;
      }
    }
  }
}

// 弯曲小路：从道路边界随机向建筑街区穿几条蛇形小路
function addWindingPaths(grid, cols, rows) {
  const idx = (c, r) => r * cols + c;
  const starts = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[idx(c, r)] !== T_BUILD) continue;
      const nbr = [[c+1,r],[c-1,r],[c,r+1],[c,r-1]].filter(([nc,nr]) => isRoad(grid,cols,rows,nc,nr)).length;
      if (nbr === 1) starts.push({ c, r });
    }
  }
  shuffle(starts);
  const pathCount = Math.floor(starts.length * 0.08) + 2;
  for (let i = 0; i < Math.min(pathCount, starts.length); i++) {
    let { c, r } = starts[i];
    let life = randInt(8, 22);
    while (life-- > 0) {
      if (c < 1 || r < 1 || c >= cols - 1 || r >= rows - 1) break;
      if (grid[idx(c, r)] === T_ROAD) break; // 已穿出
      // 保持街区基本形状：不挖穿太薄的墙（避免制造过多小方块）
      const buildNbr = [[c+1,r],[c-1,r],[c,r+1],[c,r-1]].filter(([nc,nr]) => isBuild(grid,cols,rows,nc,nr)).length;
      if (buildNbr < 2) break;
      grid[idx(c, r)] = T_ROAD;
      // 随机转向，优先保持方向
      const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
      const [dc, dr] = dirs[randInt(0, dirs.length - 1)];
      c += dc; r += dr;
    }
  }
}

// 从起点 BFS，确认 required（{c,r} 列表）全部可达（仅走 T_ROAD）
function reachable(map, start, required) {
  const seen = reachableSet(map, start);
  const { cols } = map;
  const idx = (c, r) => r * cols + c;
  for (const p of required) if (!seen.has(idx(p.c, p.r))) return false;
  return true;
}
// 返回从起点可达的所有 T_ROAD 瓦片索引集合（排除栏杆，汽车不阻断 tile 不计入）
function reachableSet(map, start) {
  const { cols, rows, grid } = map;
  const idx = (c, r) => r * cols + c;
  const seen = new Set();
  const q = [start];
  seen.add(idx(start.c, start.r));
  while (q.length) {
    const { c, r } = q.shift();
    const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
    for (const [nc, nr] of nb) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const i = idx(nc, nr);
      if (seen.has(i)) continue;
      if (grid[i] !== T_ROAD) continue;
      seen.add(i);
      q.push({ c: nc, r: nr });
    }
  }
  return seen;
}

module.exports = { generate, placeExcusePickups, TILE, T_BUILD, T_ROAD, T_RAIL, B_HOME, B_COMPANY, B_MALL, B_SCHOOL, B_CINEMA, B_PARK };
