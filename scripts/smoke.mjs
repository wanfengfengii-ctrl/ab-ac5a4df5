// 注胶扫掠模块烟测（verify 服务最后一步）：
// 重点验证“只看两个停靠角度会漏判、连续扫掠能抓到中途触及”，
// 以及相切、净距、首次触及角、按针顺序的首项冲突、构建产物。
import { existsSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, evaluateCircle, degToRad, radToDeg } from '../web/geom/sweep.mjs';
import { validateInput } from '../web/geom/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// 核心场景：支点 O=(0,0)、针长 200；保护圆心在方位 135°、距离 150 处，半径 20。
// 起止姿态固定为 0° 与 90°，两者距圆都很远（90° 姿态与圆方位差 45°，垂距 ≈106）。
//  · 逆时针 0→90°：只扫第一象限 90° 短弧，圆（135° 方位）在扇形外 → 安全；
//  · 顺时针 0→90°：扫 270° 长弧，中途经过 135° 方位 → 不安全。
// 若只检查两个停靠角度，就会漏掉这次中途扫掠。
const circle = { center: { x: 150 * Math.cos(degToRad(135)), y: 150 * Math.sin(degToRad(135)) }, radius: 20 };
const poses = { pivot: { x: 0, y: 0 }, length: 200, startAngle: degToRad(0), endAngle: degToRad(90) };
const shortCCW = evaluateCircle({ ...poses, dir: 1 }, circle);
const longCW = evaluateCircle({ ...poses, dir: -1 }, circle);

check('逆时针短弧：两个停靠姿态安全、扫掠也安全', shortCCW.intersects === false,
  `intersects=${shortCCW.intersects}`);
check('逆时针短弧净距 ≈ 150·sin45° − 20 ≈ 86.07',
  Math.abs(shortCCW.clearance - (150 * Math.sin(degToRad(45)) - 20)) < 1e-6,
  `clearance=${shortCCW.clearance}`);
check('顺时针长弧：停靠姿态均不碰，但中途扫掠判为不安全', longCW.intersects === true,
  `intersects=${longCW.intersects}`);

// 首次触及：圆心局部参数 δ = 225°，触锥半角 c = asin(20/150) ≈ 7.66°，
// 故 t = δ − c ≈ 217.34°，绝对方位角 = −t ≈ 142.66°
const cHalf = Math.asin(20 / 150);
check('首次触及参数 t ≈ 217.34°（沿顺时针方向）',
  Math.abs(radToDeg(longCW.contactParam) - (225 - radToDeg(cHalf))) < 1e-6,
  `t=${radToDeg(longCW.contactParam)}`);
check('首次触及绝对方位角 ≈ 142.66°',
  Math.abs(radToDeg(longCW.contactAngle) - (360 - (225 - radToDeg(cHalf)))) < 1e-6,
  `angle=${radToDeg(longCW.contactAngle)}`);
check('接触点位于针身（沿针距离 √(d²−r²) ≈ 148.66）',
  Math.abs(longCW.contactRayDistance - Math.sqrt(150 * 150 - 400)) < 1e-6);

// 相切不安全
const tangent = evaluateCircle(
  { pivot: { x: 0, y: 0 }, length: 100, startAngle: degToRad(0), endAngle: degToRad(90), dir: 1 },
  { center: { x: 80, y: 10 }, radius: 10 },
);
check('相切判为不安全、净距为 0', tangent.intersects === true && tangent.clearance === 0);

// 校验：角度相同拒绝、保护圆覆盖支点拒绝
const v1 = validateInput(
  [
    { pivot: { x: 0, y: 0 }, length: 100, startDeg: 0, endDeg: 0, dir: 1 },
    { pivot: { x: 5, y: 5 }, length: 100, startDeg: 0, endDeg: 90, dir: 1 },
  ],
  [{ center: { x: 50, y: 0 }, radius: 5 }],
);
check('起止角度相同被拒绝', v1.ok === false);
const v2 = validateInput(
  [
    { pivot: { x: 0, y: 0 }, length: 100, startDeg: 0, endDeg: 90, dir: 1 },
    { pivot: { x: 5, y: 5 }, length: 100, startDeg: 0, endDeg: 90, dir: 1 },
  ],
  [{ center: { x: 1, y: 0 }, radius: 5 }],
);
check('保护圆覆盖支点被拒绝', v2.ok === false);

// 首项冲突按针录入顺序：第 1 根安全短弧，第 2 根中途触及长弧
const parsed = validateInput(
  [
    { pivot: { x: 0, y: 0 }, length: 200, startDeg: 0, endDeg: 90, dir: 1 },
    { pivot: { x: 0, y: 0 }, length: 200, startDeg: 0, endDeg: 90, dir: -1 },
  ],
  [{ center: { x: circle.center.x, y: circle.center.y }, radius: 20 }],
);
check('校验通过（合法场景）', parsed.ok === true, JSON.stringify(parsed.errors));
const res = analyze(parsed.needles, parsed.circles);
check('首项冲突定位到第 2 根针、第 1 个保护圆',
  res.conflict && res.conflict.needleIndex === 1 && res.conflict.circleIndex === 0,
  JSON.stringify(res.conflict));

// 全部安全时 conflict=null 且每针净距为正
const allSafe = validateInput(
  [
    { pivot: { x: 0, y: 0 }, length: 50, startDeg: 0, endDeg: 90, dir: 1 },
    { pivot: { x: 300, y: 300 }, length: 50, startDeg: 0, endDeg: 90, dir: -1 },
  ],
  [{ center: { x: -100, y: -100 }, radius: 10 }],
);
const safeRes = analyze(allSafe.needles, allSafe.circles);
check('全安全时 conflict=null 且每针有正净距',
  safeRes.conflict === null && safeRes.needles.every((n) => n.minClearance > 0));

// 构建产物
for (const f of ['index.html', 'styles.css', 'app.js', 'geom/sweep.mjs', 'geom/validate.mjs']) {
  check(`构建产物 dist/${f} 存在`, existsSync(join(root, 'dist', f)));
}
check('测试文件未进入产物', !existsSync(join(root, 'dist', 'geom', 'sweep.test.mjs')));

if (failures) {
  console.error(`\n烟测失败：${failures} 项`);
  process.exit(1);
}
console.log('\n烟测全部通过 ✓');
