// 入口（与 dg/minigame-survivor 一致：用 require 模块系统延迟执行，避免 jsbridge not ready）
const Game = require('./src/game.js');
new Game();
