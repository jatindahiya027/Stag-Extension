// background.js — stag Service Worker
// IMPORTANT: Service workers do NOT have access to:
//   - URL.createObjectURL()
//   - FileReader
//   - fetch() on data: URIs for conversion purposes
// All blob/dataURI conversion happens in content.js before sending here.

const BRIDGE_PORT = 57432
const BRIDGE_URL  = `http://127.0.0.1:${BRIDGE_PORT}/imagegrab`

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message.data, sendResponse)
    return true // Keep channel open for async response
  }
})

async function handleDownload({ url, filename }) {
  const safeFilename = sanitizeFilename(filename || generateFilenameFromURL(url))

  // ── Try bridge first (sends image directly to the desktop app) ────────────
  // The bridge server only runs when the app is open. If it's closed we fall
  // back to the normal chrome.downloads path. Either way the file lands in the
  // app on next launch via the inbox folder scan.
  let bridgeOk = false
  try {
    // Fetch the image as a data URI so the bridge can save it to the inbox.
    // For data: URIs we can use them directly; for https:// we fetch first.
    let dataUrl = url
    if (url.startsWith('https://') || url.startsWith('http://')) {
      const resp = await fetch(url)
      const blob = await resp.blob()
      dataUrl = await blobToDataURL(blob)
    }
    // data: URIs are already in the right format.

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
    // App is closed or bridge is not running — fall through to normal download
    console.log('[stag] Bridge unavailable, using normal download:', e.message)
  }

  // ── Also trigger the normal browser download so the file is saved to disk ──
  // The bridge saves into the app's inbox folder; the chrome.downloads.download
  // saves to the user's Downloads folder. Both happen so the user always gets
  // the file even if the app is uninstalled later.
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
    chrome.downloads.download(
      { url, filename, saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
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
