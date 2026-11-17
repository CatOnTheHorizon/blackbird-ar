# 《再见，黑鸟》

## 2027 伊坂幸太郎月历

黑鸟面包巴士月历 AR/VR 彩蛋：手机对准月历插画进入 AR；不使用相机时可进入 VR 纸偶场景。页面标题、贴片 metadata 和音频查询键在 v33 统一为同一版本。

**GitHub Pages**：https://catonthehorizon.github.io/blackbird-ar/

## v33 运行时变更

- 巴士在画幅内从左向右匀速循环：整车驶出右边界后从左侧重新进入；轮毂转角按行驶距离累计，回环时不归零。几何和采样逻辑位于 `lib/bus-motion.mjs`，正式线上校验会把它作为第 17 项提交字节核对。裁切平面附着于相应材质；VR 仍是纸偶式场景，不是完整 3D 模型。
- AR 保留高清真实相机预览。识别另用固定尺寸、等比例且最长边不超过 800px 的画布；支持 `requestVideoFrameCallback` 时随新相机帧刷新，否则由现有 `renderAR` 调用 `refresh()`，不另开抽帧动画循环，也不包装 MindAR 的 `inputLoader`。
- 页面使用固定版本的 MindAR。`MindARThree._startVideo` 接入 `createTrackingInput`，并向 MindAR 提供 `videoWidth` / `videoHeight`。正方形视频、没有 2D context 或无法安全保持精确比例时，按条件回退原始视频。
- 跟踪锚点与 `visualRoot` 为同级节点，姿态在渲染帧按时间平滑并保持正交变换；丢失目标或页面进入后台时隐藏、清屏并重置，回到前台后等待新的跟踪更新。
- 当前 `filterMinCF: 1`、`filterBeta: 0` 使用 MindAR 原生的近直通设置。已有查询串后追加 `&tracking=full` 会显式选择完整原始视频输入，用于回退对比；识别数据留在浏览器处理，不上传。
- AR 图层深度已调整：巴士 z=`0.005`、站牌 z=`0.015`、长椅 z=`0.035`、鸟沿原 z 值各加 `0.02`；不透明底板的纸面深度不变。VR 仍保持纸偶式平面场景。

## AR 与音乐边界

- v32 引入并由 v33 保留的摄像头启动流程，会先等待视频 `play()` 成功、尺寸有效且出现可显示帧，再加载识别素材；识别输入来自同一路摄像头，不二次请求媒体流。播放被浏览器拦截时显示点按恢复按钮，不把“已取到权限”误判为预览成功。
- AR 启动失败时停止采样回调、移除预览和叠加画布、释放 WebGL 渲染器、清理应用注册的监听器并停止摄像头轨道；丢失目标或切到后台会隐藏画面、清屏并重置姿态。失追容差期间重复的旧矩阵不算新的有效姿态；失败后的 resize 回调不再访问已释放的渲染器。摄像头被拒绝（`cameraPermission=denied`）时不能据此验证真实相机画面或识别成功。
- 音乐文件 `assets/audio/bye-bye-blackbird.mp3` 是用户提供的录音副本，约 10.8 MB、4:25、320 kbps；用户已授权随公开 GitHub Pages 托管，文件不是私密或仅本机播放。原件未改动，发布副本未经重采样。
- 音乐使用 `preload="none"`，手势进入 AR/VR 时尝试以 `0.35` 音量循环播放；被浏览器拦截时可点音乐按钮。页面进入后台暂停，退出或启动失败停止；音量也受设备和系统策略影响。v32 本地浏览器验证确认 MP3 解码成功（约 265.64 秒），播放/暂停、进入场景播放和返回停止均可工作；这不等于手机扬声器或 iOS 音量验证。
- v33 的 `ART_VERSION`、`assets/sprites/meta.json` 的 `version`、贴片和音频请求查询键均为 `33`。目标文件 `assets/target.jpg`、`target-1024.jpg`、`target.mind` 不由贴片构建改写。

## 两种模式

| 模式 | 入口 | 说明 |
|---|---|---|
| AR | 「开始 AR · 对准月历插画」 | 请求摄像头权限；识别原月历插画后显示 AR 贴片 |
| VR | 「进入 VR · 插画动起来」或 `?mode=vr&v=33` | 无需摄像头；观看纸偶式场景并拖动环视 |

需要回退路径对比时，在已有查询串后追加 `&tracking=full`，例如 `?v=33&tracking=full`。二维码：`assets/qr.png` 为通用入口，`assets/qr-vr.png` 为 VR 入口。

## 构建和测试

候选生成、隔离输入和历史停车预览的边界见 [PNG 构建说明](tools/STICKER_PREVIEW.md)。当前 v33 不使用旧版提取管线覆盖贴片；`preview-v27/` 中既有历史候选和备份不代表当前巴士循环动画，新建的 `v33-check` 是独立候选预览。

