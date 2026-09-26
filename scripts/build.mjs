// 零依赖构建：语法检查浏览器端 ESM，并把静态站点拷贝到 dist/（排除测试文件）
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'web');
const outDir = join(root, 'dist');

function listJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listJs(p));
    else if (/\.(mjs|js)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

console.log('[build] 语法检查 ESM …');
for (const f of listJs(srcDir)) {
  execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
  console.log(`  ✓ ${relative(root, f)}`);
}

console.log('[build] 拷贝静态文件 → dist/ …');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(srcDir, outDir, {
  recursive: true,
  filter: (s) => !/\.test\.mjs$/.test(s),
});
console.log('[build] 完成：dist/');
