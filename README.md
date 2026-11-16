# 黑鸟面包巴士 · 月历 AR/VR 彩蛋

2026 伊坂幸太郎月历的隐藏彩蛋：手机对准月历插画进入 AR，或不使用相机直接进入 VR 纸偶场景。

**GitHub Pages**：https://catonthehorizon.github.io/blackbird-ar/

## v30 · 背景音乐

- AR/VR 共用一套背景音乐控制，使用用户提供的 Paul McCartney《Bye Bye Blackbird》录音副本：`assets/audio/bye-bye-blackbird.mp3`，约 10.8 MB、4:25、320 kbps。用户已明确批准此副本随公开 GitHub Pages 托管；不是私密或仅本机播放。未从网上下载音乐，原件不修改，发布副本不重采样。
- 首屏音频使用 `preload="none"`，不主动下载音乐；手动点击进入 AR/VR 时尝试以 `0.35` 音量循环播放。浏览器可能拦截自动播放，届时需点音乐按钮；直接通过 `?mode=vr&v=30` 打开 VR 也需主动点音乐。
- 场景中常驻播放/暂停按钮；页面进入后台暂停音乐，返回首页或启动失败停止音乐。iOS 可能由系统控制媒体音量，网页设置的 `0.35` 不保证生效，请用设备音量键调整。
- 页面 `ART_VERSION` 与贴片 metadata 均为 `30`，metadata、WebP 和音频请求使用 `?v=30`。沿用 v29 运行时优化、v28 十张贴片及原识别目标，不修改 PNG/WebP 或 target 文件内容。

## 保留的 v29 优化

- AR 场景使用对齐到 1745×1280 逻辑画布的底板；VR 保留天空背景。24 个星点合并为一个 `InstancedMesh`，以单个 draw call 绘制。
- 移动端渲染像素比上限为 1.5，并可依据帧耗时逐级降至 1；这是自适应策略，不代表已实测帧率提升。
- 摄像头优先请求 720p/30fps，设备不支持时兼容回退并复用单路视频流；VR 环视按帧时间做阻尼，动画按实际可见时间推进，退出时清理资源。
- 保留 metadata/WebP 版本校验和请求缓存键，避免新页面混用浏览器缓存中的旧贴片；当前版本已升为 v30。生产页面不包含本地“只看长椅 / 鸟抬起”检查控件。
- v29 只调整运行时；v30 继续沿用 v28 的十张贴片，不改其 PNG/WebP 内容。`target.jpg`、`target-1024.jpg`、`target.mind` 也保持不变；旧版可从 Git 历史回滚，本地另保留 `preview-v27/v26-backup/`。

本地文件修改、Git 提交、推送成功、Pages 实际更新是不同阶段。发布必须等线上页面版本、metadata、十张 WebP、识别目标文件及 MP3 与提交内容逐项一致，且音频返回 `audio/mpeg` / `audio/mp3`（允许附带参数）后才算完成，不能用 README 或提交状态代替验证。

## 两种模式

| 模式 | 入口 | 说明 |
|---|---|---|
| AR | 「开始 AR · 对准月历插画」 | 请求摄像头权限，对准原月历插画，识别后播放动画 |
| VR | 「进入 VR · 插画动起来」或 `?mode=vr&v=30` | 无需摄像头，直接观看并拖动环视 |

二维码：`assets/qr.png` 为通用入口，`assets/qr-vr.png` 为 VR 入口。

## 构建和测试

构建入口、环境与隔离输入要求见 [PNG 构建说明](tools/STICKER_PREVIEW.md)。

- `tools/extract_sticker_png.py`：从隔离源 PNG 生成候选，不覆盖生产资产。
- `tools/build_sticker_preview.py`：按当前 runtime 生成带检查控件的候选；音频 URL 改写为指向项目 `assets/audio/` 的相对路径，不另复制或处理音频。
- `tools/package_sticker_release.py`：生成无调试控件的发布暂存目录，复制 `assets/audio/`，拒绝缺失或空 MP3，并校验副本 SHA-256。
- `tools/verify_pages_release.py`：从指定 Git 提交读取预期字节，校验线上页面、metadata、十张 WebP、三个 target 和 MP3；音频必须同时匹配 SHA-256 与 `audio/mpeg` / `audio/mp3` 类型（允许附带参数）。每轮会完整下载约 10.8 MB 的 MP3，默认请求超时 60 秒，可用 `--timeout` 调整；网络错误单项最多尝试 3 次，运行工具时应给足整体等待时间。
- `tools/test_wheel_scene.mjs`：无需浏览器，验证轮轴固定、正面 UV 居中、行驶距离和停车状态。
- `tools/test_mobile_scene.mjs`：27 项 Node 回归，执行真实场景/运行时函数，覆盖底板、星点合批、相机约束回退、画质自适应、计时、暂停恢复和 VR 资源释放；音乐使用替身，浏览器/相机接口为测试替身，不代表真机通过。
- `tools/test_background_music.mjs`：10 项独立音乐控制器回归，执行真实控制器，覆盖拒播、开关、后台恢复、退出和过期异步回调；音频及 DOM 使用测试替身。

```text
node tools/test_wheel_scene.mjs
node tools/test_mobile_scene.mjs
node tools/test_background_music.mjs
```

`tools/extract.py`、`tools/build_birds_from_ora.py` 和 `tools/to_webp.py` 为旧版管线；不要使用它们覆盖新版贴片。源图、候选、放大图和备份都被 .gitignore 排除。

## 验证范围与限制

- 已通过 v29 的 27 项 Node 回归及原车轮测试，并检查本地启动页、手机尺寸布局和隔离的底板舞台构图。浏览器预览未取得可靠的连续帧率样本；DPR 自适应策略不等于已测得手机帧率提升。
- v30 已通过音乐 10 项、场景 27 项与车轮回归。本地浏览器已验证真实 MP3 解码（265.642857 秒）、播放/暂停、点击进入时播放、返回停止和直入 VR 静音；这不等于手机扬声器试听或 iOS 音量策略验证。后台/拒播/异步竞态由 Node 替身测试覆盖；公开 Pages 音频还需发布后核对字节和媒体类型。
- 尚不能据此证明手机相机识别成功、实体印刷对位正确、实际启动耗时或不同设备兼容；这些仍需真机测试。
- 新 PNG 构图和巴士文字仍与原月历不同。v29 的不透明底板遮盖画幅内的静止纸面，但不能修正两套原画的构图差异；边缘遮盖、跟踪对位和实际移动观感仍需真机确认。
- PNG 是扁平拼版，鸟脚/尾与椅边交叠处有局部轮廓和重复木纹重建，不是恢复被遮挡的原始像素。
- 保留模块预载与空闲预热；metadata 版本不匹配时提示刷新，而不是继续混用资产。

## 部署

GitHub Pages 从 `main` 分支根目录发布。通过系统代理使用 HTTPS Git 推送；待线上实际更新后核对启动页显示 **v30**、metadata `version` 为 `30`、十张 WebP、三个识别目标文件和 MP3 的 SHA-256 均与待发布提交一致；MP3 响应 `Content-Type` 必须为 `audio/mpeg` / `audio/mp3`（允许附带参数）。手机测试用 `?v=30`，VR 用 `?mode=vr&v=30`。二次校验也会重新下载完整 MP3，请预留流量和时间。本地修改、提交或推送都不等同于 Pages 已完成更新。
