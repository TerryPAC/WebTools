# WebTools

A collection of browser-only utilities. All processing happens locally in your browser — nothing is uploaded to a server.

## Tools

### [IconTool](./IconTool/) — Image Color Picker & Replacer

Upload images, pick a color, adjust tolerance, optionally limit the area with a rectangle, and replace matched pixels with a new color. Supports PNG, JPG, WebP, and more.

### [BannerTool](./BannerTool/) — Live Skia Banner Preview

Edit and preview Skia-style banner JSON for Galaxy S8 (and related `normal` / `ipad` configs). Paste or edit JSON, tweak the S8 section, and see a live CanvasKit render with bundled fonts.

## Project layout

```
/ (root)
├── index.html          # Landing page
├── README.md
├── IconTool/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── README.md
└── BannerTool/
    ├── index.html
    └── fonts/
```

## Tech stack

- HTML5, CSS3, vanilla JavaScript
- Canvas API (IconTool)
- CanvasKit / Skia (BannerTool)

## Deployment

Hosted on GitHub Pages:

| Page | URL |
|------|-----|
| Home | [https://terrypac.github.io/IconTool/](https://terrypac.github.io/IconTool/) |
| IconTool | [https://terrypac.github.io/IconTool/IconTool/](https://terrypac.github.io/IconTool/IconTool/) |
| BannerTool | [https://terrypac.github.io/IconTool/BannerTool/](https://terrypac.github.io/IconTool/BannerTool/) |

> **Note:** The repository is still named `IconTool`, so paths include `/IconTool/`. Renaming the repo to `WebTools` on GitHub would change the base URL to `https://terrypac.github.io/WebTools/`.
