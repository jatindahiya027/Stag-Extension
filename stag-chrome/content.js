// content.js — stag v4
// Key insight from reference code: use event.dataTransfer.getData('text/html') on DROP
// to get the actual dragged element's HTML including full srcset — this is what makes
// Google Images work. We enrich this with our high-res resolver and Pinterest fiber logic.

(function () {
  'use strict';

  if (window.__imageGrabProLoaded) return;
  window.__imageGrabProLoaded = true;

  // ─── STATE ───────────────────────────────────
  let draggedElementRef = null;   // Reference to the actual DOM element being dragged
  let draggedImageData = null;    // Best URL resolved at dragstart
  let overlay = null;
  let overlayVisible = false;
  let mutationObserver = null;
  let lastMouseX = 0, lastMouseY = 0;

  document.addEventListener('mousemove', (e) => { lastMouseX = e.clientX; lastMouseY = e.clientY; }, true);

  // ─── DRAG START ──────────────────────────────
  // At dragstart we: find the real image element, store a reference,
  // and pre-resolve the best URL. The reference is used at drop time
  // to anchor our search — we never query the document globally.
  document.addEventListener('dragstart', (e) => {
    draggedElementRef = null;
    draggedImageData = null;

    const x = e.clientX || lastMouseX;
    const y = e.clientY || lastMouseY;

    const imageEl = resolveImageElement(e.target, x, y);
    if (!imageEl) return;

    draggedElementRef = imageEl;

    // Pre-resolve from DOM (best effort at dragstart)
    const result = extractBestURLFromDOM(imageEl);
    if (result) draggedImageData = result;

    showOverlay(result);
    watchForFullRes(imageEl);
  }, true);

  document.addEventListener('dragend', () => {
    setTimeout(() => { if (overlayVisible) hideOverlay(); }, 400);
  }, true);

  // ─── FIND THE REAL IMAGE ELEMENT ─────────────
  function resolveImageElement(target, x, y) {
    if (isImgEl(target)) return target;

    // elementsFromPoint gives all stacked elements at cursor
    try {
      for (const el of document.elementsFromPoint(x, y)) {
        if (isImgEl(el)) return el;
      }
    } catch(e) {}

    // Walk UP — find ancestor img or bg-image div
    let el = target;
    for (let i = 0; i < 15 && el && el !== document.body; i++) {
      if (isImgEl(el)) return el;
      if (hasBgImage(el)) return el;
      el = el.parentElement;
    }

    // Walk DOWN — first img descendant
    const childImg = target.querySelector?.('img');
    if (childImg) return childImg;

    // Ancestors' img descendants (for Pinterest-style card wrappers)
    el = target.parentElement;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      const img = el.querySelector('img');
      if (img) return img;
      el = el.parentElement;
    }

    return null;
  }

  function isImgEl(el) {
    const tag = el?.tagName?.toLowerCase();
    return tag === 'img' || tag === 'canvas' || tag === 'svg';
  }

  function hasBgImage(el) {
    try {
      const bg = window.getComputedStyle(el).backgroundImage;
      return bg && bg !== 'none' && bg.includes('url(');
    } catch { return false; }
  }

  // ─── DROP HANDLER ────────────────────────────
  // This is where the reference's key trick lives:
  // dataTransfer.getData('text/html') gives us the full HTML of the dragged element,
  // including all attributes (srcset, data-*, etc.) — even on Google Images.
  // We parse that HTML to extract the highest-res URL, then fall back to our
  // DOM-based resolver if needed.
  async function handleDrop(e) {
    let finalURL = null;
    let finalWidth = null;
    let finalHeight = null;

    // ── Method 1: Parse dragged HTML from dataTransfer (reference code's key insight) ──
    // The browser serializes the actual dragged element's HTML into 'text/html'.
    // This works even on Google Images where the DOM element has full srcset data.
    const draggedHTML = e.dataTransfer?.getData('text/html');
    if (draggedHTML) {
      const fromHTML = extractBestURLFromHTML(draggedHTML);
      if (fromHTML) {
        finalURL = fromHTML.url;
        finalWidth = fromHTML.width;
        finalHeight = fromHTML.height;
      }
    }

    // ── Method 2: Use what we resolved at dragstart from the live DOM element ──
    // The DOM element at dragstart time often has more data than the serialized HTML
    // (e.g. naturalWidth, currentSrc after srcset resolution, React fiber props)
    if (draggedImageData?.url) {
      // Compare: if DOM-resolved URL looks higher-res, prefer it
      const domURL = draggedImageData.url;
      if (!finalURL) {
        finalURL = domURL;
        finalWidth = draggedImageData.width;
        finalHeight = draggedImageData.height;
      } else {
        // Pick whichever looks like higher resolution
        finalURL = pickHigherResURL(finalURL, domURL) || finalURL;
      }
    }

    // ── Method 3: dataTransfer URI list (browser native drag data) ──
    if (!finalURL) {
      for (const type of ['text/uri-list', 'URL']) {
        const val = e.dataTransfer?.getData(type);
        if (val && looksLikeImage(val)) { finalURL = resolveURL(val); break; }
      }
    }

    // ── Method 4: Re-query the live DOM element now at drop time ──
    // The live element may have updated (e.g. lazy load completed) since dragstart
    if (!finalURL && draggedElementRef) {
      const fresh = extractBestURLFromDOM(draggedElementRef);
      if (fresh) { finalURL = fresh.url; finalWidth = fresh.width; finalHeight = fresh.height; }
    }

    if (!finalURL) {
      console.warn('[stag] No image URL found.');
      hideOverlay();
      return;
    }

    // Apply URL upscaling on the final chosen URL
    finalURL = upscaleURL(finalURL);

    const filename = makeFilename(finalURL);
    console.log('[stag] Downloading:', finalURL.substring(0, 120));

    try {
      if (finalURL.startsWith('blob:')) {
        await fetchBlobAndSend(finalURL, filename);
      } else {
        await sendToBackground({ url: finalURL, filename });
      }
      showSuccess();
    } catch(err) {
      console.error('[stag]', err);
      // Last resort: open in tab
      window.open(finalURL, '_blank');
      hideOverlay();
    }

    draggedElementRef = null;
    draggedImageData = null;
  }

  // ─── EXTRACT FROM DRAGGED HTML STRING ────────
  // Parses the 'text/html' from dataTransfer — this is the reference code's approach.
  // The browser includes the full element HTML with all attributes.
  function extractBestURLFromHTML(html) {
    if (!html) return null;

    const temp = document.createElement('div');
    temp.innerHTML = html;
    const img = temp.querySelector('img');

    if (!img) {
      // Maybe it's a background-image div
      const anyEl = temp.firstElementChild;
      if (anyEl) {
        const bg = anyEl.style.backgroundImage || '';
        const bgURL = extractBgURL(bg);
        if (bgURL) return { url: resolveURL(bgURL) };
      }
      return null;
    }

    const candidates = [];

    // srcset — pick highest width descriptor (better than reference which picks last)
    const srcset = img.getAttribute('srcset') || img.srcset || '';
    if (srcset) {
      const best = parseBestSrcset(srcset);
      if (best) candidates.push({ url: resolveURL(best), score: 100 });
    }

    // All data-* attributes
    for (const attr of IMG_DATA_ATTRS) {
      const val = img.getAttribute(attr);
      if (val && looksLikeImage(val)) candidates.push({ url: resolveURL(val), score: 90 });
    }

    // currentSrc / src
    const currentSrc = img.getAttribute('src') || '';
    if (currentSrc) candidates.push({ url: resolveURL(currentSrc), score: 60 });

    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      if (c.url && c.url !== 'about:blank') return { url: c.url };
    }
    return null;
  }

  // ─── EXTRACT FROM LIVE DOM ELEMENT ───────────
  // Only reads from the element and its own ancestor chain — never queries document.
  function extractBestURLFromDOM(el) {
    if (!el) return null;
    const candidates = [];
    const tag = el.tagName?.toLowerCase();

    if (tag === 'img') {
      const srcsetBest = parseBestSrcset(el.srcset);
      if (srcsetBest) candidates.push({ url: resolveURL(srcsetBest), score: 100 });

      for (const attr of IMG_DATA_ATTRS) {
        const val = el.getAttribute(attr);
        if (val && looksLikeImage(val)) candidates.push({ url: resolveURL(val), score: 90 });
      }

      if (el.currentSrc) candidates.push({ url: el.currentSrc, score: 70, w: el.naturalWidth, h: el.naturalHeight });
      if (el.src && el.src !== el.currentSrc) candidates.push({ url: el.src, score: 60, w: el.naturalWidth, h: el.naturalHeight });
    }

    if (tag === 'svg') {
      try {
        const b64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(el))));
        candidates.push({ url: b64, score: 80 });
      } catch(e) {}
    }

    if (tag === 'canvas') {
      try { candidates.push({ url: el.toDataURL('image/png'), score: 80 }); } catch(e) {}
    }

    if (hasBgImage(el)) {
      const bg = extractBgURL(window.getComputedStyle(el).backgroundImage);
      if (bg) candidates.push({ url: resolveURL(bg), score: 65 });
      const ibg = extractBgURL(el.style?.backgroundImage);
      if (ibg) candidates.push({ url: resolveURL(ibg), score: 70 });
    }

    // Walk UP ancestor chain — scoped to this element only
    let ancestor = el.parentElement;
    for (let depth = 0; depth < 20 && ancestor && ancestor !== document.body; depth++) {
      const atag = ancestor.tagName?.toLowerCase();

      if (atag === 'a') {
        const href = ancestor.getAttribute('href');
        if (href && looksLikeImage(href)) candidates.push({ url: resolveURL(href), score: 95 });
      }

      for (const attr of ANCESTOR_DATA_ATTRS) {
        const val = ancestor.getAttribute(attr);
        if (val && looksLikeImage(val)) candidates.push({ url: resolveURL(val), score: 88 - depth });
      }

      if (atag === 'picture') {
        for (const src of ancestor.querySelectorAll('source')) {
          const ss = parseBestSrcset(src.srcset);
          if (ss) candidates.push({ url: resolveURL(ss), score: 98 });
        }
      }

      // React fiber — reads props of THIS specific ancestor node only
      const fiberURL = extractFromFiber(ancestor);
      if (fiberURL) candidates.push({ url: fiberURL, score: 92 - depth });

      ancestor = ancestor.parentElement;
    }

    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      const u = c.url;
      if (!u || u === 'about:blank' || u === window.location.href || u.length < 5) continue;
      return { url: u, width: c.w, height: c.h };
    }
    return null;
  }

  // ─── PICK HIGHER RES URL ─────────────────────
  // Given two URLs, guess which is higher resolution.
  function pickHigherResURL(urlA, urlB) {
    if (!urlA) return urlB;
    if (!urlB) return urlA;

    // If one is a data URI or blob, prefer the other (it's likely a real URL with more info)
    if (urlA.startsWith('data:') && !urlB.startsWith('data:')) return urlB;
    if (urlB.startsWith('data:') && !urlA.startsWith('data:')) return urlA;

    // Pinterest: prefer originals/ over 236x/ 474x/ 736x/
    const pinterestScore = (u) => {
      if (u.includes('/originals/')) return 3;
      if (u.includes('/736x/')) return 2;
      if (u.includes('/474x/')) return 1;
      return 0;
    };
    if (urlA.includes('pinimg.com') || urlB.includes('pinimg.com')) {
      return pinterestScore(urlA) >= pinterestScore(urlB) ? urlA : urlB;
    }

    // Prefer URL with larger size hints in it (e.g. ?w=3000 vs ?w=400)
    const sizeHint = (u) => {
      const m = u.match(/[wh]=(\d+)/);
      return m ? parseInt(m[1]) : 0;
    };
    const sA = sizeHint(urlA), sB = sizeHint(urlB);
    if (sA !== sB) return sA > sB ? urlA : urlB;

    // Prefer longer URL (usually more specific / higher res)
    return urlA.length >= urlB.length ? urlA : urlB;
  }

  // ─── REACT FIBER EXTRACTOR ───────────────────
  // Only walks UP the fiber return chain — reads this node's component props only.
  function extractFromFiber(domNode) {
    try {
      const fiberKey = Object.keys(domNode).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
      if (!fiberKey) return null;

      let fiber = domNode[fiberKey];
      const seen = new Set();

      for (let hops = 0; fiber && hops < 25; hops++) {
        if (seen.has(fiber)) break;
        seen.add(fiber);

        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props) {
          for (const key of Object.keys(props)) {
            const val = props[key];
            if (typeof val === 'string' && val.length > 8 && looksLikeImage(val)) {
              return val.includes('pinimg.com') ? val.replace(/\/\d+x\//, '/originals/') : val;
            }
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              for (const sub of ['url', 'src', 'href', 'imageUrl', 'uri', 'source', 'origUrl']) {
                const s = val[sub];
                if (typeof s === 'string' && looksLikeImage(s)) {
                  return s.includes('pinimg.com') ? s.replace(/\/\d+x\//, '/originals/') : s;
                }
              }
            }
          }
        }
        fiber = fiber.return; // Walk UP only
      }
    } catch(e) {}
    return null;
  }

  // ─── FULL-RES APPEARANCE WATCHER ─────────────
  function watchForFullRes(originalEl) {
    if (mutationObserver) mutationObserver.disconnect();
    const origArea = (originalEl?.naturalWidth || 0) * (originalEl?.naturalHeight || 0);

    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const img = mutation.target;
          if (img.tagName?.toLowerCase() !== 'img' || img === originalEl) continue;
          const area = (img.naturalWidth || 0) * (img.naturalHeight || 0);
          if (area > origArea * 2 && img.currentSrc) {
            draggedImageData = { ...draggedImageData, url: img.currentSrc };
          }
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const imgs = node.querySelectorAll?.('img') || [];
          for (const img of imgs) {
            const area = (img.naturalWidth || img.offsetWidth || 0) * (img.naturalHeight || img.offsetHeight || 0);
            if (area > origArea * 1.5) {
              const newURL = img.currentSrc || img.src;
              if (newURL && !newURL.startsWith('data:')) {
                draggedImageData = { url: newURL };
              }
            }
          }
        }
      }
    });

    mutationObserver.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'srcset']
    });
    setTimeout(() => { mutationObserver?.disconnect(); mutationObserver = null; }, 8000);
  }

  // ─── URL UTILITIES ───────────────────────────
  const IMG_DATA_ATTRS = [
    'data-src', 'data-original', 'data-full', 'data-zoom-src', 'data-large',
    'data-hi-res', 'data-hires', 'data-fullsize', 'data-lazy-src', 'data-url',
    'data-image', 'data-full-url', 'data-orig-file', 'data-orig-src',
    'data-pin-media', 'data-big-photo', 'data-raw-src', 'data-highres', 'data-2x', 'data-retina'
  ];

  const ANCESTOR_DATA_ATTRS = [
    'data-pin-media', 'data-full', 'data-original', 'data-zoom-src', 'data-large',
    'data-hi-res', 'data-orig-file', 'data-big-photo', 'data-src', 'data-image',
    'data-url', 'data-highres', 'data-media-url', 'data-orig-src'
  ];

  function resolveURL(url) {
    if (!url) return null;
    url = url.trim();
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (url.startsWith('//')) return window.location.protocol + url;
    try { new URL(url); return url; } catch(e) {}
    try { return new URL(url, window.location.href).href; } catch(e) {}
    return null;
  }

  function looksLikeImage(url) {
    if (!url || typeof url !== 'string' || url.length < 5) return false;
    if (url.startsWith('data:image/')) return true;
    if (url.startsWith('blob:')) return true;
    if (/\.(jpe?g|png|gif|webp|svg|avif|bmp|tiff?|ico)(\?|#|$)/i.test(url)) return true;
    if (/pinimg\.com|googleusercontent\.com|fbcdn\.net|twimg\.com|imgur\.com|staticflickr\.com/i.test(url)) return true;
    return false;
  }

  function parseBestSrcset(srcset) {
    if (!srcset) return null;
    let best = null, bestSize = 0;
    for (const entry of srcset.split(',').map(s => s.trim()).filter(Boolean)) {
      const parts = entry.split(/\s+/);
      const url = parts[0];
      const desc = parts[1] || '1x';
      // Parse width descriptors (600w) and pixel density (2x) — width preferred
      const size = desc.endsWith('w') ? parseInt(desc) : parseFloat(desc) * 1000;
      if (size > bestSize) { bestSize = size; best = url; }
    }
    return best;
  }

  function extractBgURL(bgImage) {
    if (!bgImage || bgImage === 'none') return null;
    const match = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    return match ? match[1] : null;
  }

  function upscaleURL(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
    let r = url;
    // Pinterest: any /NNNx/ path segment → /originals/
    if (r.includes('pinimg.com')) return r.replace(/\/\d+x\//, '/originals/');
    // WordPress thumbnails: image-300x200.jpg → image.jpg
    r = r.replace(/-\d+x\d+(\.\w{2,5})(\?|$)/, '$1$2');
    // Shopify: _200x.jpg → _2048x.jpg
    r = r.replace(/_(\d+)x(\.\w{2,5})/, (m, n, ext) => parseInt(n) < 1000 ? `_2048x${ext}` : m);
    // Cloudinary: /w_200,h_200/ → /w_2000,h_2000/
    r = r.replace(/\/(w_\d+),(h_\d+)\//, '/w_2000,h_2000/');
    r = r.replace(/\/w_\d+(\/|,)/, '/w_2000$1');
    // Generic ?w=N or &w=N
    r = r.replace(/([?&])w=\d+/, '$1w=3000');
    // Remove common resize params
    try {
      const u = new URL(r);
      let changed = false;
      for (const p of ['w', 'h', 'width', 'height', 'fit', 'resize', 'size', 'thumb', 'sz', 's']) {
        if (u.searchParams.has(p) && !r.includes('pinimg')) { u.searchParams.delete(p); changed = true; }
      }
      if (changed) r = u.toString();
    } catch(e) {}
    return r;
  }

  async function fetchBlobAndSend(blobURL, filename) {
    const resp = await fetch(blobURL);
    const blob = await resp.blob();
    const mime = blob.type || 'image/jpeg';
    const dataURI = await new Promise((res, rej) => {
      const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
    });
    const ext = mime.split('/')[1]?.replace('jpeg','jpg').replace('svg+xml','svg') || 'jpg';
    const name = filename.includes('.') ? filename : `${filename}.${ext}`;
    return sendToBackground({ url: dataURI, filename: name });
  }

  function sendToBackground(data) {
    return new Promise(resolve => chrome.runtime.sendMessage({ action: 'download', data }, resolve));
  }

  function makeFilename(url) {
    if (url.startsWith('data:')) {
      const m = url.match(/data:image\/(\w+)/);
      const ext = (m?.[1] || 'jpg').replace('jpeg','jpg').replace('svg+xml','svg');
      return `stag_${Date.now()}.${ext}`;
    }
    try {
      const u = new URL(url);
      // Google Images encodes the real URL in the ?url= or ?imgurl= query param
      const imgURL = u.searchParams.get('url') || u.searchParams.get('imgurl') || u.searchParams.get('imgrefurl');
      if (imgURL) {
        try {
          const inner = new URL(imgURL);
          const last = decodeURIComponent(inner.pathname.split('/').pop()).split('?')[0];
          if (last && /\.\w{2,5}$/.test(last)) return last.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').substring(0,180);
        } catch(e) {}
      }
      const last = decodeURIComponent(u.pathname.split('/').pop()).split('?')[0];
      if (last && /\.\w{2,5}$/.test(last)) return last.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').substring(0,180);
    } catch(e) {}
    return `stag_${Date.now()}.jpg`;
  }

  // ─── OVERLAY UI ──────────────────────────────
  function injectOverlay() {
    if (document.getElementById('__stag-overlay')) return;

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
      #__stag-overlay {
        position:fixed!important; bottom:-160px!important; left:50%!important;
        transform:translateX(-50%)!important; width:420px!important; height:120px!important;
        z-index:2147483647!important; transition:bottom 0.4s cubic-bezier(0.34,1.56,0.64,1)!important;
        pointer-events:none!important;
      }
      #__stag-overlay.ig-vis { bottom:24px!important; pointer-events:all!important; }
      #__stag-dz {
        width:100%; height:100%; background:rgba(8,8,12,0.94);
        backdrop-filter:blur(24px) saturate(180%); -webkit-backdrop-filter:blur(24px) saturate(180%);
        border-radius:20px; border:1.5px solid rgba(255,255,255,0.1);
        display:flex; align-items:center; justify-content:center; gap:16px;
        position:relative; overflow:hidden;
        box-shadow:0 0 0 1px rgba(255,255,255,0.04),0 20px 60px rgba(0,0,0,0.65),0 0 80px rgba(0,120,255,0.04);
        transition:border-color 0.2s,box-shadow 0.2s,transform 0.15s;
      }
      #__stag-dz::after {
        content:''; position:absolute; top:-50%; left:-50%; width:200%; height:200%;
        background:conic-gradient(from 0deg,transparent 0deg,rgba(0,120,255,0.15) 60deg,transparent 120deg);
        animation:ig-spin 4s linear infinite; opacity:0; transition:opacity 0.3s; border-radius:50%;
      }
      #__stag-dz.ig-hover::after{opacity:1;}
      #__stag-dz.ig-hover{border-color:rgba(0,120,255,0.5);box-shadow:0 0 0 1px rgba(0,120,255,0.2),0 20px 60px rgba(0,0,0,0.7),0 0 40px rgba(0,120,255,0.15),inset 0 0 30px rgba(0,120,255,0.05);transform:scale(1.02);}
      #__stag-dz.ig-done{border-color:rgba(0,120,255,0.8)!important;}
      @keyframes ig-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
      @keyframes ig-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
      @keyframes ig-pop{0%{transform:scale(0.5) rotate(-10deg);opacity:0}60%{transform:scale(1.2) rotate(5deg);opacity:1}100%{transform:scale(1) rotate(0);opacity:1}}
      #__stag-icon{width:48px;height:48px;flex-shrink:0;z-index:1;animation:ig-float 3s ease-in-out infinite;}
      #__stag-texts{display:flex;flex-direction:column;gap:3px;z-index:1;}
      #__stag-title{font-family:'Syne',sans-serif;font-weight:800;font-size:15px;color:#fff;letter-spacing:-0.3px;line-height:1;}
      #__stag-sub{font-family:'DM Mono',monospace;font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:0.5px;text-transform:uppercase;}
      #__stag-dz.ig-hover #__stag-title{color:#4d9fff;}
      #__stag-dz.ig-hover #__stag-sub{color:rgba(0,120,255,0.6);}
      #__stag-badge{position:absolute;top:10px;right:12px;font-family:'DM Mono',monospace;font-size:8px;color:rgba(255,255,255,0.18);letter-spacing:1px;text-transform:uppercase;z-index:1;}
      #__stag-res{position:absolute;bottom:10px;right:12px;font-family:'DM Mono',monospace;font-size:9px;color:rgba(0,120,255,0.5);z-index:1;opacity:0;transition:opacity 0.3s;}
      #__stag-overlay.ig-vis #__stag-res{opacity:1;}
      #__stag-ok{display:none;position:absolute;inset:0;align-items:center;justify-content:center;z-index:2;background:rgba(8,8,12,0.96);border-radius:inherit;flex-direction:column;gap:8px;}
      #__stag-ok.ig-show{display:flex;animation:ig-pop 0.4s cubic-bezier(0.34,1.56,0.64,1);}
      #__stag-ok-icon{font-size:32px;}
      #__stag-ok-label{font-family:'Syne',sans-serif;font-weight:800;font-size:13px;color:#4d9fff;letter-spacing:0.5px;}
      #__stag-close{position:absolute;top:-10px;right:-10px;width:24px;height:24px;border-radius:50%;background:rgba(40,40,50,0.95);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.4);font-size:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:3;transition:background 0.2s,color 0.2s;font-family:sans-serif;line-height:1;}
      #__stag-close:hover{background:rgba(255,60,60,0.85);color:#fff;}
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = '__stag-overlay';
    overlay.innerHTML = `
      <div id="__stag-dz">
        <div id="__stag-close">✕</div>
        <div id="__stag-badge">stag</div>
        <svg id="__stag-icon" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="rgba(0,120,255,0.08)"/>
          <rect x="8" y="10" width="32" height="24" rx="4" stroke="rgba(0,120,255,0.6)" stroke-width="1.5" fill="none"/>
          <circle cx="16" cy="18" r="3" fill="rgba(0,120,255,0.5)"/>
          <path d="M8 28 L16 20 L22 26 L28 20 L40 30" stroke="rgba(0,120,255,0.7)" stroke-width="1.5" stroke-linejoin="round" fill="none"/>
          <path d="M24 38 L24 32 M21 35 L24 38 L27 35" stroke="rgba(0,120,255,0.9)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div id="__stag-texts">
          <div id="__stag-title">Drop to Download</div>
          <div id="__stag-sub">highest resolution</div>
        </div>
        <div id="__stag-res"></div>
        <div id="__stag-ok">
          <div id="__stag-ok-icon">✦</div>
          <div id="__stag-ok-label">Downloaded!</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const dz = overlay.querySelector('#__stag-dz');
    overlay.querySelector('#__stag-close').addEventListener('click', (e) => { e.stopPropagation(); hideOverlay(); });
    dz.addEventListener('dragover', (e) => {
      e.preventDefault(); e.stopPropagation();
      dz.classList.add('ig-hover');
      overlay.querySelector('#__stag-title').textContent = 'Release to Download';
    });
    dz.addEventListener('dragleave', () => {
      dz.classList.remove('ig-hover');
      overlay.querySelector('#__stag-title').textContent = 'Drop to Download';
    });
    dz.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      dz.classList.remove('ig-hover');
      await handleDrop(e);
    });
  }

  function showOverlay(imageData) {
    if (!overlay) injectOverlay();
    overlayVisible = true;
    overlay.classList.add('ig-vis');
    overlay.querySelector('#__stag-ok')?.classList.remove('ig-show');
    overlay.querySelector('#__stag-dz')?.classList.remove('ig-done','ig-hover');
    const title = overlay.querySelector('#__stag-title');
    if (title) title.textContent = 'Drop to Download';
    const res = overlay.querySelector('#__stag-res');
    if (res) res.textContent = (imageData?.width && imageData?.height) ? `${imageData.width}×${imageData.height}` : '';
  }

  function hideOverlay() { overlayVisible = false; overlay?.classList.remove('ig-vis'); }

  function showSuccess() {
    overlay?.querySelector('#__stag-ok')?.classList.add('ig-show');
    overlay?.querySelector('#__stag-dz')?.classList.add('ig-done');
    setTimeout(hideOverlay, 1800);
  }

  // ─── INIT ────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectOverlay);
  } else {
    setTimeout(injectOverlay, 300);
  }

})();
