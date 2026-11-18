# Git 记录说明

## 一、历史沿革（如实说明）

本项目开发期为 **2026-10-24 至 2026-10-29**，当时的协作方式是本地文件目录 + 人工备份（`stray-star/` 各阶段快照、`HANDOVER.md` 里逐日记录的设计取舍），**没有初始化 Git 仓库**。因此不存在逐日、逐功能的原始提交记录。

当前这个仓库是在 **2026-11-17** 由最终开发快照整理建立的：为了让评审能读懂代码是怎么一层层长起来的，提交**按模块依赖顺序拆分**（工程配置 → 数据模型 → 基础设施 → AI 能力 → 各业务模块 → 接口 → 页面 → 测试 → 文档），而不是把整包一次性塞进一个提交。

需要明确的一点：**这些提交的时间戳是同一天，它们反映的是代码的模块结构，不是真实的开发时间线。** 原始的设计决策过程记录在 [`../HANDOVER.md`](../HANDOVER.md) 与各模块的文件头注释里（多数带日期，例如 `2026-10-29 补一条例外：设备定位可以给坐标`）。

## 二、如果原开发机还留着 `.git`

若早期某台机器、云盘或备份里存在过 `.git` 目录，应当用它替换本仓库的历史——那才是真实的开发过程。步骤：

```bash
# 1) 在原始项目目录确认历史完整
cd <原始项目目录>
git log --oneline | head
git rev-list --count HEAD

# 2) 用原始历史覆盖本仓库（保留本仓库新增的文档）
cd <本仓库目录>
git remote add origin-local <原始项目目录>
git fetch origin-local
git reset --hard origin-local/main      # 或用 rebase 把文档提交叠在其后
```

如果原始历史存在但缺少最后几天的提交，更稳妥的做法是 `git fetch` 后 `git rebase`，而不是 `reset --hard`。

## 三、本仓库的提交规范

格式见 [`代码规范.md`](./代码规范.md#八git-提交规范)：Conventional Commits + 中文描述，一条提交只做一件事。

```bash
git add <具体文件>          # 避免 git add . 把临时文件带进去
git commit -m "feat(agent): recordLocation 支持设备定位

用户说「就在这儿」时不再要求说地名；坐标由服务端从本轮授权里取，
模型仍然没有经纬度入参。"
```

几个硬性要求：

- **不提交** `.env`、`node_modules/`、`.next/`、`*.tsbuildinfo`、`public/uploads/` 下的用户图片（`.gitignore` 已覆盖，`public/uploads/.gitkeep` 用于保留目录）。
- 修复类提交在正文写清**触发条件**（什么输入、什么环境会复现），便于日后回归。
- 重构与功能分开提交，评审看 diff 时才读得懂。

## 四、分支与标签

| 名称 | 用途 |
|---|---|
| `main` | 可运行的主线，任何时候 clone 下来都能按 README 跑起来 |
| `feat/*` | 单个功能的开发分支，合入前跑完 `lint` + `typecheck` + 相关 `*-selftest` |
| `v1.0-submission` | 参赛提交标签，已打在冻结评审版本的提交上，后续开发继续在 `main` 上推进 |

```bash
# 已执行（2026-11-18）
git tag -a v1.0-submission -m "参赛提交版本 v1.0"
git push -u origin main
git push origin v1.0-submission
```

## 五、托管与可见性

本仓库已托管于 **https://github.com/arknight-ash/stray-star**，可见性 **Public**，默认分支 `main`，
标签 `v1.0-submission` 已推送。评审可直接 clone：

```bash
git clone https://github.com/arknight-ash/stray-star.git
git checkout v1.0-submission   # 如需查看冻结的评审版本
```

如需迁移到其他账号或平台（GitHub / Gitee），命令如下：

```bash
# GitHub
git remote add origin https://github.com/<账号>/<仓库名>.git
git push -u origin main
# 然后在 Settings → General → Danger Zone → Change visibility 设为 Public
# 或 Settings → Collaborators 添加评审账号

# Gitee
git remote add origin https://gitee.com/<账号>/<仓库名>.git
git push -u origin main
# 仓库设置 → 基本信息 → 开源（公开）；或 仓库成员管理 添加评审账号
```

推送前最后确认一遍没有敏感信息：

```bash
git log --all --stat | grep -iE "\.env$|secret|password" | head
git grep -nE "sk-[A-Za-z0-9]{16,}|AI_API_KEY=.+|ADMIN_PASSWORD=.+" $(git rev-list --all) -- 2>/dev/null | head
```
