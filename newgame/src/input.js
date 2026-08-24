// 触屏输入：浮动摇杆（在手指按下处生成摇杆，拖动向心方向即移动方向）
class Input {
  constructor() {
    this.dirX = 0;
    this.dirY = 0;
    this.active = false;
    this.originX = 0;
    this.originY = 0;
    this.knobX = 0;
    this.knobY = 0;
    this.maxRadius = 60;
    this.tapQueue = []; // 供 UI（开始/卡牌/结算）消费点击坐标
    this._bind();
  }
  _bind() {
    wx.onTouchStart((e) => this._start(e));
    wx.onTouchMove((e) => this._move(e));
    wx.onTouchEnd((e) => this._end(e));
  }
  _start(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    this.active = true;
    this.originX = t.clientX;
    this.originY = t.clientY;
    this.knobX = t.clientX;
    this.knobY = t.clientY;
    this.dirX = 0;
    this.dirY = 0;
    this.tapQueue.push({ x: t.clientX, y: t.clientY });
  }
  _move(e) {
    if (!this.active) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    let dx = t.clientX - this.originX;
    let dy = t.clientY - this.originY;
    const len = Math.hypot(dx, dy) || 1;
    if (len > this.maxRadius) {
      dx = (dx / len) * this.maxRadius;
      dy = (dy / len) * this.maxRadius;
    }
    this.knobX = this.originX + dx;
    this.knobY = this.originY + dy;
    this.dirX = dx / this.maxRadius;
    this.dirY = dy / this.maxRadius;
  }
  _end() {
    this.active = false;
    this.dirX = 0;
    this.dirY = 0;
    this.knobX = 0;
    this.knobY = 0;
  }
  consumeTap() {
    return this.tapQueue.length ? this.tapQueue.shift() : null;
  }
  // HUD 按钮命中检测（坐标直接用 clientX/clientY，与 dg 一致不除 dpr）
  hit(tap, x, y, w, h) {
    return tap && tap.x >= x && tap.x <= x + w && tap.y >= y && tap.y <= y + h;
  }
  draw(ctx) {
    if (!this.active) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.originX, this.originY, this.maxRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(this.knobX, this.knobY, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
module.exports = Input;
