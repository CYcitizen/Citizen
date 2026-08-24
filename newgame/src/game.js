// ============================================
// 《我是鸽手·城市迷宫》主循环
//   状态：menu → playing →（cardpick 抽卡覆盖层 / encounter 遭遇出示卡）→ win / lose
//   核心循环：躲开"约你的人" → 捡羽毛攒分 → 到抽卡点补借口/技能
//           → 主动/被动接触捕手 → 进入遭遇，出示匹配借口鸽掉他（附带 debuff）
//           → 鸽掉所有人即过关
// ============================================
const Input = require('./input.js');
const { generate, placeExcusePickups, T_ROAD } = require('./map.js');
const Player = require('./player.js');
const { Chaser, CHASER_TYPES } = require('./chaser.js');
const Cards = require('./cards.js');
const R = require('./render.js');
const { clamp, dist } = require('./utils.js');

class Game {
  constructor() {
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
    this.W = win.windowWidth || win.screenWidth;
    this.H = win.windowHeight || win.screenHeight;
    this.dpr = win.pixelRatio || 1;
    this.canvas = wx.createCanvas();
    // 按设备像素比放大物理像素，逻辑坐标仍用 CSS 像素（与 touch 坐标一致）
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(this.dpr, this.dpr);
    this.input = new Input();
    this.cam = { x: 0, y: 0 };
    this.last = Date.now();
    this.toastText = ''; this.toastTimer = 0; this.toastColor = '#fff';
    this.state = 'menu';
    this.overMsg = '';
    this.reset();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  reset() {
    const cols = 36, rows = 56;
    this.map = generate(cols, rows);
    this.player = new Player(this.map, this.map.start.x, this.map.start.y);
    // 不预发任何卡：借口卡只能本局从散落卡 / 抽卡点获取
    this.navField = null;     // 朝玩家的道路导航场（BFS came 数组）
    this._navTimer = 0;
    // 捕手：初始激活 3 个，其余随时间加入（难度上升）
    this.chasers = [];
    const types = CHASER_TYPES.slice();
    // 随机分配巡逻区（分散在地图不同区域）
    const zones = this._zones(5);
    types.forEach((def, i) => {
      const speedMul = 1;
      const ch = new Chaser(def, zones[i], speedMul, this.map);
      ch.activatedAt = i < 3 ? 0 : (i === 3 ? 35 : 70); // 朋友 35s、邻居 70s 加入
      if (i >= 3) ch.state = 'pending'; // 未激活
      this.chasers.push(ch);
    });
    // 按本局生成的捕手弱点，在地图随机位置撒对应借口卡（保证"生成了某捕手就有应对卡"）
    const tags = this.chasers.map((c) => c.vuln);
    this.map.excusePickups = placeExcusePickups(this.map, tags);
    this.elapsed = 0;
    this.featherGot = 0;
    this.cardPick = null; // {choices, point}
    this.encounter = null; // {ch, matches}
    this.state = 'menu';
    this.overMsg = '';
  }

  _zones(n) {
    // 把地图切成 n 个大致均匀的区域，每区一个巡逻矩形
    const m = this.map;
    const zx = 3, zy = 2; // 3x2 网格
    const cw = m.worldW / zx, ch = m.worldH / zy;
    const cells = [];
    for (let r = 0; r < zy; r++) for (let c = 0; c < zx; c++) cells.push({ c, r });
    // 洗牌后取前 n 个
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    const out = [];
    for (let i = 0; i < n; i++) {
      const cell = cells[i % cells.length];
      const x0 = cell.c * cw + 40, y0 = cell.r * ch + 40;
      out.push({ x0, y0, x1: x0 + cw - 80, y1: y0 + ch - 80 });
    }
    return out;
  }

  toast(text, color) { this.toastText = text; this.toastTimer = 1.4; this.toastColor = color || '#fff'; }

  // ---------------- 主循环 ----------------
  loop() {
    const now = Date.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.loop);
  }

