# PokéChamp Meta

Pokémon Champions 的跨赛制 Meta 排名工具。默认按 **单打 20% + 双打 80%** 融合排名，并提供三种算法：

- **线性综合**：`0.2 × Singles Rank + 0.8 × Doubles Rank`，越低越好。
- **Top-heavy**：基于 Reciprocal Rank Fusion 思路，提高 Top 区域的权重。
- **双栖价值**：在 Top-heavy 基础上奖励单双打都靠前的宝可梦。

## 数据结构

- `data/current.json`：网站使用的最新缓存。
- `data/history/YYYY-MM-DD.json`：仅保存默认 20/80 的衍生历史排名，不镜像上游完整原始数据库。
- `data/name-map.zh-CN.json`：中文名映射；没有映射时自动回退英文名。

数据来源：**Pokémon Champions Battle Data**  
https://championsbattledata.com/  
API 文档：https://championsbattledata.com/api_guide

本项目为非官方社区工具，与 Pokémon / Nintendo / GAME FREAK / Creatures / The Pokémon Company 无隶属或赞助关系。

## 本地预览

不需要 npm install。

```bash
npm run serve
```

然后打开：

```text
http://localhost:4173
```

## 手动更新数据

```bash
npm run refresh:data
npm run validate
```

刷新脚本首先读取上游 API index；如果当前 index 结构无法解析排名，会退回读取上游的 Pokémon usage index 页面。若完整排名少于 100 条，脚本直接失败并保留旧快照。

## 自动维护

`.github/workflows/refresh-data.yml` 每天 UTC 00:17 运行一次（北京时间约 08:17，GitHub 定时任务可能延迟）：

1. 抓取最新单打 / 双打排名；
2. 校验数据；
3. 更新 `data/current.json`；
4. 写入当天的衍生历史快照；
5. 有变更才自动 commit / push；
6. Vercel 连接仓库后会自动重新部署。

如果上游异常或页面结构变化，workflow 会失败，生产站继续使用上一次成功的数据，不会把空数据发布出去。

## Vercel

这是纯静态站点，Vercel Framework Preset 选 **Other** 即可，不需要 Build Command，也不需要 Output Directory。
