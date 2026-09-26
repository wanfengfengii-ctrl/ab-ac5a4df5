# syntax=docker/dockerfile:1

# ---- 构建/校验阶段：node 跑单元测试、静态构建与烟测，无需任何外部依赖 ----
FROM node:22-alpine AS builder
WORKDIR /app

# 零依赖项目：无 package-lock / node_modules 安装步骤
COPY package.json ./
COPY web ./web
COPY scripts ./scripts

# verify = 单元测试 → 构建 dist → 注胶扫掠模块烟测；任一失败即以非零码退出
RUN npm run verify

# ---- 静态站点阶段：nginx 提供纯前端页面 ----
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
