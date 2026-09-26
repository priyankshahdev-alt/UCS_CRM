import { useState, useEffect, useMemo } from 'react'
import { isImageMime, humanFileSize } from './chatIdentity'
import { DownloadIcon, FileIcon, CloseIcon } from './chatIcons'

/** Image opens in a lightbox; everything else downloads. PDFs never preview. */
export default function MessageAttachment({ attachment }) {
  const [lightbox, setLightbox] = useState(false)
  if (!attachment) return null

  const canPreview =
    isImageMime(attachment.mime) && attachment.url && attachment.url !== '#'

  if (canPreview) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox(true)}
          style={{
            appearance: 'none',
            border: 0,
            padding: 0,
            background: 'transparent',
            cursor: 'zoom-in',
            display: 'block',
            maxWidth: '100%',
            lineHeight: 0,
          }}
          aria-label={`Open image ${attachment.name} full size`}
        >
          <img className="chat-att-image" src={attachment.url} alt={attachment.name} loading="lazy" />
        </button>
        {lightbox && <Lightbox attachment={attachment} onClose={() => setLightbox(false)} />}
      </>
    )
  }

  return (
    <a
      className="chat-att-file"
      href={attachment.url && attachment.url !== '#' ? attachment.url : '#'}
      download={attachment.name}
      onClick={(e) => {
        if (!attachment.url || attachment.url === '#') e.preventDefault()
      }}
      title={attachment.name}
    >
      <span className="chat-att-file-icon">
        <FileIcon size={20} />
      </span>
      <span className="chat-att-file-body">
        <span className="chat-att-file-name">{attachment.name}</span>
        <span className="chat-att-file-size">{humanFileSize(attachment.size)}</span>
      </span>
      <DownloadIcon size={16} />
    </a>
  )
}

function Lightbox({ attachment, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      className="chat-overlay"
      onClick={onClose}
      style={{ background: 'rgba(15,23,42,.88)' }}
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
    >
      <button
        type="button"
        className="chat-iconbtn"
        onClick={onClose}
        aria-label="Close image preview"
        style={{ position: 'absolute', top: 12, right: 12, color: '#fff', background: 'rgba(255,255,255,.12)' }}
      >
        <CloseIcon size={20} />
      </button>
      <img
        src={attachment.url}
        alt={attachment.name}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '92vw', maxHeight: '88dvh', borderRadius: 12, objectFit: 'contain' }}
      />
    </div>
  )
}

/**
 * The chosen-but-unsent file in the composer. Validation feedback is shown here
 * rather than as a toast — it stays pinned to the file the user is looking at.
 */
export function AttachmentDraft({ file, error, onRemove }) {
  const previewable = isImageMime(file?.type)
  // Built once per file, not once per render — an object URL per render leaks.
  const url = useMemo(
    () => (previewable ? URL.createObjectURL(file) : null),
    [file, previewable]
  )

  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  return (
    <div className="chat-attach-preview">
      {previewable ? (
        <img className="chat-attach-thumb" src={url} alt="" />
      ) : (
        <span className="chat-attach-thumb-icon">
          <FileIcon size={22} />
        </span>
      )}
      <span className="chat-attach-meta">
        <span className="chat-attach-name">{file.name}</span>
        <span className="chat-attach-sub" data-error={error ? 'true' : 'false'}>
          {error || humanFileSize(file.size)}
        </span>
      </span>
      <button
        type="button"
        className="chat-iconbtn"
        onClick={onRemove}
        aria-label={`Remove attachment ${file.name}`}
        title="Remove"
      >
        <CloseIcon size={18} />
      </button>
    </div>
  )
}
