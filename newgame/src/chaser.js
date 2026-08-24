// ============================================
// 捕手：约你的人（老板/女友/亲戚/朋友/邻居）
//   - 在固定巡逻区内活动，玩家靠近则追捕
//   - 随机"远距离技能"（电话轰炸/定位）：在玩家附近生成临时追兵 hunter
//   - 接触玩家 → 游戏层判定：有匹配借口则鸽掉，否则失败
// ============================================
const { rand, randInt, dist, clamp } = require('./utils.js');
const R = require('./render.js');

// ---- 道路碰撞 / 寻路辅助 ----
// 圆形（半径 r）四向采样是否都站在道路上，且不与汽车相碰
function canStand(map, ent, px, py) {
  const r = ent.r || 14;
  return map.walkableAt(px + r, py) && map.walkableAt(px - r, py) &&
         map.walkableAt(px, py + r) && map.walkableAt(px, py - r) &&
         !map.carHit(px, py, r);
}
// 轴分离移动：逐轴尝试，撞墙则该轴不动（沿墙滑动），保证只走道路、绝不穿墙
function moveWithCollision(map, ent, tx, ty, speed, dt) {
  const dx = tx - ent.x, dy = ty - ent.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const step = speed * dt;
  const nx = ent.x + ux * step;
  if (canStand(map, ent, nx, ent.y)) ent.x = nx;
  const ny = ent.y + uy * step;
  if (canStand(map, ent, ent.x, ny)) ent.y = ny;
}
// navField 中"朝玩家"的下一道路瓦片中心；无效则返回 null（回退为直奔玩家）
function stepToward(navField, map, x, y) {
  if (!navField) return null;
  const T = map.tile, cols = map.cols;
  const c = Math.floor(x / T), r = Math.floor(y / T);
  const i = r * cols + c;
  const nx = navField[i];
  if (nx === undefined || nx < 0 || nx === i) return null;
  const ncx = nx % cols, ncy = Math.floor(nx / cols);
  return { x: ncx * T + T / 2, y: ncy * T + T / 2 };
}
// 找离 (x,y) 最近的可行走道路瓦片中心（BFS 扩散），并尽量避开汽车（r 为实体半径）
function nearestRoadTile(map, x, y, r) {
  const T = map.tile, cols = map.cols, rows = map.rows;
  let c = clamp(Math.floor(x / T), 0, cols - 1), r0 = clamp(Math.floor(y / T), 0, rows - 1);
  const idx = (cc, rr) => rr * cols + cc;
  if (map.grid[r0 * cols + c] === 1) {
    const p = { x: c * T + T / 2, y: r0 * T + T / 2 };
    if (!r || !map.carHit(p.x, p.y, r)) return p;
  }
  const seen = new Set([r0 * cols + c]);
  const q = [{ c, r: r0 }];
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const k = idx(cur.c, cur.r);
    if (map.grid[k] === 1) {
      const p = { x: cur.c * T + T / 2, y: cur.r * T + T / 2 };
      if (!r || !map.carHit(p.x, p.y, r)) return p;
    }
    for (const [nc, nr] of [[cur.c + 1, cur.r], [cur.c - 1, cur.r], [cur.c, cur.r + 1], [cur.c, cur.r - 1]]) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nk = idx(nc, nr);
      if (seen.has(nk)) continue;
      seen.add(nk);
      q.push({ c: nc, r: nr });
    }
  }
  // 兜底：即便在汽车里也返回最近道路中心，避免崩溃
  return { x: c * T + T / 2, y: r0 * T + T / 2 };
}

const CHASER_TYPES = [
  { type: 'boss',     name: '老板',   vuln: 'work',   variant: 'tiege',  color: '#a8c4dd' },
  { type: 'gf',       name: '女友',   vuln: 'sick',   variant: 'ruange', color: '#f4d8a8' },
  { type: 'relative', name: '亲戚',   vuln: 'family', variant: 'geywang',color: '#cdb9ec' },
  { type: 'friend',   name: '朋友',   vuln: 'rest',   variant: 'mengge', color: '#b8e6d9' },
  { type: 'neighbor', name: '邻居',   vuln: 'home',   variant: 'laoge',  color: '#8a8a9e' },
];

