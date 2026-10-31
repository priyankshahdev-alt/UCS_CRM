import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import EventPosterReport from './EventPosterReport.jsx'

/* Preload every image the poster will paint, so no collage slot is captured
   blank. Failures resolve too: a missing logo must not block the download. */
async function preloadImages(urls) {
  await Promise.all((urls || []).filter(Boolean).map(u => new Promise(resolve => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => resolve(); im.onerror = () => resolve()
    im.src = u
  })))
}

async function capturePoster(el, photoUrls = []) {
  if (!el) throw new Error('Poster is not ready yet.')
  const { default: html2canvas } = await import('html2canvas')
  await preloadImages(photoUrls)
  await (document.fonts && document.fonts.ready)
  return await html2canvas(el, { scale: 3, useCORS: true, backgroundColor: '#ffffff', logging: false, imageTimeout: 15000 })
}

/* One-page A4 PDF of the event poster (EventPosterReport). The poster is a fixed
   794×1123 px node, so it is captured whole and placed edge to edge — no page
   slicing. Photos are preloaded first so no collage slot is captured blank. */
export async function exportPosterToPdf(el, filename, photoUrls = []) {
  const { default: jsPDF } = await import('jspdf')
  const canvas = await capturePoster(el, photoUrls)
  const pdf = new jsPDF('p', 'mm', 'a4')
  pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, 210, 297)
  pdf.save(filename)
}

/* Render the poster from props off-screen and return its canvas. Used by screens
   that hold the event data but have no poster in the DOM (the Monthly Planner's
   create/download actions, and the planner-event cards in Reports). The host is
   mounted off-screen, captured, then unmounted so nothing is left behind. */
export async function renderPosterCanvas(props) {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.pointerEvents = 'none'
  document.body.appendChild(host)
  let node = null
  const root = createRoot(host)
  try {
    flushSync(() => {
      root.render(<EventPosterReport {...props} ref={(el) => { node = el }} />)
    })
    return await capturePoster(node || host.firstElementChild, [
      ...(props.photos || []), props.logoUrl, props.sevakBanoImage, props.brandImage,
    ])
  } finally {
    root.unmount()
    host.remove()
  }
}

/* Render the poster from props off-screen and download it as a one-page PDF. */
export async function renderPosterToPdf(props, filename) {
  const { default: jsPDF } = await import('jspdf')
  const canvas = await renderPosterCanvas(props)
  const pdf = new jsPDF('p', 'mm', 'a4')
  pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, 210, 297)
  pdf.save(filename)
}
