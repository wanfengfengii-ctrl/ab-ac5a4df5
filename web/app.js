// 浏览器应用：画布拖动 + 数值录入 + 扫掠校核展示
import { analyze, degToRad, radToDeg, normalizeAngle } from './geom/sweep.mjs';
import { validateInput, LIMITS } from './geom/validate.mjs';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// 世界坐标（数学系，y 向上）↔ 画布像素（y 向下）
const ORIGIN = { x: W / 2, y: H / 2 };
const SCALE = 0.82;
const toScreen = (x, y) => ({ x: ORIGIN.x + SCALE * x, y: ORIGIN.y - SCALE * y });
const toWorld = (sx, sy) => ({ x: (sx - ORIGIN.x) / SCALE, y: (ORIGIN.y - sy) / SCALE });

const NEEDLE_COLORS = ['#2f6fb0', '#8a5bd0', '#0f9d8c', '#d0742f', '#c2456f'];

const initialState = () => ({
  needles: [
    { pivot: { x: -200, y: -150 }, length: 140, startDeg: 10, endDeg: 110, dir: 1 },
    // 起止姿态都不碰保护圆 B，但逆时针 200°→300° 的中途扫掠会触及它
    { pivot: { x: 150, y: -160 }, length: 170, startDeg: 200, endDeg: 300, dir: 1 },
  ],
  circles: [
    { center: { x: -300, y: 200 }, radius: 25 },
    { center: { x: 109, y: -273 }, radius: 18 },
  ],
});

let state = initialState();
let analysis = null; // 最近一次校核结果
let validationErrors = [];

const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
const norm360 = (v) => ((v % 360) + 360) % 360;

// ---------- 画布交互 ----------
const HANDLE_HIT = 11; // px

function needleTip(n, deg) {
  const a = degToRad(deg);
  return { x: n.pivot.x + n.length * Math.cos(a), y: n.pivot.y + n.length * Math.sin(a) };
}

function handles() {
  const hs = [];
  state.needles.forEach((n, ni) => {
    hs.push({ kind: 'pivot', ni, pos: n.pivot });
    hs.push({ kind: 'tip-start', ni, pos: needleTip(n, n.startDeg) });
    hs.push({ kind: 'tip-end', ni, pos: needleTip(n, n.endDeg) });
  });
  state.circles.forEach((c, ci) => {
    hs.push({ kind: 'circle-center', ci, pos: c.center });
    hs.push({ kind: 'circle-rim', ci, pos: { x: c.center.x + c.radius, y: c.center.y } });
  });
  return hs;
}

let drag = null;

function eventPos(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) * (canvas.width / rect.width),
    y: (ev.clientY - rect.top) * (canvas.height / rect.height),
  };
}

canvas.addEventListener('pointerdown', (ev) => {
  const { x: mx, y: my } = eventPos(ev);
  let best = null, bestD = HANDLE_HIT;
  for (const h of handles()) {
    const p = toScreen(h.pos.x, h.pos.y);
    const d = Math.hypot(p.x - mx, p.y - my);
    if (d <= bestD) { bestD = d; best = h; }
  }
  if (best) {
    drag = best;
    canvas.setPointerCapture(ev.pointerId);
    invalidateResult();
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) {
    updateCursor(ev);
    return;
  }
  const { x: mx, y: my } = eventPos(ev);
  const w = toWorld(mx, my);
  const n = drag.ni !== undefined ? state.needles[drag.ni] : null;
  const c = drag.ci !== undefined ? state.circles[drag.ci] : null;

  if (drag.kind === 'pivot') {
    n.pivot.x = w.x; n.pivot.y = w.y;
  } else if (drag.kind.startsWith('tip-')) {
    n.length = Math.max(4, Math.hypot(w.x - n.pivot.x, w.y - n.pivot.y));
    const ang = norm360(radToDeg(Math.atan2(w.y - n.pivot.y, w.x - n.pivot.x)));
    if (drag.kind === 'tip-start') n.startDeg = ang;
    else n.endDeg = ang;
  } else if (drag.kind === 'circle-center') {
    c.center.x = w.x; c.center.y = w.y;
  } else if (drag.kind === 'circle-rim') {
    c.radius = Math.max(4, Math.hypot(w.x - c.center.x, w.y - c.center.y));
  }
  updateFormValues();
  render();
});

canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });

function updateCursor(ev) {
  const { x: mx, y: my } = eventPos(ev);
  let on = false;
  for (const h of handles()) {
    const p = toScreen(h.pos.x, h.pos.y);
    if (Math.hypot(p.x - mx, p.y - my) <= HANDLE_HIT) { on = true; break; }
  }
  canvas.style.cursor = on ? 'grab' : 'crosshair';
}

