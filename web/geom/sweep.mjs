// 注胶针扫掠校核核心几何模块（纯 ESM，无依赖，可在浏览器与 Node 中运行）
//
// 坐标约定：标准数学坐标系 —— x 轴向右、y 轴向上，角度为弧度，
// 逆时针(dir = +1)为正方向。UI 层负责把屏幕坐标（y 轴向下）转换到本坐标系。
//
// 一根针从支点 O、针长 L、起始角 θ0 沿方向 dir（+1 逆时针 / -1 顺时针）
// 旋转到终止角 θ1，其针身连续扫过的区域是一个“带方向的圆扇形”
// S = { O + ρ·(cosθ, sinθ) | 0 ≤ ρ ≤ L, θ 位于 θ0 沿 dir 到 θ1 的有向弧上 }。
// 注意这是真正的扇形（含支点到针尖的整片区域），而不是仅两个停靠姿态。

export const TWO_PI = 2 * Math.PI;
export const ANGLE_EPS = 1e-10; // 弧度
const SCALE_EPS = 1e-9; // 与坐标尺度相关的相对容差

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

export function radToDeg(r) {
  return (r * 180) / Math.PI;
}

/** 归一化到 [0, 2π) */
export function normalizeAngle(a) {
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x;
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * 有向扫掠角 α ∈ [0, 2π)：从 startRad 沿 dir 方向到达 endRad 经过的角度。
 * 同一根针两角度相同时 α = 0（由 validate 模块拒绝）。
 */
export function sweepExtent(startRad, endRad, dir) {
  if (dir !== 1 && dir !== -1) throw new Error('dir 必须为 +1(逆时针) 或 -1(顺时针)');
  return normalizeAngle(dir * (endRad - startRad));
}

function scaleTol(...vs) {
  return SCALE_EPS * Math.max(1, ...vs.map((v) => Math.abs(v)));
}

/**
 * 点 P 到闭圆扇形的最短距离。
 * @param {number} d     支点 O 到 P 的距离
 * @param {number} delta P 在“沿扫掠方向”的局部方位角 ∈ [0,2π)，
 *                       即 normalize(dir·(θP − θ0))
 * @param {number} alpha 扫掠角 α ∈ (0,2π]
 * @param {number} L     针长（扇形半径）
 */
export function distanceToSector(d, delta, alpha, L) {
  if (d <= SCALE_EPS) return 0; // P 即支点
  if (alpha >= TWO_PI - ANGLE_EPS) {
    // 整圆
    return d <= L ? 0 : d - L;
  }
  if (delta <= alpha + ANGLE_EPS) {
    // 方位角在扇形开口内：最近点在同方向射线上
    return d <= L ? 0 : Math.max(0, d - L);
  }
  // 方位角在扇形外：取到两条边界半径中较近的一条
  const beta = Math.min(delta - alpha, TWO_PI - delta);
  const proj = d * Math.cos(beta); // P 在边界射线上的投影
  if (proj <= 0) return d; // 垂足落在支点反向，最近点为支点
  if (proj <= L) return d * Math.sin(beta); // 垂足在针身上
  return Math.sqrt(d * d + L * L - 2 * d * L * Math.cos(beta)); // 最近点为针尖
}

/**
 * 评估一根针对一个保护圆的关系。
 *
 * needle: { pivot:{x,y}, length, startAngle(rad), endAngle(rad), dir:±1 }
 * circle: { center:{x,y}, radius }
 *
 * 返回：
 *   intersects   保护圆（含边界）与扫掠扇形（含边界）是否相交或相切
 *   clearance    保护圆与扇形之间的最小净距（≥0，相交/相切时为 0）
 *   contactParam 首次触及发生时已旋转的角度 t（弧度，∈[0,α]），无接触为 null
 *   contactAngle 首次触及瞬间针身的绝对方位角（弧度），无接触为 null
 *   contactRayDistance  接触点沿针身到支点的距离（用于绘制接触点）
 *   contactPoint {x,y}  首次接触点（世界坐标）
 */
export function evaluateCircle(needle, circle) {
  const O = needle.pivot;
  const L = needle.length;
  const r = circle.radius;
  const theta0 = needle.startAngle;
  const dir = needle.dir;
  const alpha = sweepExtent(theta0, needle.endAngle, dir);

  const dx = circle.center.x - O.x;
  const dy = circle.center.y - O.y;
  const d = Math.hypot(dx, dy);
  const tol = scaleTol(d, L, r);

  const thetaC = Math.atan2(dy, dx);
  const delta = normalizeAngle(dir * (thetaC - theta0));

  const dist = distanceToSector(d, delta, alpha, L);
  const intersects = dist <= r + tol; // 相切也算不安全
  const clearance = Math.max(0, dist - r);

  let contactParam = null;
  let contactAngle = null;
  let contactRayDistance = null;
  let contactPoint = null;

  if (intersects && d > r + tol) {
    // 圆不覆盖支点时（输入校验已保证），随着针旋转，距离对相对方位角
    // 单调增大，存在唯一“触及半角” c：针身与圆相交 ⇔ |相对角| ≤ c。
    let c;
    if (Math.sqrt(Math.max(0, d * d - r * r)) <= L + tol) {
      // 针身边缘率先触及圆（垂线足落在针身上）
      c = Math.asin(clamp(r / d, -1, 1));
      contactRayDistance = Math.sqrt(Math.max(0, d * d - r * r));
    } else {
      // 针尖率先触及圆
      const k = (d * d + L * L - r * r) / (2 * d * L);
      c = Math.acos(clamp(k, -1, 1));
      contactRayDistance = L;
    }
    // 局部参数 t（沿扫掠方向从 θ0 起算）。接触锥以 t = δ + 2πk 为中心。
    if (delta <= c + ANGLE_EPS || delta >= TWO_PI - c - ANGLE_EPS) {
      contactParam = 0; // 起始姿态已经接触
    } else {
      const t = delta - c;
      if (t <= alpha + ANGLE_EPS) contactParam = Math.max(0, t);
    }
    if (contactParam !== null) {
      contactAngle = normalizeAngle(theta0 + dir * contactParam);
      contactPoint = {
        x: O.x + contactRayDistance * Math.cos(contactAngle),
        y: O.y + contactRayDistance * Math.sin(contactAngle),
      };
    }
  } else if (intersects) {
    // 圆覆盖支点（理论上被校验拦截）：起始即接触
    contactParam = 0;
    contactAngle = normalizeAngle(theta0);
    contactRayDistance = 0;
    contactPoint = { x: O.x, y: O.y };
  }

  return {
    d,
    delta,
    alpha,
    dist,
    intersects,
    clearance,
    contactParam,
    contactAngle,
    contactRayDistance,
    contactPoint,
  };
}

/**
 * 评估一根针对全部保护圆。
 * 返回逐圆结果 perCircle、全针最小净距 minClearance（及对应圆）、
 * 以及沿该针旋转方向最早的触及 firstContact（同分取录入序号较小者）。
 */
export function evaluateNeedle(needle, circles) {
  const perCircle = circles.map((c) => evaluateCircle(needle, c));
  const alpha = perCircle.length ? perCircle[0].alpha : sweepExtent(
    needle.startAngle,
    needle.endAngle,
    needle.dir,
  );

  let minClearance = Infinity;
  let minClearanceCircle = -1;
  let firstContact = null;

  perCircle.forEach((res, i) => {
    if (res.clearance < minClearance - scaleTol(res.clearance)) {
      minClearance = res.clearance;
      minClearanceCircle = i;
    }
    if (res.intersects) {
      if (
        firstContact === null ||
        res.contactParam < firstContact.contactParam - ANGLE_EPS
      ) {
        firstContact = { circleIndex: i, ...res };
      }
    }
  });

  if (!Number.isFinite(minClearance)) minClearance = null;

  return {
    alpha,
    intersects: firstContact !== null,
    perCircle,
    minClearance,
    minClearanceCircle,
    firstContact,
  };
}

/**
 * 整体校核：按针的录入顺序返回首项冲突。
 * @returns {{needles: Array, conflict: ({needleIndex:number, circleIndex:number, contactAngle:number, contactParam:number, contactPoint:object}|null)}}
 */
export function analyze(needles, circles) {
  const results = needles.map((n) => evaluateNeedle(n, circles));
  let conflict = null;
  results.forEach((res, ni) => {
    if (conflict === null && res.intersects) {
      conflict = {
        needleIndex: ni,
        circleIndex: res.firstContact.circleIndex,
        contactAngle: res.firstContact.contactAngle,
        contactParam: res.firstContact.contactParam,
        contactPoint: res.firstContact.contactPoint,
      };
    }
  });
  return { needles: results, conflict };
}