class Chaser {
  constructor(def, home, speedMul, map) {
    this.def = def;
    this.vuln = def.vuln;
    this.name = def.name;
    this.variant = def.variant;
    this.color = def.color;
    this.home = home; // {x0,y0,x1,y1}
    this.map = map;
    // 初始位置 snap 到最近道路瓦片中心，并避开汽车
    const c0 = nearestRoadTile(map, (home.x0 + home.x1) / 2, (home.y0 + home.y1) / 2, this.r);
    this.x = c0.x; this.y = c0.y;
    this.r = 14;
    this.catchR = 22;
    this.alertR = 150;                 // 缩小警戒/脱战半径，迷宫才有意义
    this.patrolSpeed = 70;
    this.chaseSpeed = 150 * speedMul;  // 提速以补偿"只能走道路、不能穿墙"
    this.state = 'active'; // active | pigeoned
    this.skillTimer = rand(4, 9);
    this.skillInterval = rand(7, 11);
    this.hunters = [];
    this.tx = this.x; this.ty = this.y;
    this.pickTarget();
    this.flash = 0;
  }
  pickTarget() {
    this.tx = rand(this.home.x0, this.home.x1);
    this.ty = rand(this.home.y0, this.home.y1);
  }
  spawnHunter(player, map) {
    // 在玩家附近随机方向生成追兵，snap 到最近道路瓦片（不穿墙）
    const ang = rand(0, Math.PI * 2);
    const d = 250;
    const hx = clamp(player.x + Math.cos(ang) * d, 20, map.worldW - 20);
    const hy = clamp(player.y + Math.sin(ang) * d, 20, map.worldH - 20);
    const c = nearestRoadTile(map, hx, hy, 12);
    this.hunters.push({ x: c.x, y: c.y, life: 5, speed: 150, r: 12 });
  }
  update(dt, player, map, difficulty, navField) {
    if (this.flash > 0) this.flash -= dt;
    if (this.state !== 'active') {
      // 已鸽掉：追兵也消失
      this.hunters.length = 0;
      return;
    }
    const stealth = player.stealth;
    // 远距离技能
    this.skillTimer -= dt;
    if (this.skillTimer <= 0) {
      if (!stealth) this.spawnHunter(player, map);
      this.skillTimer = this.skillInterval * (1 - Math.min(0.4, difficulty * 0.05));
    }
    // 追兵：沿道路朝玩家移动（用 navField 走最短路径，碰撞保护不穿墙）
    for (let i = this.hunters.length - 1; i >= 0; i--) {
      const h = this.hunters[i];
      h.life -= dt;
      if (h.life <= 0) { this.hunters.splice(i, 1); continue; }
      if (!stealth) {
        const step = stepToward(navField, map, h.x, h.y);
        if (step) moveWithCollision(map, h, step.x, step.y, h.speed, dt);
        else moveWithCollision(map, h, player.x, player.y, h.speed, dt);
      }
    }
    // 自身：玩家在警戒范围且未隐身 → 沿道路追；否则巡逻 / 回巢
    const d = dist(this.x, this.y, player.x, player.y);
    if (!stealth && d < this.alertR) {
      const step = stepToward(navField, map, this.x, this.y);
      if (step) moveWithCollision(map, this, step.x, step.y, this.chaseSpeed, dt);
      else moveWithCollision(map, this, player.x, player.y, this.chaseSpeed, dt);
      this.flash = 0.2;
    } else {
      moveWithCollision(map, this, this.tx, this.ty, this.patrolSpeed, dt);
      if (dist(this.x, this.y, this.tx, this.ty) < 14) this.pickTarget();
      // 回到巢内
      this.x = clamp(this.x, this.home.x0 - 60, this.home.x1 + 60);
      this.y = clamp(this.y, this.home.y0 - 60, this.home.y1 + 60);
    }
  }
  // 返回所有接触威胁（自身 + 追兵）；隐身时返回空
  threats(player) {
    if (player.stealth || this.state !== 'active') return [];
    const list = [];
    if (dist(this.x, this.y, player.x, player.y) < this.catchR + player.r) list.push(this);
    for (const h of this.hunters) {
      if (dist(h.x, h.y, player.x, player.y) < h.r + player.r) list.push(this); // 归到原捕手
    }
    return list;
  }
  reactivate() { this.state = 'active'; this.skillTimer = rand(4, 8); }

  draw(ctx, player, t) {
    if (this.state !== 'active') return;
    const alert = this.flash > 0;
    // 追兵
    for (const h of this.hunters) {
      R.drawChaserAura(ctx, h.x, h.y, h.r + 6, '#ff6b6b', true);
      R.drawPixelPigeon(ctx, h.x - 13, h.y - 17, 26, { variant: 'default', body: '#ff8a8a' });
    }
    R.drawChaserAura(ctx, this.x, this.y, this.r + 8, this.color, alert);
    R.drawPixelPigeon(ctx, this.x - 17, this.y - 21, 34, { variant: this.variant, accent: this.color });
    // 名字牌
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, this.x, this.y - 30);
  }
}

module.exports = { Chaser, CHASER_TYPES };
