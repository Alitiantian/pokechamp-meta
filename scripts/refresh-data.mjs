import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const BASE = 'https://championsbattledata.com';
const POKEMON_PAGE = `${BASE}/pokemon/`;
const SPECIES_NAMES_CSV_URL = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv';
const today = new Date().toISOString().slice(0, 10);

const nameMap = JSON.parse(await fs.readFile(path.join(root, 'data', 'name-map.zh-CN.json'), 'utf8'));
const translationByEnglish = new Map(
  Object.values(nameMap)
    .filter((entry) => entry?.en)
    .map((entry) => [normalizeId(entry.en), entry]),
);

const specialFormOverrides = new Map([
  ['arcaninehisui', '风速狗（洗翠的样子）'],
  ['typhlosionhisui', '火暴兽（洗翠的样子）'],
  ['zoroarkhisui', '索罗亚克（洗翠的样子）'],
  ['samurotthisui', '大剑鬼（洗翠的样子）'],
  ['goodrahisui', '黏美龙（洗翠的样子）'],
  ['decidueyehisui', '狙射树枭（洗翠的样子）'],
  ['avalugghisui', '冰岩怪（洗翠的样子）'],
  ['ninetalesalola', '九尾（阿罗拉的样子）'],
  ['persianalola', '猫老大（阿罗拉的样子）'],
  ['raichualola', '雷丘（阿罗拉的样子）'],
  ['slowkinggalar', '呆呆王（伽勒尔的样子）'],
  ['slowbrogalar', '呆壳兽（伽勒尔的样子）'],
  ['stunfiskgalar', '泥巴鱼（伽勒尔的样子）'],
  ['taurospaldeacombat', '肯泰罗（帕底亚的样子·斗战种）'],
  ['taurospaldeablaze', '肯泰罗（帕底亚的样子·火炽种）'],
  ['taurospaldeaaqua', '肯泰罗（帕底亚的样子·水澜种）'],
  ['indeedee', '爱管侍♂'],
  ['indeedeef', '爱管侍♀'],
  ['basculegion', '幽尾玄鱼♂'],
  ['basculegionf', '幽尾玄鱼♀'],
  ['meowstic', '超能妙喵（雄性的样子）'],
  ['meowsticf', '超能妙喵（雌性的样子）'],
  ['toxtricity', '颤弦蝾螈（高调的样子）'],
  ['toxtricitylowkey', '颤弦蝾螈（低调的样子）'],
  ['lycanrocdusk', '鬃岩狼人（黄昏的样子）'],
  ['lycanrocmidnight', '鬃岩狼人（黑夜的样子）'],
  ['vivillonfancy', '彩粉蝶（幻彩花纹）'],
  ['mausholdfour', '一家鼠（四只家庭）'],
  ['rotomheat', '加热洛托姆'],
  ['rotomwash', '清洗洛托姆'],
  ['rotomfrost', '结冰洛托姆'],
  ['rotomfan', '旋转洛托姆'],
  ['rotommow', '切割洛托姆'],
  ['squawkabillyyellow', '怒鹦哥（黄羽毛）'],
  ['gourgeist', '南瓜怪人（中颗种）'],
  ['gourgeistsmall', '南瓜怪人（小颗种）'],
  ['gourgeistlarge', '南瓜怪人（大颗种）'],
  ['gourgeistsuper', '南瓜怪人（巨颗种）'],
  ['floetteeternal', '花叶蒂（永恒之花）'],
]);

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

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'pokechamp-meta/1.3 (+community ranking tool)' },
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

async function loadCanonicalSpeciesTranslations() {
  try {
    const csv = await fetchText(SPECIES_NAMES_CSV_URL);
    const bySpecies = new Map();
    for (const line of csv.split(/\r?\n/).slice(1)) {
      if (!line) continue;
      const [speciesId, languageId, name] = parseCsvLine(line);
      if (!speciesId || !languageId || !name) continue;
      const lang = Number(languageId);
      if (lang !== 9 && lang !== 12) continue;
      const entry = bySpecies.get(speciesId) || {};
      if (lang === 9) entry.en = name;
      if (lang === 12) entry.zh = name;
      bySpecies.set(speciesId, entry);
    }

    const map = new Map();
    for (const entry of bySpecies.values()) {
      if (entry.en && entry.zh) map.set(normalizeId(entry.en), entry.zh);
    }
    if (map.size < 900) {
      throw new Error(`PokeAPI 简中名称表解析数量异常：${map.size}`);
    }
    return map;
  } catch (error) {
    console.warn(`PokeAPI 全国图鉴简中名称表加载失败，将仅使用本地覆写：${error.message}`);
    return new Map();
  }
}

function resolveChineseName(row, canonicalSpecies) {
  const auditedForm = specialFormOverrides.get(row.id);
  if (auditedForm) return auditedForm;

  const exact = canonicalSpecies.get(normalizeId(row.nameEn));
  if (exact) return exact;

  const localOverride = nameMap[row.id] || translationByEnglish.get(normalizeId(row.nameEn));
  if (localOverride?.zh) return localOverride.zh;

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

const pokemon = sourceRows.map((row) => ({
  id: row.id,
  nameZh: resolveChineseName(row, canonicalSpecies),
  nameEn: row.nameEn,
  singlesRank: row.singlesRank,
  doublesRank: row.doublesRank,
}));

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
      baseNameSource: 'PokeAPI pokemon_species_names.csv (zh-hans)',
      formNamePolicy: 'audited-overrides-only',
    },
    refreshMethod: 'pokemon-index-table',
    note: 'Ranks come from the upstream Pokémon index table. Simplified Chinese species names come from PokeAPI zh-hans data; special forms use audited local overrides rather than automatic label composition.',
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
