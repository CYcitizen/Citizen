// ============================================
// 卡牌系统：借口卡（按 tag 匹配捕手弱点）+ 技能卡
//   tag 对应捕手弱点：work 老板 / sick 女友 / family 亲戚 / rest 朋友 / home 邻居
// ============================================

// 借口卡池（tag 决定能鸽掉哪类人；rarity 决定抽取权重）
// debuff：鸽掉对方后附带的代价（null = 安全牌，无代价）
//   { type:'speed', value:倍率, dur:秒 }  —— 移动速度 ×value，持续 dur 秒
const EXCUSES = [
  // work —— 鸽老板
  { id: 'e_work_1', name: '私活赶工', tag: 'work', rarity: 'blue', debuff: { type: 'speed', value: 0.85, dur: 10 } },
  { id: 'e_work_2', name: '项目背锅', tag: 'work', rarity: 'white', debuff: null },
  { id: 'e_work_3', name: '临时出差', tag: 'work', rarity: 'white', debuff: { type: 'speed', value: 0.9, dur: 8 } },
  // sick —— 鸽女友
  { id: 'e_sick_1', name: '重感冒39度', tag: 'sick', rarity: 'gold', debuff: { type: 'speed', value: 0.7, dur: 15 } },
  { id: 'e_sick_2', name: '急性肠胃炎', tag: 'sick', rarity: 'blue', debuff: { type: 'speed', value: 0.8, dur: 12 } },
  { id: 'e_sick_3', name: '头晕目眩', tag: 'sick', rarity: 'white', debuff: { type: 'speed', value: 0.88, dur: 8 } },
  // family —— 鸽亲戚
  { id: 'e_fam_1', name: '长辈寿宴', tag: 'family', rarity: 'blue', debuff: { type: 'speed', value: 0.85, dur: 10 } },
  { id: 'e_fam_2', name: '亲戚喜宴冲突', tag: 'family', rarity: 'white', debuff: null },
  { id: 'e_fam_3', name: '老家急事', tag: 'family', rarity: 'white', debuff: null },
  // rest —— 鸽朋友
  { id: 'e_rest_1', name: '太累要睡', tag: 'rest', rarity: 'white', debuff: { type: 'speed', value: 0.85, dur: 10 } },
  { id: 'e_rest_2', name: '心理建设日', tag: 'rest', rarity: 'white', debuff: null },
  { id: 'e_rest_3', name: '感冒卧床', tag: 'rest', rarity: 'blue', debuff: { type: 'speed', value: 0.82, dur: 12 } },
  // home —— 鸽邻居
  { id: 'e_home_1', name: '猫主子生病', tag: 'home', rarity: 'blue', debuff: { type: 'speed', value: 0.85, dur: 10 } },
  { id: 'e_home_2', name: '水管爆了', tag: 'home', rarity: 'gold', debuff: { type: 'speed', value: 0.72, dur: 14 } },
  { id: 'e_home_3', name: '门锁卡死', tag: 'home', rarity: 'white', debuff: { type: 'speed', value: 0.9, dur: 8 } },
];

// 技能卡
const SKILLS = [
  { id: 's_blink', name: '闪现', skill: 'blink' },
  { id: 's_speed', name: '加速', skill: 'speed' },
  { id: 's_anti', name: '反追踪', skill: 'antitrace' },
  { id: 's_magnet', name: '磁铁', skill: 'magnet' },
];

const RARITY_WEIGHT = { white: 5, blue: 2.5, gold: 1 };
const SKILL_WEIGHT = 1.6;

function weightedSample(items, n) {
  const pool = items.slice();
  const res = [];
  while (res.length < n && pool.length) {
    const total = pool.reduce((s, it) => s + it._w, 0);
    let r = Math.random() * total, pick = 0;
    for (let i = 0; i < pool.length; i++) { r -= pool[i]._w; if (r <= 0) { pick = i; break; } }
    res.push(pool[pick]);
    pool.splice(pick, 1);
  }
  return res;
}

// 抽 n 张候选（3 选 1）。tags 为本局捕手弱点集合——只从匹配 tag 的借口卡中抽，
// 保证奖励卡对本局有用；技能卡始终保留。
function drawChoices(n, tags) {
  let excusePool = EXCUSES;
  if (tags && tags.length) {
    const filtered = EXCUSES.filter((e) => tags.includes(e.tag));
    if (filtered.length) excusePool = filtered; // 兜底：若过滤后为空则退回全集
  }
  const candidates = excusePool.map((e) => ({ ...e, kind: 'excuse', _w: RARITY_WEIGHT[e.rarity] }));
  SKILLS.forEach((s) => candidates.push({ ...s, kind: 'skill', _w: SKILL_WEIGHT }));
  return weightedSample(candidates, n).map((c) => ({
    kind: c.kind, id: c.id, name: c.name, tag: c.tag, rarity: c.rarity, skill: c.skill,
  }));
}

module.exports = { EXCUSES, SKILLS, drawChoices };
