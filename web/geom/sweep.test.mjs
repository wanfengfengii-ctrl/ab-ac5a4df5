// 扫掠几何单元测试：node --test（零依赖，node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TWO_PI,
  degToRad,
  radToDeg,
  normalizeAngle,
  sweepExtent,
  distanceToSector,
  evaluateCircle,
  evaluateNeedle,
  analyze,
} from './sweep.mjs';
import { validateInput } from './validate.mjs';

const D = degToRad;
const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

function needle(over = {}) {
  return {
    pivot: { x: 0, y: 0 },
    length: 100,
    startAngle: D(0),
    endAngle: D(180),
    dir: 1,
    ...over,
  };
}
function circle(cx, cy, r) {
  return { center: { x: cx, y: cy }, radius: r };
}

test('sweepExtent 方向角：逆时针/逆时针取长弧', () => {
  approx(sweepExtent(D(10), D(20), 1), D(10));
  approx(sweepExtent(D(20), D(10), 1), D(350));
  approx(sweepExtent(D(10), D(20), -1), D(350));
  approx(sweepExtent(D(20), D(10), -1), D(10));
  approx(sweepExtent(D(0), D(360), 1), 0);
});

test('distanceToSector：开口内、针身外 → 到针尖弧边', () => {
  approx(distanceToSector(150, D(30), D(90), 100), 50);
  // 支点距离 0
  approx(distanceToSector(0, 0, D(90), 100), 0);
});

test('distanceToSector：开口外 → 到边界针身/支点/针尖', () => {
  // 中心方位 135°，扇形 0→90°：离终止边(90°)偏 45°，垂足 100cos45 在针身上
  approx(distanceToSector(100, D(135), D(90), 100), 100 * Math.sin(D(45)), 1e-8);
  // 背离支点（投影为负）→ 最近点为支点
  approx(distanceToSector(100, D(200), D(90), 100), 100, 1e-8);
  // 垂足超过针尖 → 到针尖
  // d=100, δ=100°(过终止边10°), L=50：proj≈-? cos100<0 → 支点；
  // 取 δ=95° 仍 cos<0… 用起始边外侧：δ=350° 即起始边外 10°，proj=100cos10≈98 > L
  approx(distanceToSector(100, D(350), D(90), 50), Math.hypot(100 * Math.sin(D(10)), 100 * Math.cos(D(10)) - 50), 1e-8);
  // 整圆
  approx(distanceToSector(150, D(200), TWO_PI, 100), 50);
  approx(distanceToSector(50, D(200), TWO_PI, 100), 0);
});

test('方向敏感：顺时针 0→180 扫的是 -180..0 那半边，+60° 处的圆不在扇形内', () => {
  const nCCW = needle({ dir: 1 });
  const nCW = needle({ dir: -1 });
  const c = circle(100 * Math.cos(D(60)), 100 * Math.sin(D(60)), 5);
  assert.equal(evaluateCircle(nCCW, c).intersects, true); // 圆压在针身上
  const resCW = evaluateCircle(nCW, c);
  assert.equal(resCW.intersects, false);
  // 顺时针扇形最近边界为起始边(0°)，偏 60°，垂距 100sin60 ≈ 86.6
  approx(resCW.clearance, 100 * Math.sin(D(60)) - 5, 1e-7);
});

test('净距：开口内圆在针尖之外，clearance = d - L - r', () => {
  const res = evaluateCircle(needle(), circle(150, 0, 10));
  assert.equal(res.intersects, false);
  approx(res.clearance, 40);
});

test('相切判为不安全（净距 0）', () => {
  // 针身沿 +x 轴，圆心 (80,10)、r=10，恰好与针身相切
  const res = evaluateCircle(needle({ startAngle: 0, endAngle: 90 }), circle(80, 10, 10));
  assert.equal(res.intersects, true);
  approx(res.clearance, 0, 1e-6);
});

