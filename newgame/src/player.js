// ============================================
// 鸽子主角：只能在道路上移动（撞建筑/栏杆不可走，可沿墙滑动）
//   收集羽毛；持有借口卡组与技能卡；可主动释放技能
// ============================================
const { clamp } = require('./utils.js');
const R = require('./render.js');

class Player {
  constructor(map, x, y) {
    this.map = map;
    this.x = x; this.y = y;
    this.r = 13;
    this.baseSpeed = 165;
    this.facing = { x: 0, y: 1 };
    this.deck = [];      // 借口卡 {id,name,tag,rarity}
    this.skills = [];    // 技能卡 {id,name,skill}
    this.speedTimer = 0;
    this.stealthTimer = 0;
    this.magnetTimer = 0;
    this.blinkCd = 0;
    this.speedCd = 0;     // 加速冷却（避免永久加速）
    this.stealthCd = 0;   // 反追踪冷却（避免永久隐身）
    this.magnetCd = 0;    // 磁铁冷却（避免永久吸附）
    // 技能基础冷却（秒）
    this.speedCdBase = 8;
    this.stealthCdBase = 12;
    this.magnetCdBase = 10;
    this.invuln = 0;     // 脱身后的短暂无敌，避免连续判定
    this.debuffs = [];   // 鸽掉捕手附带的代价 {type,value,dur,name}
    this.lastMoveDir = { x: 0, y: 1 }; // 最后有效移动方向（闪现用）
  }
  get speed() {
    let mul = 1;
    for (const d of this.debuffs) if (d.type === 'speed' && d.dur > 0) mul *= d.value;
    return this.baseSpeed * (this.speedTimer > 0 ? 1.7 : 1) * mul;
  }
  get stealth() { return this.stealthTimer > 0; }

  // 四方向采样判定圆形是否站在可行走路面，且不与任何汽车相碰
  _canStand(px, py) {
    const r = this.r;
    if (!this.map.walkableAt(px, py)) return false;
    if (!this.map.walkableAt(px + r, py)) return false;
    if (!this.map.walkableAt(px - r, py)) return false;
    if (!this.map.walkableAt(px, py + r)) return false;
    if (!this.map.walkableAt(px, py - r)) return false;
    if (this.map.carHit(px, py, r)) return false;
    return true;
  }

  update(dt, input) {
    if (this.speedTimer > 0) this.speedTimer -= dt;
    if (this.stealthTimer > 0) this.stealthTimer -= dt;
    if (this.magnetTimer > 0) this.magnetTimer -= dt;
    if (this.blinkCd > 0) this.blinkCd -= dt;
    if (this.speedCd > 0) this.speedCd -= dt;
    if (this.stealthCd > 0) this.stealthCd -= dt;
    if (this.magnetCd > 0) this.magnetCd -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    for (let i = this.debuffs.length - 1; i >= 0; i--) {
      this.debuffs[i].dur -= dt;
      if (this.debuffs[i].dur <= 0) this.debuffs.splice(i, 1);
    }

    let dx = input.dirX, dy = input.dirY;
    const len = Math.hypot(dx, dy);
    if (len > 0.15) {
      dx /= len; dy /= len;
      this.facing = { x: dx, y: dy };
      this.lastMoveDir = { x: dx, y: dy };
      const step = this.speed * dt;
      const nx = this.x + dx * step;
      if (this._canStand(nx, this.y)) this.x = nx;
      const ny = this.y + dy * step;
      if (this._canStand(this.x, ny)) this.y = ny;
    }
    // 磁铁：吸附附近羽毛
    if (this.magnetTimer > 0) {
      for (const f of this.map.feathers) {
        if (f.got) continue;
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < 140) {
          f.x += (this.x - f.x) * Math.min(1, dt * 4);
          f.y += (this.y - f.y) * Math.min(1, dt * 4);
        }
      }
    }
  }

  useSkill(skill) {
    if (skill === 'speed' && !this.skills.some((s) => s.skill === 'speed')) return false;
    if (skill === 'blink') {
      if (this.blinkCd > 0) return false;
      const dash = 130;
      const dir = this.lastMoveDir || { x: 0, y: 1 };
      const tx = this.x + dir.x * dash;
      const ty = this.y + dir.y * dash;
      // 分步移动到第一个不可行走点之前
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const cx = this.x + (tx - this.x) * (i / steps);
        const cy = this.y + (ty - this.y) * (i / steps);
        if (this._canStand(cx, cy)) { this.x = cx; this.y = cy; }
        else break;
      }
      this.blinkCd = 2.5;
      return true;
    }
    if (skill === 'speed') {
      if (this.speedCd > 0) return false;
      this.speedTimer = 3; this.speedCd = this.speedCdBase; return true;
    }
    if (skill === 'antitrace') {
      if (this.stealthCd > 0) return false;
      this.stealthTimer = 4; this.stealthCd = this.stealthCdBase; return true;
    }
    if (skill === 'magnet') {
      if (this.magnetCd > 0) return false;
      this.magnetTimer = 6; this.magnetCd = this.magnetCdBase; return true;
    }
    return false;
  }

  addCard(card) {
    if (card.kind === 'excuse') this.deck.push({ id: card.id, name: card.name, tag: card.tag, rarity: card.rarity });
    else this.skills.push({ id: card.id, name: card.name, skill: card.skill });
  }

  // 是否有匹配某 tag 的借口卡
  hasExcuse(tag) { return this.deck.some((c) => c.tag === tag); }
  consumeExcuse(tag) {
    const i = this.deck.findIndex((c) => c.tag === tag);
    if (i >= 0) return this.deck.splice(i, 1)[0];
    return null;
  }
  // 鸽掉捕手后，按所用借口卡附带 debuff（强借口代价大）
  applyDebuff(card) {
    if (card && card.debuff) this.debuffs.push({ type: card.debuff.type, value: card.debuff.value, dur: card.debuff.dur, name: card.name });
  }

  draw(ctx, t) {
    const size = 34;
    // 闪现冷却环 / 隐身提示
    if (this.stealth) {
      ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = '#5b9be0';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    R.drawPixelPigeon(ctx, this.x - size / 2, this.y - size / 2 - 4, size, { variant: 'default', accent: '#f2a24b' });
  }
}

module.exports = Player;
