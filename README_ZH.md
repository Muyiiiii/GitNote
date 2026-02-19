# GitNote Quick

一款轻量级 Electron 桌面应用，用于管理文本片段，通过私有 GitHub 仓库实现零成本同步。

## 发布

当前版本：**v1.0.0**

- 最新版本：`https://github.com/<owner>/<repo>/releases/latest`
- 更新日志：`https://github.com/<owner>/<repo>/releases`

## 功能特性

### 片段管理

- 全局唤醒快捷键：`Ctrl+Shift+V`（Windows/Linux）/ `Cmd+Shift+V`（macOS）
- 无边框浮动窗口，始终置顶，不显示在任务栏
- 失去焦点或再次按下快捷键时自动隐藏
- 按 `Enter` 或点击片段即可复制并隐藏窗口
- `Ctrl+N` — 新建片段
- `Ctrl+E` — 编辑选中片段
- 实时搜索/筛选所有片段
- 系统托盘图标，支持快捷菜单操作

### GitHub 同步

- 启动时：静默执行 `git pull --rebase`
- 数据变更后：延迟 5 秒 → `git add .` → `git commit -m "update"` → `git push`
- 推送失败时弹出对话框：可选强制覆盖（`--force-with-lease`）或手动解决冲突

### 数据保护

- **加密模式**（默认）：片段使用 AES-256-GCM 加密存储；密钥通过 PBKDF2-SHA256（210,000 轮）派生
- **明文模式**：可选，适合在仓库中保留可读的同步历史
- PAT 通过 Electron `safeStorage`（系统凭据存储）加密保存
- 每次会话启动时提示解锁 Vault

### 存储与设置

- 可自定义存储目录（默认使用 Electron `userData` 路径）
- 数据文件：本地仓库克隆目录下的 `storage/data.json`
- 记住窗口位置和大小
- 内置日志查看器（`设置 → View Logs`）

## 环境要求

- [Node.js](https://nodejs.org/) ≥ 18
- [Git](https://git-scm.com/) 已安装并添加到 `PATH`

## 开发环境启动

1. 安装依赖：

```bash
npm install
```

2. 启动应用：

```bash
npm start
```

3. 首次启动时，填写配置表单：
   - **Repo URL** — 例如 `https://github.com/<your-name>/<your-private-repo>.git`
   - **Branch** — 例如 `main`
   - **PAT** — 具有 `repo` 读写权限的 GitHub 个人访问令牌

## 打包构建

```bash
npm run build:win   # Windows — 在 dist/ 生成 NSIS 安装包
npm run build:mac   # macOS  — 在 dist/ 生成 DMG
npm run build       # 当前平台
```

## GitHub 私有仓库准备

1. 创建一个 **私有** GitHub 仓库。
2. `storage/data.json` 会在首次同步时自动创建，也可手动添加。
3. 生成细粒度令牌或经典 PAT，需具备仓库读写权限。
4. 请妥善保管令牌——应用会通过 Electron `safeStorage` 加密存储。

## 项目结构

```
src/
├── main.js       # 全局快捷键、窗口、托盘、IPC 处理、Git 同步、Vault 加密
├── renderer.js   # UI 渲染、筛选、列表交互
├── preload.js    # 安全 IPC 桥接（contextBridge）
├── index.html    # 应用框架：配置、主列表、编辑器、设置、日志、Vault 面板
└── styles.css    # Raycast/Spotlight 风格主题
```

## 许可证

MIT