test('首次触及角：针身边缘先触，c = asin(r/d)', () => {
  const d = 100;
  const r = 10;
  const centerAng = D(60);
  const c = circle(d * Math.cos(centerAng), d * Math.sin(centerAng), r);
  const res = evaluateCircle(needle({ startAngle: 0, endAngle: 180, dir: 1 }), c);
  assert.equal(res.intersects, true);
  const cHalf = Math.asin(r / d);
  approx(res.contactParam, centerAng - cHalf, 1e-8);
  approx(res.contactAngle, centerAng - cHalf, 1e-8);
  // 接触点沿针身距离 = sqrt(d²-r²)
  approx(res.contactRayDistance, Math.sqrt(d * d - r * r), 1e-7);
});

test('首次触及角：针尖先触（短针），c = acos((d²+L²-r²)/2dL)', () => {
  // d=100,L=80：针身先触要求 r≥√(d²−L²)=60；针尖可达要求 r>d−L=20。
  // 取 r=30、圆心角 20°，触锥半角 c≈14.36°，扫掠 0→90 内首次触及于 ≈5.64°
  const d = 100, L = 80, r = 30;
  const centerAng = D(20);
  const c = circle(d * Math.cos(centerAng), d * Math.sin(centerAng), r);
  const res = evaluateCircle(needle({ length: L, startAngle: 0, endAngle: 90 }), c);
  assert.equal(res.intersects, true);
  const cHalf = Math.acos((d * d + L * L - r * r) / (2 * d * L));
  approx(cHalf, D(14.36), D(0.01));
  approx(res.contactParam, centerAng - cHalf, 1e-8);
  approx(res.contactRayDistance, L, 1e-8);
});

test('起始姿态已接触时 contactParam = 0', () => {
  // 圆心在起始边顺时针侧 3°、距离 100、r=10（c≈5.74°）
  const c = circle(100 * Math.cos(D(-3)), 100 * Math.sin(D(-3)), 10);
  const res = evaluateCircle(needle({ startAngle: 0, endAngle: 90 }), c);
  assert.equal(res.intersects, true);
  approx(res.contactParam, 0);
});

test('evaluateNeedle：最小净距与最早触及', () => {
  const n = needle({ startAngle: 0, endAngle: 180 });
  // 圆1：60° 方向 r=10，接触 t≈54.26°
  // 圆2：120° 方向 r=10，接触 t≈114.26°（更晚）
  const cs = [
    circle(100 * Math.cos(D(60)), 100 * Math.sin(D(60)), 10),
    circle(100 * Math.cos(D(120)), 100 * Math.sin(D(120)), 10),
  ];
  const res = evaluateNeedle(n, cs);
  assert.equal(res.intersects, true);
  assert.equal(res.firstContact.circleIndex, 0);
  approx(res.firstContact.contactParam, D(60) - Math.asin(0.1), 1e-8);
});

test('analyze：按针录入顺序返回首项冲突', () => {
  const needles = [
    needle({ startAngle: 0, endAngle: 90 }), // 安全
    needle({ pivot: { x: 300, y: 0 }, startAngle: 0, endAngle: 90 }),
  ];
  // 圆在 (100,10)：针1 的 0→90 CCW 扇形……80,10 r10 相切于针1 → 针1 冲突
  const circles = [circle(80, 10, 10)];
  const res = analyze(needles, circles);
  assert.equal(res.conflict.needleIndex, 0);

  // 圆挪到 x 负侧，两根针均不冲突
  const safe = analyze(needles, [circle(-100, 0, 5)]);
  assert.equal(safe.conflict, null);
});