  update(dt) {
    if (this.toastTimer > 0) this.toastTimer -= dt;
    // 消费点击（菜单/抽卡/结算）
    this._processTaps();

    if (this.state !== 'playing') return;

    this.elapsed += dt;
    const difficulty = this.elapsed / 45;

    // 激活新捕手
    for (const ch of this.chasers) {
      if (ch.state === 'pending' && this.elapsed >= ch.activatedAt) {
        ch.state = 'active';
        this.toast(ch.name + ' 也来约你了！', ch.color);
      }
    }
    // 抽卡点冷却；玩家离开后才解除 used，可再次抽卡（避免站在点上反复弹窗）
    for (const p of this.map.cardPoints) {
      if (p.cd > 0) p.cd -= dt;
      if (p.used && p.cd <= 0 && dist(p.x, p.y, this.player.x, this.player.y) > 40) p.used = false;
    }

    // 玩家
    this.player.update(dt, this.input);
    // 羽毛收集
    for (const f of this.map.feathers) {
      if (f.got) continue;
      if (dist(f.x, f.y, this.player.x, this.player.y) < this.player.r + 10) {
        f.got = true; this.featherGot++;
      }
    }
    // 散落借口卡收集（只能本局获取）
    if (this.map.excusePickups) {
      for (const p of this.map.excusePickups) {
        if (p.got) continue;
        if (dist(p.x, p.y, this.player.x, this.player.y) < this.player.r + 10) {
          p.got = true;
          this.player.deck.push({ id: p.id, name: p.name, tag: p.tag, rarity: p.rarity });
          this.toast('捡到借口：' + p.name, '#f5c542');
        }
      }
    }
    // 抽卡点触发
    for (const p of this.map.cardPoints) {
      if (!p.used && p.cd <= 0 && dist(p.x, p.y, this.player.x, this.player.y) < 26) {
        p.used = true; p.cd = 10;
        this.cardPick = { choices: Cards.drawChoices(3, this.chasers.map((c) => c.vuln)), point: p };
        this.state = 'cardpick';
        return;
      }
    }
    // 导航场：从玩家出发 BFS 出"朝玩家"的下一步道路（节流重算，所有捕手共用）
    if (!this.navField || this._navTimer <= 0) { this.navField = this._buildNavField(); this._navTimer = 0.2; }
    this._navTimer -= dt;
    // 捕手
    for (const ch of this.chasers) {
      if (ch.state === 'active') ch.update(dt, this.player, this.map, difficulty, this.navField);
      const threats = ch.threats(this.player);
      if (threats.length && this.player.invuln <= 0) { this.resolveEncounter(ch); break; }
    }
    // 相机
    this.cam.x = clamp(this.player.x - this.W / 2, 0, Math.max(0, this.map.worldW - this.W));
    this.cam.y = clamp(this.player.y - this.H / 2, 0, Math.max(0, this.map.worldH - this.H));

    this.checkWin();
  }

  resolveEncounter(ch) {
    // 进入"遭遇"状态：暂停世界，让玩家主动出示匹配借口牌
    this.encounter = { ch, matches: this.player.deck.filter((c) => c.tag === ch.vuln) };
    this.state = 'encounter';
  }

  checkWin() {
    if (this.state !== 'playing') return;
    const allPigeoned = this.chasers.every((c) => c.state === 'pigeoned');
    const featherWin = this.featherGot >= Math.ceil(this.map.featherTotal * 0.5);
    if (allPigeoned) this.win('你把所有人都鸽了一遍！');
    else if (featherWin) this.win('集齐羽毛，潇洒离场！');
  }

  win(msg) { this.state = 'win'; this.overMsg = msg; }
  lose(msg) { this.state = 'lose'; this.overMsg = msg; }

