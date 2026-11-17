# PNG 贴片构建与 v33 预览说明

v33 的视觉源仍是用户提供的 1536×1024 透明 PNG。它是扁平拼版，不是可逐像素拆分的源文件；鸟脚/尾与长椅相接处有绘制遮挡，因此局部轮廓和木板属于受限重建，不能声称恢复了被遮挡的原始像素。

## 先分清当前动画与历史预览

- 当前 v33 的巴士在画幅内**从左向右匀速循环**：整车驶出右侧后从左侧重新进入；车轮转角连续累计，回环时不归零。
- 旧候选或历史停车预览里的“驶入后停住”只用于回看旧版本，不能作为 v33 动画验收依据。`preview-v27/` 中既有历史候选和备份不代表当前运行时；新建的 `v33-check/` 是独立候选预览。
- 不要运行旧版 `tools/extract.py`、`tools/build_birds_from_ora.py` 或 `tools/to_webp.py` 来覆盖新版贴片。当前候选入口仍是 `extract_sticker_png.py` 及其专用细化脚本；它们只能写入新的、独立的候选目录，不能写生产 `assets/`。

## 文件与运行环境

使用 Python 3.10（环境应包含 Pillow、NumPy、OpenCV、SciPy）。读取不可信下载图像时使用 `-I`；源图片单独放进新建空输入目录，维护脚本在项目 `tools/`，生成物放到项目之外的新目录，不能在输入目录中执行解释器。

- `extract_sticker_png.py`：当前候选入口；拒绝已存在的输出目录及写入生产 assets 目录。
- `extract_sticker_static.py`：生成巴士、完整站牌和按轮毂居中、为旋转留出透明 padding 的两个轮子。
- `refine_bird_candidates.py`：生成五个鸟组；`bird4` 保留成鸟和小鸟为一组，并输出接触带不确定性掩膜。
- `refine_bench_candidate.py`：生成无鸟底板的长椅候选，保留两处金属支撑。
- `build_sticker_preview.py`：把十张 PNG/WebP 和 1745×1280 场景坐标组装成独立候选，并生成带检查控件的本地 HTML。它使用当前项目 runtime，不复制或重编识别目标。
- `package_sticker_release.py`：从候选生成无调试控件的发布暂存目录，并复制完整 `lib/`。
- `verify_pages_release.py`：按指定提交读取预期字节，线上校验入口、metadata、十张 WebP、三个识别目标、MP3，以及 `lib/bus-motion.mjs`。v33 共校验 17 项；MP3 的 Content-Type 须为 `audio/mpeg` / `audio/mp3`，运行时模块须为 `text/javascript` / `application/javascript`，允许附带参数。相同 SHA-256 但错误的 `text/plain` 响应仍视为失败。

从项目目录之外或项目根目录执行候选入口，例如：

```text
C:\Users\amst\AppData\Local\Programs\Python\Python310\python.exe -I C:\Users\amst\blackbird-ar\tools\extract_sticker_png.py --source <独立输入目录>\sticker.png --out <新的候选输出目录>
```

再用 `build_sticker_preview.py` 的 `--project`、`--static`、`--birds`、`--bench` 和 `--out` 参数生成预览。`--out` 必须是不存在的新目录；预览会通过相对路径复用项目的 `lib/`、音频和原 `target.mind`，不会把候选识别目标混进生产目录。

预览中的 `checks/` 包含白、黑、天空、棋盘格全景、鸟上移 55px 和仅长椅合成图；本地页面仍提供“正常动画 / 只看长椅 / 鸟抬起 55px”控件。这些控件只检查合成构图和本地首帧反馈，不是手机 AR 验收。

## 坐标与素材约束

- 运行时继续使用 1745×1280 逻辑平面，显式映射源坐标，不把 1536×1024 素材表直接当目标平面。
- 鸟、椅、站牌：`target = (60,220) + 1.025 × source`；巴士：`target = (53,238) + 1.16 × source`。
- 轮子在巴士映射前移动源坐标 `(+20,-40)`，使其进一步嵌入车身；PNG 左轮为 `wheel0`，右轮为 `wheel1`。轮毂源坐标约为 `(227,491)` / `(653,491)`，不是外框中心。
- 巴士外壳不随整张贴片旋转；轮毂正面独立旋转，v33 的回环运动由 `lib/bus-motion.mjs` 提供几何边界、恒速位置和累计轮角。
- 站牌 pivot 从 metadata 读取；新画面是重建构图，不是印刷原图的逐像素配准。源站牌最顶端细尖已到源图边缘，不应假称恢复了边缘之外的图案。

## v33 运行时边界

- `build_sticker_preview.py` 会改写所有字面量 `./lib/` 相对引用，包括 import map 和 `./lib/bus-motion.mjs` 这类 module import，使候选预览复用当前项目的 runtime；它不会悄悄使用候选目录内的旧模块。
- AR 的高清相机预览保持原路径；识别使用独立、固定尺寸、最长边不超过 800px 的等比例画布。支持 `requestVideoFrameCallback` 时随新相机帧刷新，否则复用已有 `renderAR` 调用 `refresh()`；不另开抽帧动画循环，也不包装 MindAR 内的 `inputLoader`。
- 页面使用固定版本的 MindARThree；`MindARThree._startVideo` 接入 `createTrackingInput`，并向 MindAR 提供 `videoWidth` / `videoHeight`。正方形视频、无 2D context 或无法安全保持精确比例时，按条件回退原始视频；在已有查询串后追加 `&tracking=full` 可显式选择原始输入作对比。识别数据留在浏览器和本地资源中，不上传。
- 跟踪锚点与 `visualRoot` 为同级节点，姿态在渲染帧按时间平滑并保持正交变换；丢失目标或页面进入后台时隐藏、清屏并重置，回前台等待新的跟踪更新。这里的本地预览不能替代真机对位和延迟测量。
- AR 图层深度已调整：巴士 z=`0.005`、站牌 z=`0.015`、长椅 z=`0.035`、鸟沿各自原 z 值加 `0.02`；不透明底板的纸面深度不变。VR 仍是纸偶式平面场景，不是真 3D 模型。
- AR 不透明底板覆盖识别画幅内的原印刷图案，但不能校正新旧原画的构图差异，也遮不住识别画幅之外的印刷内容；实际印刷对位仍须真机确认。`assets/target.jpg`、`target-1024.jpg`、`target.mind` 不由贴片构建改写；构建 manifest 记录它们的 SHA-256。

## 版本与验收

v33 要求页面 `ART_VERSION`、`assets/sprites/meta.json` 的 `version` 和音频/贴片请求的 `?v=33` 统一。正式发布校验以待发布提交为基准抓取线上字节，逐项核对 17 项；候选预览构建与 Pages 发布校验是不同阶段。本地文件修改、提交或推送均不等于 Pages 已更新。

Python 语法、帮助信息和轻量预览集成检查可在项目外执行；它们只能证明脚本能解析、参数契约和 HTML 改写/资源引用成立，不能证明手机摄像头、识别、印刷对位、音频解码或移动端帧率。
