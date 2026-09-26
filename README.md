# 壁画修复 · 细裂隙注胶长针扫掠校核

在浏览器画布中录入或拖动 **2~5 根针**（支点、针长、起止角度、顺/逆时针方向）与
**1~6 个颜料保护圆**（圆心、半径），点击“校核”后，应用在本机把每根针身
**连续扫过的区域作为带方向的圆扇形**进行精确几何判断：

- 保护圆与扫掠区域**相交或相切均判为不安全**（相切净距为 0）；
- 不只检查起止两个停靠姿态——扫掠中途触及同样会被抓到（随机对拍单测保证）；
- 安全时显示每根针的**最小净距**；有风险时按**针录入顺序、再按该针旋转方向上
  最早触及位置**返回**首项冲突**（涉及第几根针、第几个保护圆、首次触及角度），
  并在画布上以红色虚线绘出触及瞬间的针位。

## 几何原理（要点）

一根针 = 支点 O、针长 L、起始角 θ₀，沿 dir（+1 逆时针 / −1 顺时针）转到 θ₁，
针身扫过的区域是闭圆扇形：

```
S = { O + ρ(cosθ, sinθ) | 0 ≤ ρ ≤ L, θ 位于 θ₀ 沿 dir 到 θ₁ 的有向弧上 }
```

- **相交判定**：圆心在局部极坐标 (d, δ)（δ 已按旋转方向归一化）下，计算圆心到
  扇形（两条半径边 + 针尖圆弧）的最短距离，与半径 r 比较，≤ r 即相交/相切。
- **首次触及角**：保护圆不覆盖支点（录入即拒绝），针绕支点旋转时距离关于
  相对方位角单调，存在唯一触及半角 c：
  - 针身边缘先触：`c = asin(r/d)`，接触点沿针距 `√(d²−r²)`；
  - 针尖先触：`c = asin(r/d)` 不再可达，改用针尖轨迹求交 `c = acos((d²+L²−r²)/(2dL))`；
  - 首次触及参数 `t = δ − c（+2π 折算到扫掠区间）`，绝对方位角 θ₀ + dir·t。

角度以标准数学坐标为准（0° 朝右、逆时针为正）；画布的屏幕 y 轴向下在渲染层转换。

## 项目结构

```
web/                 纯前端站点（原生 ESM，零运行时依赖）
├─ index.html
├─ styles.css
├─ app.js             画布拖动 / 数值录入 / 结果展示
└─ geom/
   ├─ sweep.mjs       扫掠扇形求交、净距、首次触及角（核心模块）
   ├─ validate.mjs    2~5 针 / 1~6 圆、角度互异、保护圆不得覆盖支点
   └─ sweep.test.mjs  node:test 单元测试（含 400 组随机 ×3600 姿态对拍）
scripts/
├─ build.mjs          零依赖构建：ESM 语法检查 + 拷贝到 dist/（排除测试文件）
└─ smoke.mjs          注胶扫掠模块烟测
Dockerfile           多阶段：builder 执行 verify，web 阶段 nginx 出静态页
docker/nginx.conf    /healthz 健康检查端点
docker-compose.yml   web（WEB_PORT 可配）+ 一次性 verify 服务
```

## 本机开发（无需安装依赖）

要求 Node.js ≥ 20：

```bash
npm test       # 几何单测
npm run build  # 语法检查 + 产出 dist/
npm run smoke  # 烟测
npm run verify # 测试 → 构建 → 烟测，退出码报告结果
```

本地预览：`(cd dist && python3 -m http.server 8080)` 后浏览器打开
`http://localhost:8080`。

## Docker

需要宿主机端口时用 `WEB_PORT`（默认 8080）：

```bash
WEB_PORT=9090 docker compose up -d --build web
curl http://localhost:9090/healthz   # ok
```

一次性校核服务（代码测试、构建及注胶扫掠模块烟测完成后自行退出，
**以退出码报告**：0 通过、非 0 失败）：

```bash
docker compose build verify
docker compose up verify            # 或：docker compose run --rm verify
echo $?
```

`Dockerfile` 的 `builder` 阶段构建时即执行 `npm run verify`，测试不过镜像无法构建。
