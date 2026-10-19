# BlueV Community Publisher

Windows 桌面发布工作流的社区源码版：素材整理、内容检查、文案生成、素材和发布步骤管理。
基于 Electron，主要面向 Windows 与使用者自己管理的 Android 测试环境。

本仓库是经过筛选的独立源码快照，不包含原项目的 Git 历史、内部文档、业务数据、
真实模型密钥、原组织云端地址或 APK/工具二进制。它不是正式商用安装包的下载镜像。

## 开发启动

需要 Node.js 22 或更新版本、npm、Windows。先运行：

```powershell
npm ci
npm run check
npm test
```

模型密钥由使用者在应用中自行配置，或作为进程环境变量提供。不要提交真实 `.env`。
账号和品牌功能需要使用者自己的 Supabase 项目，不会连接原作者的组织服务。

```powershell
$env:BLUEV_OSS_SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co'
$env:BLUEV_OSS_SUPABASE_ANON_KEY = 'YOUR-PUBLIC-KEY'
$env:BLUEV_OSS_ORG = 'community'
npm start
```

自建服务说明见 [自建服务](docs/SELF-HOSTING.md)。未配置云端服务时，云端登录不可用；
本版没有绕过登录或内置管理员口令。`.env.example` 仅作变量说明，不会自动读取。

ADB、中文输入法和 ffmpeg 需要自行从各自官方渠道获取，并在本机配置。
APK 请使用应用官方提供的渠道；本仓库不提供或转存 APK。
不附带这些文件，因此需要它们的功能在未安装依赖前不可用，安装包中的自动安装按钮
也没有可分发的内置 APK。请只在获得授权的设备和账号上操作。

## Windows 打包

```powershell
npm run dist:win
```

社区版使用独立的应用标识，不会下载原项目的正式版更新。
本仓库 MIT 许可证只覆盖本项目有权许可的代码；另行取得的第三方工具按各自条款使用和分发。

## 从私有上游部分同步

同步是手动选择的单向流程，不使用能读取私有仓库的公开 Actions 凭据。
默认命令只预览。确认变化后添加 `--apply`，再自己审查提交和推送。

```powershell
# 在本仓库目录中运行；源目录应是你管理的私有工作树。
node tools/opensource-sync.cjs --source D:/work/private-app --target . --group publishing
node tools/opensource-sync.cjs --source D:/work/private-app --target . --group publishing --apply
npm run check
git diff
```

分组：`publishing` 为发布服务模块；`ui` 为界面和图标；`foundation` 为其他主进程基础模块；
`tests` 为明确允许的检查；`backend` 为筛选后的自建账号迁移；`all` 为完整白名单导出。
上游修复同时涉及多个组时，需要把相关组一起同步并测试，不能假设单个组总是独立可用。

真实密钥、云端地址、更新服务、打包元数据和本仓库文档由公开模板生成，不直接跟随私有配置。
同步检查敏感信息、目录越界和公开侧手工修改；发现冲突会停止，不能静默覆盖贡献者修改。
`.opensource-sync.json` 记录受管理文件的摘要与来源提交，不包含私有远端地址或账号凭据。
本工具只读取源仓库已提交的 HEAD，不会把未提交的本机配置一起同步。

同步工具不能代替人工审查。分组策略和脱敏规则变动时，先预览和检查，再更新公开模板。
