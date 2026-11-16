# 黑鸟面包巴士 · 月历 AR/VR 彩蛋

2026 伊坂幸太郎月历的隐藏彩蛋：手机对准月历插画进入 AR，或不使用相机直接进入 VR 纸偶场景。

**GitHub Pages**：https://catonthehorizon.github.io/blackbird-ar/

## v28

- 采用用户提供的透明 PNG 重建十张贴片，鸟尾、脚与长椅分离；保留已确认的车轮嵌入深度。
- 轮胎侧面/外轮廓固定，仅正面围绕轮毂旋转；转角跟随巴士驶入距离，停车后停止空转。
- 页面及贴片 metadata 使用版本 28；所有 metadata/WebP 请求带 `?v=28`，避免新页面混用浏览器缓存中的旧贴片。
- 生产页面不包含本地的“只看长椅 / 鸟抬起”检查控件。
- 原 `target.jpg`、`target-1024.jpg`、`target.mind` 保持不变；旧版可从 Git 历史回滚，本地另保留 `preview-v27/v26-backup/`。

本地文件修改、Git 提交、推送成功、Pages 实际更新是不同阶段。发布必须等线上页面版本、metadata 和十张 WebP 与本地逐项一致后才算完成，不能用 README 或提交状态代替验证。

## 两种模式

| 模式 | 入口 | 说明 |
|---|---|---|
| AR | 「开始 AR · 对准月历插画」 | 请求摄像头权限，对准原月历插画，识别后播放动画 |
| VR | 「进入 VR · 插画动起来」或 `?mode=vr&v=28` | 无需摄像头，直接观看并拖动环视 |

二维码：`assets/qr.png` 为通用入口，`assets/qr-vr.png` 为 VR 入口。

## 构建和测试

构建入口、环境与隔离输入要求见 [PNG 构建说明](tools/STICKER_PREVIEW.md)。

- `tools/extract_sticker_png.py`：从隔离源 PNG 生成候选，不覆盖生产资产。
- `tools/build_sticker_preview.py`：按当前 runtime 生成带检查控件的候选。
- `tools/package_sticker_release.py`：生成无调试控件的发布暂存目录。
- `tools/test_wheel_scene.mjs`：无需浏览器，验证轮轴固定、正面 UV 居中、行驶距离和停车状态。

```text
node tools/test_wheel_scene.mjs
```

`tools/extract.py`、`tools/build_birds_from_ora.py` 和 `tools/to_webp.py` 为旧版管线；不要使用它们覆盖新版贴片。源图、候选、放大图和备份都被 .gitignore 排除。

## 已验证与限制

- 已完成透明边缘、静止长椅与仅鸟上移的本地合成检查。
- 已检查本地 VR 及 AR 按钮反馈；这不等于手机相机识别、印刷对位或真机启动耗时测试。
- 新 PNG 构图和巴士文字与原月历不同。透明贴片不会擦掉纸面原图，AR 仍可能出现原图透出、重影或比例错位。
- PNG 是扁平拼版，鸟脚/尾与椅边交叠处有局部轮廓和重复木纹重建，不是恢复被遮挡的原始像素。
- 保留模块预载与空闲预热；metadata 版本不匹配时提示刷新，而不是继续混用资产。

## 部署

GitHub Pages 从 `main` 分支根目录发布。通过系统代理使用 HTTPS Git 推送，待线上实际更新后检查：启动页显示 **v28**、metadata `version` 为 `28`，十张 WebP SHA-256 与生产目录一致。手机测试用 `?v=28`，VR 用 `?mode=vr&v=28`。