test('随机对拍：与细粒度旋转采样一致（相交判定不得漏判，净距不得高估）', () => {
  let rng = 0x12345678;
  const rand = () => {
    // xorshift32
    rng ^= rng << 13; rng >>>= 0;
    rng ^= rng >> 17;
    rng ^= rng << 5; rng >>>= 0;
    return rng / 0x100000000;
  };
  const pointSegDist = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
  };
  for (let trial = 0; trial < 400; trial++) {
    const L = 20 + rand() * 120;
    const start = rand() * TWO_PI;
    let end = rand() * TWO_PI;
    if (normalizeAngle(end - start) < 0.02) end = start + 0.05 + rand();
    const dir = rand() < 0.5 ? 1 : -1;
    const n = needle({ pivot: { x: 0, y: 0 }, length: L, startAngle: start, endAngle: end, dir });
    const alpha = sweepExtent(start, end, dir);
    const c = circle((rand() - 0.5) * 400, (rand() - 0.5) * 400, 2 + rand() * 40);
    // 跳过覆盖支点的圆（业务规则禁止）
    if (Math.hypot(c.center.x, c.center.y) <= c.radius) continue;

    // 采样求圆到针身的最近距离（含两端姿态）
    const STEPS = 3600;
    let sampledMin = Infinity;
    for (let i = 0; i <= STEPS; i++) {
      const t = (alpha * i) / STEPS;
      const a = start + dir * t;
      const d = pointSegDist(c.center.x, c.center.y, 0, 0, L * Math.cos(a), L * Math.sin(a));
      if (d < sampledMin) sampledMin = d;
    }
    const res = evaluateCircle(n, c);
    const eps = 1e-6 * Math.max(100, L, c.radius);
    // 精确净距 ≤ 采样净距（采样只可能高估）
    assert.ok(res.clearance <= Math.max(0, sampledMin - c.radius) + eps,
      `trial ${trial}: clearance ${res.clearance} > sampled ${sampledMin - c.radius}`);
    // 采样发现相交 ⇒ 精确判定必须相交（不得漏过中途扫掠）
    if (sampledMin <= c.radius + 1e-7) {
      assert.ok(res.intersects, `trial ${trial}: 采样相交但精确判定安全 (sampled=${sampledMin}, r=${c.radius})`);
    }
    // 精确判相交时给出合法的首次触及参数，且该姿态确实接触
    if (res.intersects && res.contactParam !== null) {
      assert.ok(res.contactParam >= -1e-8 && res.contactParam <= alpha + 1e-8, `trial ${trial}: t 越界`);
      const a = start + dir * res.contactParam;
      const dTouch = pointSegDist(c.center.x, c.center.y, 0, 0, L * Math.cos(a), L * Math.sin(a));
      assert.ok(dTouch <= c.radius + 1e-5, `trial ${trial}: 首次触及姿态未接触 d=${dTouch} r=${c.radius}`);
      // 稍早一点（退一个小角度）应当尚未接触，除非起始即接触
      if (res.contactParam > 1e-4) {
        const a2 = start + dir * (res.contactParam - 2e-4);
        const dBefore = pointSegDist(c.center.x, c.center.y, 0, 0, L * Math.cos(a2), L * Math.sin(a2));
        assert.ok(dBefore > c.radius - 1e-6, `trial ${trial}: 首次触及之前已接触 d=${dBefore}`);
      }
    }
  }
});

test('validateInput：数量、角度互异、支点不被覆盖', () => {
  const base = (n) => ({ pivot: { x: 0, y: 0 }, length: 100, startDeg: 0, endDeg: 90, dir: 1, ...n });
  const ok = validateInput([base(), base({ pivot: { x: 5, y: 5 } })], [{ center: { x: 50, y: 0 }, radius: 5 }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.needles[0].startAngle, 0);

  const tooFew = validateInput([base()], [{ center: { x: 50, y: 0 }, radius: 5 }]);
  assert.equal(tooFew.ok, false);

  const sameAngle = validateInput(
    [base({ endDeg: 360 }), base()],
    [{ center: { x: 50, y: 0 }, radius: 5 }],
  );
  assert.equal(sameAngle.ok, false);
  assert.match(sameAngle.errors[0].message, /必须不同/);

  const covered = validateInput(
    [base(), base()],
    [{ center: { x: 1, y: 0 }, radius: 5 }],
  );
  assert.equal(covered.ok, false);
  assert.match(covered.errors[0].message, /覆盖/);

  const badLen = validateInput(
    [base({ length: 0 }), base()],
    [{ center: { x: 50, y: 0 }, radius: 5 }],
  );
  assert.equal(badLen.ok, false);
});

test('角度辅助函数', () => {
  approx(normalizeAngle(D(-30)), D(330));
  approx(radToDeg(degToRad(-45)), -45);
});
