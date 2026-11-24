# Git Extensions 图标

图标定位：**Git 提交图 + 扩展节点**（暗色主题）。

- 深海军蓝圆角底：适配深色任务栏，以浅色提交图保持高对比；
- 冰白提交图：主干在下方汇合后分叉为左右两条分支，直接表达 Git 历史与分支；
- 青色分支：突出从主干扩展出来的 feature branch；
- 橙色圆角菱形：作为分支末端的「扩展节点」，与圆形 commit 节点区分，同时呼应 Extensions 名称；
- 蓝色外缘：深色背景下仍能从任务栏 / 资源管理器中分离。

## 文件

- `git-extensions.svg`：可编辑矢量源，512 × 512 viewBox；无字体、脚本或外部依赖。
- `git-extensions-1024.png`：大尺寸主图与复用源。
- `git-extensions-{512,256,128,64,48,32,16}.png`：常用尺寸。
- `git-extensions.ico`：Windows 多尺寸图标，含 16、24、32、48、64、128、256 px 七个 32 位 RGBA PNG 帧；24 px 帧仅内嵌于 ICO。
- `git-extensions.icns`：macOS 图标，含 128、256、512、1024 px PNG 帧。
- `_build.py`：从 SVG 重新生成全部 PNG / ICO / ICNS，并复制到 `src-tauri/icons/`。

## 配色

- 圆角底：`#25354d` → `#111a29` → `#070c14` 深海军蓝渐变；外描边 `#38bdf8`（65% 不透明度），内描边 `#ffffff`（10%）。
- 主干与左侧分支：`#e6f0ff` 冰白。
- 右侧分支：`#2563eb` → `#22b8e6` → `#67e8f9` 蓝到青渐变。
- 扩展节点：`#fbbf24` → `#f97316` 琥珀到橙色渐变，中心点为 `#fff7e6`。

## 编辑与导出

- 本目录的 SVG 是唯一图形源；改完矢量后执行：

```bash
python docs/icons/_build.py
```

- 脚本用无头 Microsoft Edge 渲染 SVG（2048 × 2048），抠除洋红背景后按目标尺寸独立缩放，不逐级缩图。
- 需要 Python 3 + Pillow + NumPy，以及本机 Microsoft Edge；找不到 Edge 时用 `GITEXT_EDGE` 指向 `msedge.exe`。
- 生成后会替换 `src-tauri/icons/` 下的 `32x32.png`、`64x64.png`、`128x128.png`、`128x128@2x.png`、`icon.png`、`icon.ico`、`icon.icns`，并同步刷新 Windows Store 尺寸的 `Square*Logo.png` 与 `StoreLogo.png`。
- `.png` / `.ico` / `.icns` 是普通二进制文件（`.gitattributes` 已标记 `binary`），不要改成 Git LFS 指针；提交前确认 `src-tauri/icons/` 与 `docs/icons/` 的输出一致。
