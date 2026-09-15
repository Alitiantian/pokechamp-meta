import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const currentPath = path.join(root, 'data', 'current.json');
const data = JSON.parse(await fs.readFile(currentPath, 'utf8'));

const errors = [];
if (!data?.meta?.snapshotDate) errors.push('meta.snapshotDate 缺失');
if (!data?.meta?.source?.url) errors.push('meta.source.url 缺失');
if (!Array.isArray(data?.pokemon) || data.pokemon.length < 50) errors.push('pokemon 数据不足 50 条');

const ids = new Set();
for (const [index, p] of (data.pokemon ?? []).entries()) {
  if (!p.id) errors.push(`pokemon[${index}] id 缺失`);
  if (ids.has(p.id)) errors.push(`重复 id: ${p.id}`);
  ids.add(p.id);
  if (!p.nameEn) errors.push(`${p.id ?? index} nameEn 缺失`);
  if (!Number.isInteger(p.singlesRank) || p.singlesRank < 1) errors.push(`${p.id} singlesRank 无效`);
  if (!Number.isInteger(p.doublesRank) || p.doublesRank < 1) errors.push(`${p.id} doublesRank 无效`);
}

if (errors.length) {
  console.error('数据校验失败：');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`OK: ${data.pokemon.length} 条数据，快照 ${data.meta.snapshotDate}`);
