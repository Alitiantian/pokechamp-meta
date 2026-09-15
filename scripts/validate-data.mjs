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
const singles = [];
const doubles = [];
const pairCounts = new Map();

for (const [index, p] of (data.pokemon ?? []).entries()) {
  if (!p.id) errors.push(`pokemon[${index}] id 缺失`);
  if (ids.has(p.id)) errors.push(`重复 id: ${p.id}`);
  ids.add(p.id);
  if (!p.nameEn) errors.push(`${p.id ?? index} nameEn 缺失`);
  if (!Number.isInteger(p.singlesRank) || p.singlesRank < 1) errors.push(`${p.id} singlesRank 无效`);
  if (!Number.isInteger(p.doublesRank) || p.doublesRank < 1) errors.push(`${p.id} doublesRank 无效`);

  if (Number.isInteger(p.singlesRank) && p.singlesRank > 0) singles.push(p.singlesRank);
  if (Number.isInteger(p.doublesRank) && p.doublesRank > 0) doubles.push(p.doublesRank);
  if (Number.isInteger(p.singlesRank) && Number.isInteger(p.doublesRank)) {
    const key = `${p.singlesRank}/${p.doublesRank}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
}

if (data.pokemon?.length >= 100) {
  const distinctSingles = new Set(singles).size;
  const distinctDoubles = new Set(doubles).size;
  const maxSingles = singles.length ? Math.max(...singles) : 0;
  const maxDoubles = doubles.length ? Math.max(...doubles) : 0;
  const singleOnes = singles.filter((r) => r === 1).length;
  const doubleOnes = doubles.filter((r) => r === 1).length;
  const mostCommonPair = pairCounts.size ? Math.max(...pairCounts.values()) : 0;

  if (distinctSingles < 30) errors.push(`Singles 名次分布异常：仅 ${distinctSingles} 个不同名次`);
  if (distinctDoubles < 30) errors.push(`Doubles 名次分布异常：仅 ${distinctDoubles} 个不同名次`);
  if (maxSingles < 50) errors.push(`Singles 最大名次异常：${maxSingles}`);
  if (maxDoubles < 50) errors.push(`Doubles 最大名次异常：${maxDoubles}`);
  if (singleOnes > 5) errors.push(`Singles 第1名数量异常：${singleOnes}`);
  if (doubleOnes > 5) errors.push(`Doubles 第1名数量异常：${doubleOnes}`);
  if (mostCommonPair > Math.max(12, Math.floor(data.pokemon.length * 0.1))) {
    errors.push(`相同单双打名次组合重复过多：${mostCommonPair} 条`);
  }
}

if (errors.length) {
  console.error('数据校验失败：');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`OK: ${data.pokemon.length} 条数据，快照 ${data.meta.snapshotDate}；Singles distinct=${new Set(singles).size}, Doubles distinct=${new Set(doubles).size}`);
