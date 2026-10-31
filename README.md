# 猫娘姐妹：幸存者 React

基于原版 v0.4.18 游戏内容的社区迁移版，使用 React、TypeScript 和 PixiJS。原作来自 [yousei1216/n.e.k.o_plugin_neko_survivors](https://github.com/yousei1216/n.e.k.o_plugin_neko_survivors)，参考提交为 `5ade0bb30726dc6207e616f1560af42cb99b6fb4`。

## 运行与操作

通过 NEKO 插件面板或 HTTP 本地服务器打开，不支持直接用 `file://` 打开构建入口。浏览器需要支持同源模块 Web Worker 和 WebGL2。

- WASD／方向键移动，武器自动开火；按住鼠标左键手动瞄准。
- ESC 暂停，M 静音；暂停页可调整玩家特效透明度和本次运行的柔光质量。
- 升级时 E 自动选择一次，Q 切换整局自动升级。
- 特殊挑战使用 Space 消弹、Shift 慢速移动，具体技能以游戏提示为准。
- 支持 1～4 人小队、猫娘代打及 P2 小键盘输入。

规则在专用 Worker 中以固定 60Hz 推进。桌面支持 OffscreenCanvas 时由独立渲染 Worker 显示；移动设备或不支持该能力时由主线程显示，均使用同一 WebGL2 引擎。移动档位采用 30fps 显示、DPR 上限 1。

默认使用原生柔光；平衡档将玩家光晕和彩色拖尾外层以半分辨率绘制，边缘和亮度会变化。

## 开发与测试

需要 Node.js 24 或更新版本。在本插件 `frontend/` 目录执行：

```sh
npm ci
npm run dev -- --port 5189
```

检查、构建及预览：

```sh
npm run typecheck
npm run check:imports
npm test
npm run build
npm run preview
```

整局规则检查和 Worker 差分：

```sh
node tests/game/campaign-check.mjs
node tests/game/campaign-check.mjs --party=4
npm run test:worker-campaign
```

Python 测试在本插件根目录使用包含 NEKO SDK 和 pytest 的 Python 环境执行：

```sh
python -m pytest tests
```

`frontend/src/game/` 管规则，`rendering/` 管 GPU 显示，`ui/` 管 React 界面，`app/` 负责装配；`simulation/` 和 `display/` 管线程通信，`host/`、`storage/`、`audio/`、`input/` 分别接入外部能力。

素材位于 `frontend/public/assets/`。构建生成 `static/index.html`、`static/app/` 和 `static/assets/`，保留本机角色缓存 `static/vendor/`。

## 宿主与存档

插件 ID 为 `neko_survivors_react`。角色形象、解说和语音使用 NEKO 的可选能力；宿主不可达时游戏仍可运行，独立网页默认不连接模型接口。

插件面板通过正式小游戏会话管理解说与语音，离开或更换对局时关闭对应会话。Live2D 从本机 NEKO 同步至运行时缓存，不随插件包分发。

可信宿主页可以在加载应用前设置 `window.__NEKO_SURVIVORS_HOST__`，注入已连接的 SDK client 或 `sdkBootstrap`；头像使用宿主预先注册的 `avatarSlot`。接口见 `frontend/src/host/index.ts`。

进度、成长和设置保存在浏览器独立命名空间中。加 `?diagnostics=1` 后，标题页显示旧档导入按钮，支持原版旧档与社区 v1；转换后写入新版格式，不删除旧键，不覆盖已有新版进度。正常保存退出会等待写入成功。

## 打包

先完成前端构建，再从 NEKO 宿主仓库根目录执行：

```sh
uv run neko-plugin check plugin/plugins/n.e.k.o_plugin_neko_survivors_react --release --target-dir plugin/plugins/n.e.k.o_plugin_neko_survivors_react/dist
uv run python plugin/plugins/n.e.k.o_plugin_neko_survivors_react/scripts/build-package.py
```

产物位于本插件 `dist/`，包含 `.neko-plugin` 包和从包中导出的 `plugin.meta.json`，不包含前端源码、依赖、测试产物或用户模型缓存。脚本通过宿主官方构建器的普通隔离扫描生成元数据，并校验入口表、源码指纹和包内容哈希；CI 使用相同脚本。元数据与发布包内容绑定，不能直接复制到含开发依赖的源码目录。

含点号的源码目录通过插件内 vendor shim 加载入口。开发目录在 `plugin.toml` 声明全部动作，供宿主静态发现；发布包使用生成的元数据。CI 宿主版本固定在 `protocol/host-revision.txt`。

## 性能工具

- `?diagnostics=1`：显示运行诊断及更多设置。
- `?profile=1`：采集性能数据，选择 1／2／4／8 倍模拟请求速度，并导出 JSON。
- `/src/rendering/dev/index.html`：开发显示夹具。

在 `frontend/` 目录执行：

```sh
npm run benchmark:mixed
npm run benchmark:mixed -- --cpu-profile
npm run build:profile
npm run profile:report -- --capture capture.json --cpu recording.cpuprofile --map test-results/profile-build/app/index-实际文件名.js.map --out test-results/my-hotspots
```

性能构建输出至 `frontend/test-results/profile-build/`，不会替代发布产物。CPU profile 需使用同次构建的 source map；采集和报告保存在本地。RAF 帧率、CPU 提交时间和 GPU 执行时间是不同指标，报告按线程分别统计。