- `tools/extract_sticker_png.py`：从隔离源 PNG 生成候选，不覆盖生产资产。
- `tools/build_sticker_preview.py`：按当前运行时代码生成候选预览。它会改写所有 `./lib/` 相对引用，包含 `./lib/bus-motion.mjs` 的模块引用；音频引用指向项目 `assets/audio/` 下的原文件。
- `tools/package_sticker_release.py`：生成无调试控件的发布暂存目录，复制完整 `lib/` 和 `assets/audio/`，拒绝缺失或空 MP3。
- `tools/verify_pages_release.py`：从指定 Git 提交读取预期字节，校验线上入口、metadata、十张 WebP、三个 target、MP3 和 `lib/bus-motion.mjs`，共 17 项；MP3 必须同时匹配 SHA-256 与 `audio/mpeg` / `audio/mp3` 类型，运行时模块必须匹配 SHA-256 且 Content-Type 为 `text/javascript` / `application/javascript`（均允许附带参数）。每轮会完整下载音频，不能用 README、提交状态或本地预览替代线上验证。
- `tools/test_wheel_scene.mjs`：无需浏览器，覆盖三个场景配置、两圈循环、行驶边界、累计轮角和裁切平面材质设置。
- `tools/test_mobile_scene.mjs`：31/31 项 Node 回归，覆盖底板、星点合批、相机约束回退、画质策略、计时、暂停恢复、VR 资源释放、旧姿态门控和失败后 resize 保护；媒体和相机接口使用替身，不代表真机通过。
- `tools/test_background_music.mjs`：10/10 项独立音乐控制器回归，覆盖拒播、开关、后台恢复、退出和过期异步回调；音频及 DOM 使用替身。
- `tools/test_tracking_filter.mjs`：114 组合成场景分别按 30/60Hz 渲染，共 228 组组合，覆盖噪声、移动响应和矩阵转换，并与 v31 配置对照。当前组合在静止噪声上不全面优于 v31；这些结果不是实拍跟踪、屏幕像素或端到端延迟测试。
- `tools/test_tracking_pipeline.mjs`：126/126 项管线回归，覆盖采样比例、回退、清理、姿态刚体变换、失追重获和旧矩阵回调不复活；媒体和浏览器接口使用替身，不代表手机实测。
- `tools/test_camera_preview.mjs`：23/23 项真实预览控制器回归，覆盖首帧条件、拒播点按、错误、超时、恢复和释放；媒体接口使用替身，不是相机解码或屏幕像素测试。

```text
node tools/test_wheel_scene.mjs
node tools/test_mobile_scene.mjs
node tools/test_background_music.mjs
node tools/test_tracking_filter.mjs
node tools/test_tracking_pipeline.mjs
node tools/test_camera_preview.mjs
```

本地预览按钮和 `window.__previewMetrics` 仅反映候选页面按钮的即时反馈，不证明相机首帧、识别成功、手机启动耗时或手机流畅度改善。

## 验证范围与限制

- 相机权限被拒（`cameraPermission=denied`）时无法验收真实相机画面或识别链路；明确的拒绝提示和资源清理不能替代授权后的真机测试。
- 不宣称 v33 已改善手机帧率、手机启动耗时或所有设备的 AR 稳定性。桌面/本地 preview 只能检查 HTML、图层、素材完整性和动画几何。
- AR 不透明底板会覆盖识别画幅内的原印刷图案，但不能校正新 PNG 与印刷原画的构图差异，也遮不住识别画幅之外的印刷内容；实际对位仍需真机确认。
- PNG 是扁平拼版，鸟脚/尾与椅边交叠处有局部轮廓和重复木纹重建，不是恢复被遮挡的原始像素。
- 识别采样画布仅在尺寸、2D context 和精确比例均满足安全条件时启用；正方形或条件不满足时按既定门控回退原始视频，其他异常仍需明确报错。`tracking=full` 用于显式对比原始输入；识别数据不上传。
- 当前 MindAR 的匿名 resize 监听和识别资源仍有引用残留；失败保护只阻止后续访问已释放的渲染器，不等于完整销毁 SDK。停止与晚到初始化后的再次停止均保留；不在在途识别中直接关闭 worker，以免未决请求悬挂。连续启动失败后应刷新页面再试。

## 部署

GitHub Pages 从 `main` 分支根目录发布。通过系统代理推送后，必须以待发布提交运行 `tools/verify_pages_release.py`，待线上实际更新后核对启动页显示 **v33**、metadata `version` 为 `33`、十张 WebP、三个识别目标文件、MP3 和 `lib/bus-motion.mjs` 的 SHA-256 均与提交一致；MP3 响应 `Content-Type` 必须为 `audio/mpeg` / `audio/mp3`（允许附带参数）。手机测试使用 `?v=33`，VR 使用 `?mode=vr&v=33`；回退对比在已有查询串后追加 `&tracking=full`。二次校验会重新下载完整 MP3，请预留流量和时间。本地修改、提交或推送都不等同于 Pages 已完成更新。
