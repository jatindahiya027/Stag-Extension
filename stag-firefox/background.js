// background.js — stag (Firefox)
// Firefox MV2 background script — uses browser.* API
// FileReader IS available here (unlike Chrome MV3 service workers)

const BRIDGE_PORT = 57432
const BRIDGE_URL  = `http://127.0.0.1:${BRIDGE_PORT}/imagegrab`

// Support both browser.* (Firefox native) and chrome.* (polyfill)
const ext = typeof browser !== 'undefined' ? browser : chrome

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message.data, sendResponse)
    return true // Keep channel open for async response
  }
})

async function handleDownload({ url, filename }) {
  const safeFilename = sanitizeFilename(filename || generateFilenameFromURL(url))

  // ── Try bridge first (sends image directly to the desktop app) ────────────
  let bridgeOk = false
  try {
    let dataUrl = url
    if (url.startsWith('https://') || url.startsWith('http://')) {
      const resp = await fetch(url)
      const blob = await resp.blob()
      dataUrl = await blobToDataURL(blob)
    }

    const resp = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: safeFilename, dataUrl }),
      signal: AbortSignal.timeout(8000),
    })
    if (resp.ok) {
      bridgeOk = true
      console.log('[stag] Sent to app bridge ✓')
    }
  } catch (e) {
    console.log('[stag] Bridge unavailable, using normal download:', e.message)
  }

  // ── Trigger browser download ───────────────────────────────────────────────
  try {
    await triggerDownload(url, safeFilename)
  } catch (err) {
    console.error('[stag] Download error:', err)
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function triggerDownload(url, filename) {
  return new Promise((resolve, reject) => {
    ext.downloads.download(
      { url, filename, saveAs: false },
      (downloadId) => {
        if (ext.runtime.lastError) reject(ext.runtime.lastError)
        else resolve(downloadId)
      }
    )
  })
}

function generateFilenameFromURL(url) {
  if (!url) return `stag_${Date.now()}.jpg`
  if (url.startsWith('data:')) {
    const m = url.match(/data:image\/(\w+)/)
    const ext = (m?.[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
    return `stag_${Date.now()}.${ext}`
  }
  try {
    const u = new URL(url)
    const imgParam = u.searchParams.get('imgurl') || u.searchParams.get('url')
    if (imgParam) {
      try {
        const inner = new URL(imgParam)
        const last = decodeURIComponent(inner.pathname.split('/').pop()).split('?')[0]
        if (last && /\.\w{2,5}$/.test(last)) return last
      } catch(e) {}
    }
    const last = decodeURIComponent(u.pathname.split('/').pop()).split('?')[0]
    if (last && /\.\w{2,5}$/.test(last)) return last
  } catch(e) {}
  return `stag_${Date.now()}.jpg`
}

function sanitizeFilename(name) {
  if (!name) return `stag_${Date.now()}.jpg`
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 200)
}
