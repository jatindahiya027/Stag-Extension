# stag — Firefox Extension

Drag any image on any webpage to download it in the **highest resolution available**.

---

## Installation (Load Unpacked)

1. Open Chrome and go to `about:addons`
2. Click the gear icon → **Debug Add-ons** → or go to `about:debugging`
3. Click **"Load Temporary Add-on"**
4. Select any file inside the `stag-firefox` folder (e.g. `manifest.json`)
5. The extension is now active on all tabs ✦

---

## How to Use

1. **Find any image** on any webpage
2. **Start dragging it** — a glowing download dock appears at the bottom of the screen
3. **Drop the image onto the dock** — it downloads automatically in the highest resolution found
4. The dock disappears after download (or press ✕ to dismiss)

---

## Resolution Detection Strategies

The extension uses **6 strategies** to find the highest resolution:

| Strategy | What it does |
|----------|-------------|
| **Srcset parsing** | Reads all `srcset` candidates, picks the largest width descriptor |
| **Data attributes** | Scans `data-src`, `data-full`, `data-zoom-src`, `data-original`, `data-hires`, and 10+ more |
| **Parent anchor** | If the image is wrapped in `<a href="full.jpg">`, uses the link target |
| **`<picture>` element** | Reads all `<source>` elements, picks largest srcset |
| **URL pattern upscaling** | Transforms CDN URLs (WordPress, Shopify, Cloudinary, Imgix, Unsplash) to get full resolution |
| **Modal/lightbox detection** | Watches for DOM changes after drag — if a lightbox opens with a larger image, downloads that |

---

## Supported Formats

- **JPEG / PNG / GIF / WebP / AVIF / BMP / TIFF** — downloaded directly
- **SVG** — serialized and saved as `.svg`
- **Base64 data URIs** (`data:image/...`) — decoded and saved with correct extension
- **Blob URLs** (`blob:https://...`) — handled natively
- **Canvas elements** — exported as PNG

---

## CDN URL Upscaling

| CDN | Transformation |
|-----|----------------|
| WordPress | Removes `-300x200` thumbnail suffix |
| Shopify | Changes `_200x.jpg` → `_2048x.jpg` |
| Cloudinary | Changes `w_200,h_200` → `w_2000,h_2000` |
| Imgix | Removes `w`, `h`, `fit`, `crop` params |
| Unsplash | Changes `?w=400` → `?w=3000` |

---

## Files

```
stag/
├── manifest.json      — Extension configuration (Manifest V2)
├── content.js         — Injected into every page; drag detection + resolution resolver
├── background.js      — Background script; handles all browser.downloads API calls
├── popup.html         — Extension popup UI
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

---

## Permissions Used

| Permission | Reason |
|-----------|--------|
| `downloads` | Trigger file downloads via Chrome's download API |
| `activeTab` | Access the current tab's content |
| `scripting` | Inject content scripts |
| `<all_urls>` | Work on any website |

---

## Troubleshooting

**Image won't download?**
- Some sites use CORS restrictions. The extension will still attempt the download; if blocked, try right-clicking and saving directly.

**Getting a low-res image?**
- Try clicking the image first to open the lightbox/full view, then drag from there. The mutation observer will detect the full-res image.

**Extension not appearing?**
- Refresh the tab after installing. Content scripts inject on page load.
