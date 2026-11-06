# 牛马便签墙 · Sticky Wall

DeepSeek Harness（DSH）左侧栏里的彩色便签墙。每条便签自带**一张纸色**和**一个日期**，按日期分组显示；今天最先，往后按日期排，过期还没勾掉的标红提醒。数据存在本机，自动保存。

## 功能

- **左侧栏入口**：侧栏面板列表里一个便签图标，点开就是便签墙。
- **6 种纸色**：暖黄、浅粉、天蓝、草绿、雾紫、沙色，写的时候选。
- **每条一个日期**：默认今天，可以改成任意一天。
- **按日期分组**：今天 → 未来（升序）→ 过去（倒序）；某天还有没勾掉的任务时标「已逾期」。
- **快速输入**：`Ctrl/⌘ + Enter` 或点「添加到墙上」；`Enter` 换行。
- **卡片操作**：勾选完成、编辑（文字/日期/颜色）、删除（带确认）。
- **搜索**：按内容过滤，右上角显示「N 张便签」。
- **给 agent 的工具**：`task_records`（list / add / update / remove），和页面共用同一份数据——你让 AI「帮我记一下…」也会进这面墙。
- **自动保存**：所有改动即时写入 `$DSH_HOME/sticky-notes.json`（默认 `~/.dsh/sticky-notes.json`）。

## 安装

从 npm 安装（推荐）：

```bash
dsh plugin --profile desktop add dsh-niuma-sticky-wall
```

或者从 GitHub 源码安装（没有构建步骤）：

```bash
dsh plugin --profile desktop add github:zxy29/dsh-niuma-sticky-wall
```

装完重启 DSH（或刷新页面）。侧栏出现「牛马便签墙」入口。

## 使用

1. 点侧栏的便签图标。
2. 在顶部输入框写一条，选纸色和日期，`Ctrl/⌘ + Enter` 贴到墙上。
3. 卡片左下角勾选完成；鼠标悬停出现编辑/删除。
4. 过期未完成的日期分组会变成红色并标「已逾期」。

## 数据

- 文件：`$DSH_HOME/sticky-notes.json`（`$DSH_HOME` 默认是 `~/.dsh`）
- 卸载插件不会删除这个文件；重新装回来便签还在。
- 文件是纯 JSON，可以直接备份。

## 文件结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：便签存储、`/api/sticky-notes/notes` 接口、`task_records` 工具 |
| `client.js` | 浏览器半：侧栏图标 + 便签墙页面（React，无构建步骤） |
| `cordis.patch.yml` | 安装时插入的插件行 |
| `locale/zh.json`、`locale/en.json` | 插件列表里的标题与描述 |
| `icon.svg` | 插件图标 |
| `scripts/check.mjs` | 发布前自检：三处包名一致、清单、图标、locale、语法 |

## 开发

```bash
# 改完自检
node scripts/check.mjs

# 本机开发安装（链接模式，改代码会热重载）
dsh plugin --profile desktop add ./
```

改包名时三处必须同步：`package.json` 的 `name`、`cordis.patch.yml` 的行 `name`、`client.js` 里 `__ModuleLoader__.load({ id })`。`scripts/check.mjs` 会检查这一点。

## English

A colored sticky-note wall in the DSH sidebar. Each note carries a paper color and a calendar day; notes are grouped by day (today first, upcoming days, then past days) and a past day with open notes is flagged overdue. Notes are stored locally in `$DSH_HOME/sticky-notes.json`, and the same list is exposed to the agent through the `task_records` tool.

Install: `dsh plugin --profile desktop add dsh-niuma-sticky-wall`

## License

MIT
