import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const BASE = 'https://championsbattledata.com';
const POKEMON_PAGE = `${BASE}/pokemon/`;
const SPECIES_EN_URL = 'https://raw.githubusercontent.com/sindresorhus/pokemon/main/data/en.json';
const SPECIES_ZH_URL = 'https://raw.githubusercontent.com/sindresorhus/pokemon/main/data/zh-hans.json';
const today = new Date().toISOString().slice(0, 10);

const nameMap = JSON.parse(await fs.readFile(path.join(root, 'data', 'name-map.zh-CN.json'), 'utf8'));
const translationByEnglish = new Map(
  Object.values(nameMap)
    .filter((entry) => entry?.en)
    .map((entry) => [normalizeId(entry.en), entry]),
);

function normalizeId(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePokemonIndex(html) {
  const rows = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 4) continue;

    const doublesRank = Number.parseInt(stripTags(cells[0]), 10);
    const singlesRank = Number.parseInt(stripTags(cells[3]), 10);
    if (!Number.isInteger(doublesRank) || doublesRank < 1) continue;
    if (!Number.isInteger(singlesRank) || singlesRank < 1) continue;

    const hrefMatch = cells[1].match(/href=["'][^"']*\/pokemon\/([^\/"'#?]+)\/?[^"']*["']/i);
    const anchorMatch = cells[1].match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const imgAltMatch = cells[1].match(/alt=["']([^"']+)["']/i);

    let nameEn = stripTags(anchorMatch?.[1] || cells[1]);
    if (!nameEn && imgAltMatch) nameEn = decodeEntities(imgAltMatch[1]).trim();
    if (!nameEn) continue;

    const rawSlug = hrefMatch?.[1] || nameEn;
    const id = normalizeId(rawSlug);
    if (!id) continue;

    rows.push({ id, nameEn, singlesRank, doublesRank });
  }
  return rows;
}

function assertSane(rows) {
  if (rows.length < 150) {
    throw new Error(`刷新终止：只解析到 ${rows.length} 条排名，低于安全阈值 150。`);
  }

  const singles = rows.map((r) => r.singlesRank);
  const doubles = rows.map((r) => r.doublesRank);
  const distinctSingles = new Set(singles).size;
  const distinctDoubles = new Set(doubles).size;
  const maxSingles = Math.max(...singles);
  const maxDoubles = Math.max(...doubles);
  const singleOnes = singles.filter((r) => r === 1).length;
  const doubleOnes = doubles.filter((r) => r === 1).length;

  if (distinctSingles < 50 || distinctDoubles < 50) {
    throw new Error(`刷新终止：名次分布异常（Singles distinct=${distinctSingles}, Doubles distinct=${distinctDoubles}）。`);
  }
  if (maxSingles < 100 || maxDoubles < 100) {
    throw new Error(`刷新终止：榜尾名次异常（Singles max=${maxSingles}, Doubles max=${maxDoubles}）。`);
  }
  if (singleOnes > 5 || doubleOnes > 5) {
    throw new Error(`刷新终止：第 1 名数量异常（Singles=${singleOnes}, Doubles=${doubleOnes}）。`);
  }

  const pairCounts = new Map();
  for (const row of rows) {
    const key = `${row.singlesRank}/${row.doublesRank}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  const mostCommonPair = Math.max(...pairCounts.values());
  if (mostCommonPair > Math.max(12, Math.floor(rows.length * 0.1))) {
    throw new Error(`刷新终止：大量宝可梦获得相同单双打名次（最大重复 ${mostCommonPair} 条）。`);
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'pokechamp-meta/1.2 (+community ranking tool)' },
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function loadCanonicalSpeciesTranslations() {
  try {
    const [english, chinese] = await Promise.all([
      fetchJson(SPECIES_EN_URL),
      fetchJson(SPECIES_ZH_URL),
    ]);
    if (!Array.isArray(english) || !Array.isArray(chinese) || english.length !== chinese.length || english.length < 1000) {
      throw new Error(`物种名称表结构异常：en=${english?.length}, zh=${chinese?.length}`);
    }
    const map = new Map();
    english.forEach((name, i) => {
      if (name && chinese[i]) map.set(normalizeId(name), chinese[i]);
    });
    return map;
  } catch (error) {
    console.warn(`全国图鉴简中名称表加载失败，将仅使用本地覆写：${error.message}`);
    return new Map();
  }
}

const formLabels = new Map([
  ['alola', '阿罗拉'],
  ['galar', '伽勒尔'],
  ['hisui', '洗翠'],
  ['paldea', '帕底亚'],
  ['f', '♀'],
  ['m', '♂'],
  ['four', '四只家庭'],
  ['three', '三只家庭'],
  ['low-key', '低调的样子'],
  ['amped', '高调的样子'],
  ['fancy', '幻彩花纹'],
]);

function resolveChineseName(row, canonicalSpecies) {
  const override = nameMap[row.id] || translationByEnglish.get(normalizeId(row.nameEn));
  if (override?.zh) return override.zh;

  const exact = canonicalSpecies.get(normalizeId(row.nameEn));
  if (exact) return exact;

  const parts = row.nameEn.split('-');
  for (let cut = parts.length - 1; cut >= 1; cut -= 1) {
    const baseEn = parts.slice(0, cut).join('-');
    const suffix = parts.slice(cut).join('-').toLowerCase();
    const baseZh = canonicalSpecies.get(normalizeId(baseEn));
    const label = formLabels.get(suffix);
    if (baseZh && label) return `${baseZh}（${label}）`;
  }

  return row.nameEn;
}

const html = await fetchText(POKEMON_PAGE);
const parsed = parsePokemonIndex(html);

const seen = new Set();
const sourceRows = parsed.filter((row) => {
  if (seen.has(row.id)) return false;
  seen.add(row.id);
  return true;
});

assertSane(sourceRows);
const canonicalSpecies = await loadCanonicalSpeciesTranslations();

const pokemon = sourceRows.map((row) => {
  const localOverride = nameMap[row.id] || translationByEnglish.get(normalizeId(row.nameEn));
  return {
    id: row.id,
    nameZh: resolveChineseName(row, canonicalSpecies),
    nameEn: localOverride?.en || row.nameEn,
    singlesRank: row.singlesRank,
    doublesRank: row.doublesRank,
  };
});

const untranslated = pokemon.filter((p) => p.nameZh === p.nameEn).map((p) => p.nameEn);
if (untranslated.length) {
  console.warn(`仍有 ${untranslated.length} 个名称未汉化：${untranslated.join(', ')}`);
}

const current = {
  meta: {
    schemaVersion: 2,
    season: 'Current',
    snapshotDate: today,
    generatedAt: new Date().toISOString(),
    source: {
      name: 'Pokémon Champions Battle Data',
      url: BASE,
      apiGuide: `${BASE}/api_guide`,
      rankingPage: POKEMON_PAGE,
    },
    localization: {
      language: 'zh-Hans',
      translated: pokemon.length - untranslated.length,
      untranslated: untranslated.length,
      baseNameSource: 'sindresorhus/pokemon',
    },
    refreshMethod: 'pokemon-index-table',
    note: 'Ranks come from the upstream Pokémon index table. Simplified Chinese species names use local form overrides plus a complete National Pokédex base-name list.',
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

console.log(`刷新完成：${pokemon.length} 条，汉化 ${pokemon.length - untranslated.length}/${pokemon.length}，方式=pokemon-index-table，日期=${today}`);
