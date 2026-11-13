# 黑鸟面包巴士 · 月历 AR/VR 彩蛋

2026 伊坂幸太郎月历的隐藏彩蛋。手机打开网页后，可以对着月历插画扫描出 AR 动画，也可以直接进入 VR 环视场景。

**线上地址**：https://catonthehorizon.github.io/blackbird-ar/

## 两种模式

| 模式 | 入口 | 说明 |
|---|---|---|
| AR | 「开始 AR · 对准月历插画」 | 授权摄像头 → 对准月历上的 BYE BYE BLACKBIRD 插画 → MindAR 识别后播放驶入动画 |
| VR | 「进入 VR · 插画动起来」或扫码 `?mode=vr` | 不需要摄像头，直接环视立体纸偶场景 |

二维码文件：`assets/qr.png`（通用入口）、`assets/qr-vr.png`（直达 VR）。

## 文件结构

```
index.html                  单页应用（AR/VR 共用同一套贴片场景）
assets/target.jpg           原始插画（识别目标 + 抠图源图）
assets/target-1024.jpg      编译识别目标前缩到 1024px 的版本
assets/target.mind          MindAR 图像识别数据
assets/sprites/*.webp       抠好的透明贴片（网页实际加载的版本）
assets/sprites/meta.json    贴片矩形、车轮坐标、天空色标
lib/                        three.js + MindAR（本地化，不依赖 CDN）
tools/extract.py            从 target.jpg 抠图并生成贴片/长椅/站牌/车轮
tools/to_webp.py            PNG → WebP（保留 alpha）
```

## 重新生成贴片

修改 `tools/extract.py` 后按顺序跑：

```bash
python tools/extract.py
python tools/to_webp.py
```

然后刷新页面。贴片坐标写在 `assets/sprites/meta.json`，`index.html` 会按它摆位。

## 已知注意点

- `assets/target.mind` 是按 1024px 的目标图编译的；**印刷定稿后如果图案有改动，需要重新编译**（MindAR 编译器对图案特征敏感）。
- 鸟尾/脚采用「按列垂直墨迹连通段」提取：垂直段能穿过长椅横线把尾巴整段带回鸟贴片，长椅上的尾巴残留由按行拷贝木纹补齐。不要再改回“整行清除长椅线”的写法，否则尾巴又会被横切。
- 网页在打开 1.2 秒后会空闲预热 three + MindAR，并在 `modulepreload` 里预取引擎文件；这样点「开始 AR」时不用再等 3.8MB 下载。改动加载逻辑时保留这个预热，否则按钮响应会明显变慢。
- 目前已知的小瑕疵：bird6 横幅上方会带出一小片奶油色天空纹理（原画天空和卷轴颜色太接近，抠图时难以完全分离），实际尺寸下不明显。

## 部署

GitHub Pages，`main` 分支根目录。版本号显示在启动页底部（当前 `v25`）；手机测试时如果看到的不是最新版本，强制刷新或加 `?v=25`。