  // 从玩家所在道路瓦片出发做 BFS，记录每个道路瓦片"朝玩家"的下一跳索引。
  // 返回值 Int32Array：came[i] 为瓦片 i 朝玩家的相邻道路瓦片索引（未访问为 -1）。
  // 所有捕手共用此场，沿 came 走即得到最短道路路径，且不穿墙。
  _buildNavField() {
    const m = this.map, cols = m.cols, rows = m.rows, T = m.tile;
    const idx = (c, r) => r * cols + c;
    let sc = Math.floor(this.player.x / T), sr = Math.floor(this.player.y / T);
    sc = clamp(sc, 0, cols - 1); sr = clamp(sr, 0, rows - 1);
    const came = new Int32Array(cols * rows).fill(-1);
    const start = idx(sc, sr);
    const q = [start]; came[start] = start;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const c = cur % cols, r = (cur / cols) | 0;
      const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [nc, nr] of nb) {
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = idx(nc, nr);
        if (!m.walkable(nc, nr)) continue; // 只走道路（同时排除栏杆/汽车）
        if (came[ni] !== -1) continue;
        came[ni] = cur; q.push(ni);
      }
    }
    return came;
  }

  // ---------------- 输入 ----------------
  _processTaps() {
    const taps = this.input.tapQueue;
    if (!taps.length) return;
    if (this.state === 'menu') {
      while (taps.length) {
        const t = taps.shift();
        if (this._inBtn(t, this._startBtn())) { this.state = 'playing'; this.last = Date.now(); }
      }
    } else if (this.state === 'cardpick') {
      while (taps.length) {
        const t = taps.shift();
        if (!this.cardPick) break; // 已选完，丢弃本帧剩余点击
        for (let i = 0; i < this.cardPick.choices.length; i++) {
          if (this._inBtn(t, this._cardBtn(i))) {
            this.player.addCard(this.cardPick.choices[i]);
            this.toast('获得 ' + this.cardPick.choices[i].name, '#f5c542');
            this.cardPick = null;
            this.state = 'playing';
            this.last = Date.now();
            break;
          }
        }
      }
    } else if (this.state === 'win' || this.state === 'lose') {
      while (taps.length) {
        const t = taps.shift();
        if (this._inBtn(t, this._restartBtn())) { this.reset(); this.state = 'playing'; this.last = Date.now(); }
      }
    } else if (this.state === 'encounter') {
      const enc = this.encounter;
      while (taps.length) {
        if (!enc) break;
        const t = taps.shift();
        const ch = enc.ch;
        const matches = enc.matches || [];
        const n = Math.min(matches.length, 3);
        let handled = false;
        for (let i = 0; i < n; i++) {
          if (this._inBtn(t, this._encCardBtn(i))) {
            const c = matches[i];
            this.player.consumeExcuse(ch.vuln);
            const full = Cards.EXCUSES.find((e) => e.id === c.id);
            this.player.applyDebuff(full);
            ch.state = 'pigeoned';
            this.player.invuln = 1.6;
            this.toast('鸽掉 ' + ch.name + '！', '#5fc46b');
            this.encounter = null;
            this.state = 'playing';
            this.last = Date.now();
            handled = true;
            break;
          }
        }
        if (handled) break;
        if (this._inBtn(t, this._encEscapeBtn())) {
          // 硬扛逃跑：重减速 debuff + 短无敌，捕手继续追
          this.player.debuffs.push({ type: 'speed', value: 0.55, dur: 12, name: '硬扛' });
          this.player.invuln = 2.5;
          this.toast('硬扛溜走，但腿脚慢了', '#e0703a');
          this.encounter = null;
          this.state = 'playing';
          this.last = Date.now();
          break;
        }
        if (this._inBtn(t, this._encGiveBtn())) {
          this.encounter = null;
          this.lose('被 ' + ch.name + ' 逮个正着，认栽了…');
          break;
        }
      }
    } else if (this.state === 'playing') {
      // 技能按钮
      while (taps.length) {
        const t = taps.shift();
        const btns = this._skillBtns();
        for (const b of btns) {
          if (this._inBtn(t, b)) { this.player.useSkill(b.skill); break; }
        }
      }
    }
  }
  _inBtn(t, b) { return t && t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h; }
  _startBtn() { return { x: this.W / 2 - 90, y: this.H * 0.62, w: 180, h: 56 }; }
  _restartBtn() { return { x: this.W / 2 - 90, y: this.H * 0.66, w: 180, h: 52 }; }
  _cardBtn(i) {
    const w = this.W * 0.26, gap = this.W * 0.02;
    const total = w * 3 + gap * 2;
    const x0 = (this.W - total) / 2;
    return { x: x0 + i * (w + gap), y: this.H * 0.46, w, h: this.H * 0.26 };
  }
  _skillBtns() {
    // 右上角（顶栏下方），避开底部浮动摇杆常驻的拇指区
    const owned = {};
    for (const s of this.player.skills) owned[s.skill] = s.name;
    const list = Object.keys(owned);
    const bw = 66, bh = 52, gap = 8;
    const total = list.length * bw + (list.length - 1) * gap;
    const x0 = this.W - total - 12;
    const y = 56;
    return list.map((sk, i) => {
      let cd = 0, active = 0;
      if (sk === 'blink') cd = this.player.blinkCd;
      else if (sk === 'speed') { cd = this.player.speedCd; active = this.player.speedTimer; }
      else if (sk === 'antitrace') { cd = this.player.stealthCd; active = this.player.stealthTimer; }
      else if (sk === 'magnet') { cd = this.player.magnetCd; active = this.player.magnetTimer; }
      return { skill: sk, name: owned[sk], x: x0 + i * (bw + gap), y, w: bw, h: bh, cd, active };
    });
  }

  // ---------------- 渲染 ----------------
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    // 天空底色
    px(ctx, 0, 0, this.W, this.H, '#bfe3f2');

    if (this.state === 'menu') { this._drawMenu(ctx); return; }

    // 世界（相机平移）
    ctx.save();
    ctx.translate(-this.cam.x, -this.cam.y);
    this._drawWorld(ctx);
    ctx.restore();

    this._drawHUD(ctx);

    if (this.state === 'cardpick') this._drawCardPick(ctx);
    if (this.state === 'encounter') this._drawEncounter(ctx);
    if (this.state === 'win' || this.state === 'lose') this._drawResult(ctx);
  }

  _drawWorld(ctx) {
    const m = this.map, T = m.tile;
    const c0 = Math.max(0, Math.floor(this.cam.x / T) - 1);
    const c1 = Math.min(m.cols - 1, Math.ceil((this.cam.x + this.W) / T) + 1);
    const r0 = Math.max(0, Math.floor(this.cam.y / T) - 1);
    const r1 = Math.min(m.rows - 1, Math.ceil((this.cam.y + this.H) / T) + 1);
    const ty = (v) => v === 1 ? 'road' : (v === 2 ? 'rail' : 'build');
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = m.grid[r * m.cols + c];
        const x = c * T, y = r * T;
        if (t === 1) {
          const up = r > 0 ? m.grid[(r - 1) * m.cols + c] : 0;
          const down = r < m.rows - 1 ? m.grid[(r + 1) * m.cols + c] : 0;
          const left = c > 0 ? m.grid[r * m.cols + c - 1] : 0;
          const right = c < m.cols - 1 ? m.grid[r * m.cols + c + 1] : 0;
          R.drawRoadTile(ctx, x, y, T, { up: ty(up), down: ty(down), left: ty(left), right: ty(right) });
        } else if (t === 2) R.drawRailTile(ctx, x, y, T, (c + r) % 2 === 0);
        else {
          const ri = m.bregion[r * m.cols + c];
          const reg = ri >= 0 ? m.buildings[ri] : null;
          R.drawBuildingTile(ctx, x, y, T, m.btype[r * m.cols + c], reg, c, r, m);
        }
      }
    }
    // 装饰车流
    if (m.cars) for (const car of m.cars) R.drawCar(ctx, car.x, car.y, T, car.color, car.dir);
    // 抽卡点
    for (const p of m.cardPoints) R.drawCardPoint(ctx, p.x - T / 2, p.y - T / 2, T, Date.now(), p.used);
    // 羽毛
    for (const f of m.feathers) if (!f.got) R.drawFeather(ctx, f.x, f.y, 16, Date.now());
    // 散落借口卡（匹配本局捕手）
    if (m.excusePickups) for (const p of m.excusePickups) if (!p.got) R.drawExcusePickup(ctx, p.x, p.y, T, p.tag, Date.now());
    // 捕手
    for (const ch of this.chasers) { R.drawShadow(ctx, ch.x, ch.y, ch.r || 14); ch.draw(ctx, this.player, Date.now()); }
    // 玩家
    R.drawShadow(ctx, this.player.x, this.player.y, this.player.r || 14);
    this.player.draw(ctx, Date.now());
  }

  _drawHUD(ctx) {
    // 顶栏
    R.pixelPanel(ctx, 8, 8, this.W - 16, 40, { bg: 'rgba(43,43,69,0.85)', border: '#2b2b45' });
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const cleared = this.chasers.filter((c) => c.state === 'pigeoned').length;
    const total = this.chasers.length;
    const fpct = Math.floor(this.featherGot / this.map.featherTotal * 100);
    ctx.fillText('🪶' + this.featherGot + '/' + this.map.featherTotal + '(' + fpct + '%)', 16, 28);
    ctx.fillText('鸽掉 ' + cleared + '/' + total, this.W / 2 - 30, 28);
    ctx.fillText('⏱' + Math.floor(this.elapsed) + 's', this.W - 70, 28);

    // 卡组概览（按 tag 计数）
    const cnt = {};
    for (const c of this.player.deck) cnt[c.tag] = (cnt[c.tag] || 0) + 1;
    const tags = ['work', 'sick', 'family', 'rest', 'home'];
    const tagName = { work: '班', sick: '病', family: '亲', rest: '休', home: '家' };
    let tx = 12;
    ctx.font = 'bold 12px "Courier New", monospace';
    for (const tg of tags) {
      const n = cnt[tg] || 0;
      ctx.fillStyle = n ? '#f5c542' : 'rgba(255,255,255,0.35)';
      ctx.fillText(tagName[tg] + ':' + n, tx, this.H - 18);
      tx += 52;
    }

    // 技能按钮（含冷却 / 生效倒计时）—— 仅游戏中显示，避免遮挡抽卡/遭遇覆盖层
    if (this.state === 'playing') {
      for (const b of this._skillBtns()) {
        const cooling = b.cd > 0;
        R.pixelButton(ctx, b.x, b.y, b.w, b.h, b.name, {
          bg: cooling ? '#6b7280' : '#5b9be0', fontSize: 13, disabled: cooling,
        });
        let label = '';
        if (cooling) label = '冷却 ' + b.cd.toFixed(1) + 's';
        else if (b.active > 0) label = b.active.toFixed(1) + 's';
        if (label) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 10px "Courier New", monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(label, b.x + b.w / 2, b.y + b.h - 8);
        }
      }
      // 摇杆
      this.input.draw(ctx);
    }

    // toast
    if (this.toastTimer > 0) {
      ctx.globalAlpha = Math.min(1, this.toastTimer);
      ctx.fillStyle = this.toastColor;
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.toastText, this.W / 2, this.H * 0.3);
      ctx.globalAlpha = 1;
    }
  }

  _drawMenu(ctx) {
    // 标题画面也画一点城市背景
    ctx.save(); ctx.translate(-this.cam.x, -this.cam.y); this._drawWorld(ctx); ctx.restore();
    ctx.fillStyle = 'rgba(43,43,69,0.55)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.fillText('我 是 鸽 手', this.W / 2, this.H * 0.26);
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillStyle = '#f5c542';
    ctx.fillText('· 城市迷宫 ·', this.W / 2, this.H * 0.33);
    ctx.fillStyle = '#fff';
    ctx.font = '13px "Courier New", monospace';
    const lines = [
      '摇杆移动，只能在道路上走',
      '路上散落借口卡 + ? 点抽卡（按本局捕手生成）',
      '接触"约你的人"→出示匹配借口鸽掉 TA（附带减速）',
      '没匹配借口可硬扛逃跑（重减速）或认栽',
      '鸽掉所有人 / 集齐羽毛 = 过关',
    ];
    lines.forEach((l, i) => ctx.fillText(l, this.W / 2, this.H * 0.42 + i * 22));
    R.pixelButton(ctx, this._startBtn().x, this._startBtn().y, this._startBtn().w, this._startBtn().h, '开 始', { fontSize: 20 });
  }

  _drawCardPick(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillText('抽到一张卡（点选）', this.W / 2, this.H * 0.36);
    const rarityColor = { white: '#cfd3e0', blue: '#5b9be0', gold: '#f5c542' };
    for (let i = 0; i < this.cardPick.choices.length; i++) {
      const ch = this.cardPick.choices[i];
      const b = this._cardBtn(i);
      const col = ch.kind === 'skill' ? '#5fc46b' : (rarityColor[ch.rarity] || '#fff');
      R.pixelPanel(ctx, b.x, b.y, b.w, b.h, { bg: '#fffdf5', border: col, bw: 4 });
      ctx.fillStyle = col;
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.fillText(ch.kind === 'skill' ? '[技能]' : ({ white: '白卡', blue: '蓝卡', gold: '金卡' }[ch.rarity]), b.x + b.w / 2, b.y + 22);
      ctx.fillStyle = '#2b2b45';
      ctx.font = 'bold 18px "Courier New", monospace';
      // 自动换行名字
      this._wrapText(ctx, ch.name, b.x + b.w / 2, b.y + b.h / 2, b.w - 12, 20);
      if (ch.kind === 'excuse') {
        ctx.fillStyle = '#8a8a9e';
        ctx.font = '12px "Courier New", monospace';
        ctx.fillText('借口 · ' + this._tagName(ch.tag), b.x + b.w / 2, b.y + b.h - 18);
      }
    }
  }

  _drawEncounter(ctx) {
    const enc = this.encounter;
    if (!enc) return;
    const ch = enc.ch;
    ctx.fillStyle = 'rgba(20,20,35,0.8)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 标题
    ctx.fillStyle = '#ff7b7b';
    ctx.font = 'bold 24px "Courier New", monospace';
    ctx.fillText(ch.name + ' 逮到你了！', this.W / 2, this.H * 0.15);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText('弱点：' + this._tagName(ch.vuln), this.W / 2, this.H * 0.21);
    ctx.fillStyle = '#f5c542';
    ctx.font = '13px "Courier New", monospace';
    ctx.fillText('出示匹配借口牌，鸽掉 TA！', this.W / 2, this.H * 0.255);

    const matches = enc.matches || [];
    if (matches.length === 0) {
      ctx.fillStyle = '#ffb3b3';
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.fillText('你没有匹配「' + this._tagName(ch.vuln) + '」的借口…', this.W / 2, this.H * 0.37);
    } else {
      const rarityColor = { white: '#cfd3e0', blue: '#5b9be0', gold: '#f5c542' };
      const n = Math.min(matches.length, 3);
      for (let i = 0; i < n; i++) {
        const c = matches[i];
        const b = this._encCardBtn(i);
        const col = rarityColor[c.rarity] || '#fff';
        R.pixelPanel(ctx, b.x, b.y, b.w, b.h, { bg: '#fffdf5', border: col, bw: 4 });
        ctx.fillStyle = col;
        ctx.font = 'bold 15px "Courier New", monospace';
        ctx.fillText(({ white: '白卡', blue: '蓝卡', gold: '金卡' }[c.rarity]), b.x + b.w / 2, b.y + 22);
        ctx.fillStyle = '#2b2b45';
        ctx.font = 'bold 18px "Courier New", monospace';
        this._wrapText(ctx, c.name, b.x + b.w / 2, b.y + b.h / 2 - 6, b.w - 12, 20);
        ctx.fillStyle = '#e0703a';
        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.fillText(this._debuffText(c), b.x + b.w / 2, b.y + b.h - 16);
      }
    }
    // 硬扛逃跑（重减速，捕手继续追）
    const esc = this._encEscapeBtn();
    R.pixelButton(ctx, esc.x, esc.y, esc.w, esc.h, '硬扛逃跑（重减速）', { bg: '#e0703a', fontSize: 15 });
    // 认栽
    const give = this._encGiveBtn();
    R.pixelButton(ctx, give.x, give.y, give.w, give.h, '认栽·重来', { bg: '#8a8a9e', fontSize: 15 });
  }
  _debuffText(card) {
    const full = Cards.EXCUSES.find((e) => e.id === card.id);
    const d = full && full.debuff;
    if (!d) return '无代价';
    return '减速' + Math.round((1 - d.value) * 100) + '%·' + d.dur + 's';
  }
  _encCardBtn(i) {
    const w = this.W * 0.26, gap = this.W * 0.02;
    const total = w * 3 + gap * 2;
    const x0 = (this.W - total) / 2;
    return { x: x0 + i * (w + gap), y: this.H * 0.40, w, h: this.H * 0.24 };
  }
  _encEscapeBtn() {
    return { x: this.W / 2 - 130, y: this.H * 0.70, w: 260, h: 46 };
  }
  _encGiveBtn() {
    return { x: this.W / 2 - 130, y: this.H * 0.70 + 56, w: 260, h: 46 };
  }

  _drawResult(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = this.state === 'win' ? '#5fc46b' : '#e05b5b';
    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.fillText(this.state === 'win' ? '过 关 !' : '被 抓 了', this.W / 2, this.H * 0.34);
    ctx.fillStyle = '#fff';
    ctx.font = '15px "Courier New", monospace';
    ctx.fillText(this.overMsg, this.W / 2, this.H * 0.44);
    ctx.fillText('坚持 ' + Math.floor(this.elapsed) + 's · 羽毛 ' + this.featherGot, this.W / 2, this.H * 0.5);
    R.pixelButton(ctx, this._restartBtn().x, this._restartBtn().y, this._restartBtn().w, this._restartBtn().h, '再 来 一 局', { fontSize: 18 });
  }

  _tagName(t) { return { work: '班', sick: '病', family: '亲', rest: '休', home: '家' }[t] || t; }
  _wrapText(ctx, text, cx, cy, maxW, lh) {
    const chars = text.split('');
    let line = '', lines = [];
    for (const ch of chars) {
      if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
      else line += ch;
    }
    if (line) lines.push(line);
    const startY = cy - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lh));
  }
}

function px(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

module.exports = Game;
