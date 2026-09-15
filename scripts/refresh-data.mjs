import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const BASE = 'https://championsbattledata.com';
const INDEX_API = `${BASE}/api`;
const POKEMON_PAGE = `${BASE}/pokemon/`;

const today = new Date().toISOString().slice(0, 10);
const nameMap = JSON.parse(await fs.readFile(path.join(root, 'data', 'name-map.zh-CN.json'), 'utf8'));

function normalizeId(value = '') {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function stripTags(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function flatten(obj, prefix = '', out = []) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== 'object') {
    out.push([prefix.toLowerCase(), obj]);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.slice(0, 20).forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
    return out;
  }
  for (const [key, value] of Object.entries(obj)) flatten(value, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

function findRank(entry, format) {
  const needle = format.toLowerCase().replace(/s$/, '');
  const pairs = flatten(entry);
  const candidates = [];
  for (const [key, raw] of pairs) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 1000) continue;
    if (!key.includes(needle)) continue;
    if (!/(rank|usage|position|current|summary)/.test(key)) continue;
    let score = 0;
    if (/rank/.test(key)) score += 6;
    if (/usage/.test(key)) score += 3;
    if (/current|latest/.test(key)) score += 2;
    if (key.includes(format.toLowerCase())) score += 1;
    candidates.push({ value, score, key });
  }
  candidates.sort((a, b) => b.score - a.score || a.key.length - b.key.length);
  return candidates[0]?.value ?? null;
}

function fromApiIndex(index) {
  if (!Array.isArray(index?.pokemon)) return [];
  const rows = [];
  for (const entry of index.pokemon) {
    const singlesRank = findRank(entry, 'Singles');
    const doublesRank = findRank(entry, 'Doubles');
    if (!singlesRank || !doublesRank) continue;
    const nameEn = entry.showdownName || entry.name || entry.saved_name || entry.savedName;
    const id = entry.showdownId || normalizeId(nameEn);
    if (!id || !nameEn) continue;
    rows.push({ id, nameEn, singlesRank, doublesRank });
  }
  return rows;
}

function fromPokemonPage(html) {
  const rows = [];
  const trMatches = html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const tr of trMatches) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 4) continue;
    const doublesRank = Number.parseInt(stripTags(cells[0]), 10);
    const singlesRank = Number.parseInt(stripTags(cells[3]), 10);
    if (!Number.isInteger(doublesRank) || !Number.isInteger(singlesRank)) continue;

    const href = cells[1].match(/href=["'][^"']*\/pokemon\/([^\/"'#?]+)\/?[^"']*["']/i);
    const imgAlt = cells[1].match(/alt=["']([^"']+)["']/i);
    let nameEn = stripTags(cells[1]);
    if (!nameEn && imgAlt) nameEn = imgAlt[1];
    const id = normalizeId(href?.[1] || nameEn);
    if (!id || !nameEn) continue;

    if (nameEn.length % 2 === 0) {
      const half = nameEn.length / 2;
      if (nameEn.slice(0, half) === nameEn.slice(half)) nameEn = nameEn.slice(0, half);
    }
    rows.push({ id, nameEn, singlesRank, doublesRank });
  }
  return rows;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'pokechamp-meta/1.0 (+community ranking tool)' } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'pokechamp-meta/1.0 (+community ranking tool)' } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

let sourceRows = [];
let method = 'api-index';
try {
  const index = await fetchJson(INDEX_API);
  sourceRows = fromApiIndex(index);
  if (sourceRows.length < 100) throw new Error(`API index 只解析到 ${sourceRows.length} 条完整排名`);
} catch (error) {
  console.warn(`API index 解析未通过：${error.message}`);
  method = 'pokemon-page-fallback';
  const html = await fetchText(POKEMON_PAGE);
  sourceRows = fromPokemonPage(html);
}

if (sourceRows.length < 100) {
  throw new Error(`刷新终止：只得到 ${sourceRows.length} 条完整排名，保留旧快照。`);
}

const seen = new Set();
const pokemon = sourceRows
  .filter((row) => !seen.has(row.id) && seen.add(row.id))
  .map((row) => {
    const translation = nameMap[row.id] || nameMap[normalizeId(row.nameEn)];
    return {
      id: row.id,
      nameZh: translation?.zh || row.nameEn,
      nameEn: translation?.en || row.nameEn,
      singlesRank: row.singlesRank,
      doublesRank: row.doublesRank,
    };
  });

const current = {
  meta: {
    schemaVersion: 1,
    season: 'Current',
    snapshotDate: today,
    generatedAt: new Date().toISOString(),
    source: {
      name: 'Pokémon Champions Battle Data',
      url: BASE,
      apiGuide: `${BASE}/api_guide`,
    },
    refreshMethod: method,
    note: 'Latest cache for the combined-ranking UI; battle data remains attributed to the upstream source.',
  },
  pokemon,
};

await fs.writeFile(path.join(root, 'data', 'current.json'), `${JSON.stringify(current, null, 2)}\n`);

const ranked = pokemon
  .map((p) => ({ ...p, linearScore: 0.2 * p.singlesRank + 0.8 * p.doublesRank }))
  .sort((a, b) => a.linearScore - b.linearScore || a.doublesRank - b.doublesRank || a.singlesRank - b.singlesRank)
  .slice(0, 100)
  .map((p, i) => ({ id: p.id, combinedRank: i + 1, linearScore: Number(p.linearScore.toFixed(1)) }));

const history = {
  meta: {
    schemaVersion: 1,
    season: current.meta.season,
    snapshotDate: today,
    kind: 'derived-ranking-history',
    sourceName: current.meta.source.name,
  },
  defaultWeights: { singles: 20, doubles: 80 },
  ranking: ranked,
};
await fs.mkdir(path.join(root, 'data', 'history'), { recursive: true });
await fs.writeFile(path.join(root, 'data', 'history', `${today}.json`), `${JSON.stringify(history, null, 2)}\n`);
console.log(`刷新完成：${pokemon.length} 条，方式=${method}，日期=${today}`);
