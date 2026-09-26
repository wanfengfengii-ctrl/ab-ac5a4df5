// 录入数据校验（2~5 根针、1~6 个保护圆、角度互异、保护圆不得覆盖支点）
import { degToRad } from './sweep.mjs';

export const LIMITS = {
  needles: { min: 2, max: 5 },
  circles: { min: 1, max: 6 },
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 解析并校验 UI/外部提交的原始数据。
 * 输入：
 *   rawNeedles: [{ pivot:{x,y}, length, startDeg, endDeg, dir }]
 *   rawCircles:[{ center:{x,y}, radius }]
 * 成功返回 { ok:true, needles, circles }（角度已转弧度，dir 归一化为 ±1）；
 * 失败返回 { ok:false, errors:[{where,message}] }。
 */
export function validateInput(rawNeedles, rawCircles) {
  const errors = [];

  const needles = [];
  const circles = [];

  if (!Array.isArray(rawNeedles) || rawNeedles.length < LIMITS.needles.min) {
    errors.push({ where: 'needles', message: `针数量必须为 ${LIMITS.needles.min}~${LIMITS.needles.max} 根` });
  } else if (rawNeedles.length > LIMITS.needles.max) {
    errors.push({ where: 'needles', message: `针数量最多 ${LIMITS.needles.max} 根` });
  }

  if (!Array.isArray(rawCircles) || rawCircles.length < LIMITS.circles.min) {
    errors.push({ where: 'circles', message: `保护圆数量必须为 ${LIMITS.circles.min}~${LIMITS.circles.max} 个` });
  } else if (rawCircles.length > LIMITS.circles.max) {
    errors.push({ where: 'circles', message: `保护圆数量最多 ${LIMITS.circles.max} 个` });
  }

  const needleList = Array.isArray(rawNeedles) ? rawNeedles : [];
  const circleList = Array.isArray(rawCircles) ? rawCircles : [];

  needleList.forEach((n, i) => {
    const where = `needle[${i + 1}]`;
    const x = num(n?.pivot?.x);
    const y = num(n?.pivot?.y);
    const length = num(n?.length);
    const startDeg = num(n?.startDeg);
    const endDeg = num(n?.endDeg);
    let dir = num(n?.dir);
    if (dir !== null) dir = dir >= 0 ? 1 : -1;
    else dir = null;

    if (x === null || y === null) errors.push({ where, message: '支点坐标必须为数字' });
    if (length === null || length <= 0) errors.push({ where, message: '针长必须为正数' });
    if (startDeg === null || endDeg === null) {
      errors.push({ where, message: '起止角度必须为数字' });
    } else if (((startDeg - endDeg) % 360 + 360) % 360 < 1e-9) {
      errors.push({ where, message: '同一根针的起始角与终止角必须不同' });
    }
    if (dir === null) errors.push({ where, message: '旋转方向必须为顺时针(-1)或逆时针(+1)' });

    if ([x, y, length, startDeg, endDeg, dir].every((v) => v !== null)) {
      needles.push({
        pivot: { x, y },
        length,
        startAngle: degToRad(startDeg),
        endAngle: degToRad(endDeg),
        dir,
      });
    }
  });

  circleList.forEach((c, i) => {
    const where = `circle[${i + 1}]`;
    const x = num(c?.center?.x);
    const y = num(c?.center?.y);
    const radius = num(c?.radius);
    if (x === null || y === null) errors.push({ where, message: '圆心坐标必须为数字' });
    if (radius === null || radius <= 0) errors.push({ where, message: '保护圆半径必须为正数' });
    if (x !== null && y !== null && radius !== null && radius > 0) {
      circles.push({ center: { x, y }, radius });
    }
  });

  // 保护圆不得覆盖支点（支点在圆内或圆上均拒绝）
  if (!errors.some((e) => e.where.startsWith('needle') || e.where.startsWith('circle'))) {
    needles.forEach((n, ni) => {
      circles.forEach((c, ci) => {
        const d = Math.hypot(n.pivot.x - c.center.x, n.pivot.y - c.center.y);
        if (d <= c.radius + 1e-9 * Math.max(1, c.radius, n.length)) {
          errors.push({
            where: `needle[${ni + 1}]/circle[${ci + 1}]`,
            message: `保护圆 ${ci + 1} 覆盖了第 ${ni + 1} 根针的支点（支点不得在圆内或圆上）`,
          });
        }
      });
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, needles, circles };
}