// ---------- 绘制 ----------
function drawGrid() {
  ctx.fillStyle = '#f6f1e7';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#e3dccb';
  ctx.lineWidth = 1;
  const step = SCALE * 50;
  for (let x = ORIGIN.x % step; x < W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = ORIGIN.y % step; y < H; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.strokeStyle = '#cfc4aa';
  ctx.beginPath(); ctx.moveTo(0, ORIGIN.y); ctx.lineTo(W, ORIGIN.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ORIGIN.x, 0); ctx.lineTo(ORIGIN.x, H); ctx.stroke();
}

function drawNeedleShape(n, color) {
  const o = toScreen(n.pivot.x, n.pivot.y);
  // 扫掠扇形（世界 CCW(dir=+1) ⇔ 屏幕顺时针，故 arc 的 anticlockwise = dir===-1）
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.arc(o.x, o.y, n.length * SCALE, -degToRad(n.startDeg), -degToRad(n.endDeg), n.dir === -1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 起止两条针身：绿=起始、红=终止
  const pose = (deg, stroke, w) => {
    const t = needleTip(n, deg);
    const p = toScreen(t.x, t.y);
    ctx.strokeStyle = stroke; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  pose(n.startDeg, 'rgba(38,140,80,0.95)', 2.4);
  pose(n.endDeg, 'rgba(200,70,55,0.95)', 2.4);

  // 支点附近的方向箭头弧
  const a0 = degToRad(n.startDeg);
  const a1 = degToRad(n.endDeg);
  const delta = normalizeAngle(n.dir * (a1 - a0));
  const mid = a0 + (n.dir * delta) / 2;
  const rArc = 26 * SCALE;
  ctx.strokeStyle = color; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(o.x, o.y, rArc, -(mid - n.dir * 0.35), -(mid + n.dir * 0.35), n.dir === -1);
  ctx.stroke();
  const tip = toScreen(
    n.pivot.x + 26 * Math.cos(mid + n.dir * 0.35),
    n.pivot.y + 26 * Math.sin(mid + n.dir * 0.35),
  );
  const tail = toScreen(
    n.pivot.x + 26 * Math.cos(mid - n.dir * 0.35),
    n.pivot.y + 26 * Math.sin(mid - n.dir * 0.35),
  );
  const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - 8 * Math.cos(ang - 0.45), tip.y - 8 * Math.sin(ang - 0.45));
  ctx.lineTo(tip.x - 8 * Math.cos(ang + 0.45), tip.y - 8 * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawCircle(c) {
  const p = toScreen(c.center.x, c.center.y);
  ctx.fillStyle = 'rgba(217,164,65,0.20)';
  ctx.strokeStyle = 'rgba(150,100,20,0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(p.x, p.y, c.radius * SCALE, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
}

function drawHandles() {
  const dot = (pos, paint) => {
    const p = toScreen(pos.x, pos.y);
    ctx.save(); paint(p); ctx.restore();
  };
  state.circles.forEach((c) => {
    dot(c.center, (p) => {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#8a6a20'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    dot({ x: c.center.x + c.radius, y: c.center.y }, (p) => {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#8a6a20';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  });
  state.needles.forEach((n, ni) => {
    const color = NEEDLE_COLORS[ni % NEEDLE_COLORS.length];
    dot(n.pivot, (p) => {
      ctx.fillStyle = color; ctx.strokeStyle = '#1c1916'; ctx.lineWidth = 1.2;
      ctx.fillRect(p.x - 5, p.y - 5, 10, 10); ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
    });
    dot(needleTip(n, n.startDeg), (p) => {
      ctx.fillStyle = '#2e9c5a'; ctx.strokeStyle = '#10331d';
      ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    dot(needleTip(n, n.endDeg), (p) => {
      ctx.fillStyle = '#d0493a'; ctx.strokeStyle = '#3d1410';
      ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  });
}

function drawConflict() {
  if (!analysis || !analysis.conflict) return;
  const { needleIndex, contactAngle, contactPoint } = analysis.conflict;
  const n = state.needles[needleIndex];
  const o = toScreen(n.pivot.x, n.pivot.y);
  const tip = toScreen(
    n.pivot.x + n.length * Math.cos(contactAngle),
    n.pivot.y + n.length * Math.sin(contactAngle),
  );
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = '#e05b4b'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.setLineDash([]);
  const cp = toScreen(contactPoint.x, contactPoint.y);
  ctx.strokeStyle = '#b81f12'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cp.x, cp.y, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function render() {
  drawGrid();
  state.circles.forEach(drawCircle);
  state.needles.forEach((n, ni) => drawNeedleShape(n, NEEDLE_COLORS[ni % NEEDLE_COLORS.length]));
  drawConflict();
  drawHandles();
}

// ---------- 侧栏表单（数据绑定，拖动时就地刷新数值，不重建 DOM） ----------
const needleListEl = document.getElementById('needleList');
const circleListEl = document.getElementById('circleList');

function bindNumberInput(step, get, set) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = step;
  inp.value = Math.round(get() * 100) / 100;
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) {
      set(v);
      invalidateResult();
      updateFormValues();
      render();
    }
  });
  return inp;
}

function labeled(labelText, input) {
  const wrap = document.createElement('div');
  const lab = document.createElement('label');
  lab.textContent = labelText;
  wrap.appendChild(lab);
  wrap.appendChild(input);
  return wrap;
}

function buildNeedleCard(i) {
  const n = state.needles[i];
  const color = NEEDLE_COLORS[i % NEEDLE_COLORS.length];
  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.innerHTML = `<span><span class="swatch" style="background:${color}"></span>第 ${i + 1} 根针</span>`;
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'mini del'; del.textContent = '删除';
  del.addEventListener('click', () => {
    if (state.needles.length <= LIMITS.needles.min) return;
    state.needles.splice(i, 1);
    invalidateResult();
    syncForms();
    render();
  });
  title.appendChild(del);
  card.appendChild(title);

  const r1 = document.createElement('div'); r1.className = 'row three';
  r1.appendChild(labeled('支点 X', bindNumberInput(1, () => n.pivot.x, (v) => (n.pivot.x = v))));
  r1.appendChild(labeled('支点 Y', bindNumberInput(1, () => n.pivot.y, (v) => (n.pivot.y = v))));
  r1.appendChild(labeled('针长 L', bindNumberInput(1, () => n.length, (v) => (n.length = Math.max(4, v)))));
  card.appendChild(r1);

  const r2 = document.createElement('div'); r2.className = 'row three';
  r2.appendChild(labeled('起始角°', bindNumberInput(1, () => n.startDeg, (v) => (n.startDeg = norm360(v)))));
  r2.appendChild(labeled('终止角°', bindNumberInput(1, () => n.endDeg, (v) => (n.endDeg = norm360(v)))));
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="1">逆时针</option><option value="-1">顺时针</option>';
  sel.value = String(n.dir);
  sel.addEventListener('change', () => {
    n.dir = parseInt(sel.value, 10);
    invalidateResult(); render();
  });
  r2.appendChild(labeled('方向', sel));
  card.appendChild(r2);

  const result = document.createElement('div');
  result.className = 'result';
  card.appendChild(result);
  return card;
}

function buildCircleCard(i) {
  const c = state.circles[i];
  const card = document.createElement('div');
  card.className = 'card';
  const title = document.createElement('div');
  title.className = 'card-title';
  title.innerHTML = `<span><span class="swatch" style="background:#d9a441"></span>保护圆 ${i + 1}</span>`;
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'mini del'; del.textContent = '删除';
  del.addEventListener('click', () => {
    if (state.circles.length <= LIMITS.circles.min) return;
    state.circles.splice(i, 1);
    invalidateResult();
    syncForms();
    render();
  });
  title.appendChild(del);
  card.appendChild(title);

  const r = document.createElement('div'); r.className = 'row three';
  r.appendChild(labeled('圆心 X', bindNumberInput(1, () => c.center.x, (v) => (c.center.x = v))));
  r.appendChild(labeled('圆心 Y', bindNumberInput(1, () => c.center.y, (v) => (c.center.y = v))));
  r.appendChild(labeled('半径 R', bindNumberInput(1, () => c.radius, (v) => (c.radius = Math.max(4, v)))));
  card.appendChild(r);
  return card;
}

// 重建所有表单（仅在增删条目时）
function syncForms() {
  needleListEl.innerHTML = '';
  state.needles.forEach((_, i) => needleListEl.appendChild(buildNeedleCard(i)));
  circleListEl.innerHTML = '';
  state.circles.forEach((_, i) => circleListEl.appendChild(buildCircleCard(i)));
  document.getElementById('addNeedle').disabled = state.needles.length >= LIMITS.needles.max;
  document.getElementById('addCircle').disabled = state.circles.length >= LIMITS.circles.max;
  fillNeedleResults();
}

// 结构不变时把 state 数值刷回输入框（拖动时调用；跳过正聚焦的输入框）
function updateFormValues() {
  const active = document.activeElement;
  needleListEl.querySelectorAll('.card').forEach((card, i) => {
    const n = state.needles[i];
    const inputs = card.querySelectorAll('input');
    const vals = [n.pivot.x, n.pivot.y, n.length, n.startDeg, n.endDeg];
    inputs.forEach((inp, k) => {
      if (inp !== active) inp.value = Math.round(vals[k] * 100) / 100;
    });
    card.querySelector('select').value = String(n.dir);
  });
  circleListEl.querySelectorAll('.card').forEach((card, i) => {
    const c = state.circles[i];
    const vals = [c.center.x, c.center.y, c.radius];
    card.querySelectorAll('input').forEach((inp, k) => {
      if (inp !== active) inp.value = Math.round(vals[k] * 100) / 100;
    });
  });
  fillNeedleResults();
}

function fillNeedleResults() {
  [...needleListEl.children].forEach((card, i) => {
    const el = card.querySelector('.result');
    el.classList.remove('bad', 'good');
    if (!analysis) { el.textContent = ''; return; }
    const res = analysis.needles[i];
    if (res.intersects) {
      const fc = res.firstContact;
      el.classList.add('bad');
      el.innerHTML = `✗ 最早触及保护圆 <b>${fc.circleIndex + 1}</b>：针转至 <b>${fmt(radToDeg(fc.contactAngle), 1)}°</b>（已转 ${fmt(radToDeg(fc.contactParam), 1)}°）；最小净距 0`;
    } else {
      el.classList.add('good');
      el.textContent = `✓ 安全；针身扫掠区到最近保护圆净距 ≥ ${fmt(res.minClearance)}`;
    }
  });
}

document.getElementById('addNeedle').addEventListener('click', () => {
  if (state.needles.length >= LIMITS.needles.max) return;
  const i = state.needles.length;
  state.needles.push({ pivot: { x: -100 - i * 60, y: 100 + i * 40 }, length: 100, startDeg: 0, endDeg: 90, dir: 1 });
  invalidateResult(); syncForms(); render();
});
document.getElementById('addCircle').addEventListener('click', () => {
  if (state.circles.length >= LIMITS.circles.max) return;
  state.circles.push({ center: { x: 0, y: 0 }, radius: 20 });
  invalidateResult(); syncForms(); render();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  state = initialState();
  invalidateResult();
  syncForms();
  render();
});

function invalidateResult() {
  analysis = null;
  validationErrors = [];
  const verdict = document.getElementById('verdict');
  verdict.className = 'verdict';
  verdict.textContent = '尚未校核';
  document.getElementById('conflictBox').classList.add('hidden');
  document.getElementById('errorBox').classList.add('hidden');
  if (needleListEl.children.length) fillNeedleResults();
}

// ---------- 校核 ----------
document.getElementById('verifyBtn').addEventListener('click', () => {
  const errBox = document.getElementById('errorBox');
  const verdict = document.getElementById('verdict');
  const conflictBox = document.getElementById('conflictBox');
  errBox.classList.add('hidden');
  conflictBox.classList.add('hidden');

  const parsed = validateInput(
    state.needles.map((n) => ({ ...n, pivot: { ...n.pivot } })),
    state.circles.map((c) => ({ ...c, center: { ...c.center } })),
  );
  if (!parsed.ok) {
    analysis = null;
    validationErrors = parsed.errors;
    verdict.className = 'verdict';
    verdict.textContent = '录入数据未通过校验';
    errBox.innerHTML = validationErrors.map((e) => `• ${e.where}：${e.message}`).join('<br>');
    errBox.classList.remove('hidden');
    fillNeedleResults();
    render();
    return;
  }

  analysis = analyze(parsed.needles, parsed.circles);
  if (analysis.conflict) {
    const { needleIndex, circleIndex, contactAngle, contactParam } = analysis.conflict;
    verdict.className = 'verdict unsafe';
    verdict.textContent = '✗ 校核不通过：存在针扫掠触及颜料保护圆';
    conflictBox.innerHTML =
      '首项冲突（按针录入顺序、沿旋转方向最早触及位置）：<br>' +
      `第 <b>${needleIndex + 1}</b> 根针 → 保护圆 <b>${circleIndex + 1}</b><br>` +
      `触及瞬间针方位角 <b>${fmt(radToDeg(contactAngle), 2)}°</b>` +
      `（从起始朝向已转 <b>${fmt(radToDeg(contactParam), 2)}°</b>）`;
    conflictBox.classList.remove('hidden');
  } else {
    const minGap = Math.min(...analysis.needles.map((r) => r.minClearance));
    verdict.className = 'verdict safe';
    verdict.textContent = `✓ 校核通过：全部针扫掠区与保护圆无相交/相切，全局最小净距 ${fmt(minGap)}`;
  }
  fillNeedleResults();
  render();
});

syncForms();
render();
