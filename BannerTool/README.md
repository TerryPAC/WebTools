# BannerTool — Live Skia Banner Preview

在浏览器中编辑、预览并同步 Skia 风格的 banner JSON。面向 Galaxy S8（`s8`）配置，并自动派生 `ipad` 与 `normal` 变体。所有处理均在本地完成，不上传服务器。

## 功能

- **三栏布局**：完整 JSON（源数据）· S8 编辑（生效区）· 实时 CanvasKit 预览
- **实时渲染**：编辑中间栏 S8 数组后自动防抖预览（约 300ms）
- **一键同步**：点击 **Update** 将 S8 写回完整 JSON，并生成 `ipad`（与 S8 相同）与 `normal`（按 0.8 比例缩放尺寸）
- **字体支持**：从 `fonts/` 加载 JSON 中引用的 `.ttf` / `.otf` 文件
- **复制导出**：左侧完整 JSON 面板支持一键复制

## 使用方法

1. 在浏览器中打开 `index.html`（或通过 [GitHub Pages](#部署) 访问）
2. 等待 CanvasKit 初始化完成
3. 将完整 `banner.json` 粘贴到左侧 **完整 JSON** 区域（需包含 `s8`、`ipad`、`normal` 等字段）
4. 左侧解析后，中间 **S8 编辑** 栏会同步 `s8` 数组；在此修改文案、样式、间距等
5. 右侧预览区实时显示 S8 效果（逻辑分辨率 1440×2960，预览缩放为 360dp 宽）
6. 确认无误后点击 **Update**，更新左侧完整 JSON 中的 `s8` / `ipad` / `normal`
7. 使用复制按钮导出最终 JSON

## JSON 说明

完整配置通常为对象，包含：

| 字段 | 说明 |
|------|------|
| `s8` | Galaxy S8 横幅条目数组（主编辑目标） |
| `ipad` | iPad 配置；Update 时与 `s8` 保持一致 |
| `normal` | 普通屏配置；由 `s8` 按 `SCALE_TO_NORMAL`（0.8）自动缩放 `top_margin`、`size`、`line_height`、`width` 等 |
| `background` | 可选，如 `{ "color": "#ffffff" }`，用于预览背景色 |

中间栏接受 **JSON 数组**（即 `s8` 内容），或含 `s8` 键的对象。

### 条目类型示例

**文本**（`type: "text"`）：

```json
{
  "type": "text",
  "content": "标题文字",
  "font": "Montserrat-Bold.ttf",
  "size": 48,
  "color": "#333333",
  "line_height": 56,
  "spacing": 0,
  "lines": 2,
  "top_margin": 24,
  "parts": []
}
```

**分隔线**（`type: "line"`）：

```json
{
  "type": "line",
  "width": 200,
  "height": 1,
  "color": "#cccccc",
  "top_margin": 16
}
```

富文本可通过 `parts` 与 `text_range` 对 `content` 分段设置字体、颜色、字号。

## 项目结构

```
BannerTool/
├── index.html      # 单页应用（UI + 逻辑 + 渲染）
├── fonts/          #  bundled 字体（与 JSON 中 font 字段文件名对应）
└── README.md
```

## 技术栈

- HTML5 / CSS3 / Vanilla JavaScript
- [CanvasKit WASM](https://skia.org/docs/user/modules/canvaskit/) 0.39.1（Skia 段落排版与绘制）
- 本地 `fonts/` + `FontMgr.FromData` 加载字体


## 相关

- [WebTools 首页](../) — 工具导航
- [IconTool](../IconTool/) — 图片取色与颜色替换
