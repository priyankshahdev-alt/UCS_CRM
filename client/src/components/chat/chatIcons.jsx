/**
 * Inline chat icon set.
 *
 * Deliberately hand-rolled rather than pulled from a library: the chat feature
 * needs a dozen glyphs at specific weights, and the panels already carry four
 * different icon conventions. Keeping them local stops chat's stroke weights
 * from drifting against whichever host panel it lands in.
 */

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const Svg = ({ size = 18, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    {...base}
    {...rest}
  >
    {children}
  </svg>
)

export const SearchIcon = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Svg>
)

export const SendIcon = (p) => (
  <Svg {...p}>
    <path d="M21.5 2.5 11 13" />
    <path d="M21.5 2.5 15 21.5l-4-8.5-8.5-4Z" />
  </Svg>
)

export const PaperclipIcon = (p) => (
  <Svg {...p}>
    <path d="M21 11.5 12.3 20a5.5 5.5 0 0 1-7.8-7.8l8.7-8.7a3.7 3.7 0 0 1 5.2 5.2l-8.7 8.7a1.8 1.8 0 0 1-2.6-2.6l8-8" />
  </Svg>
)

export const CloseIcon = (p) => (
  <Svg {...p}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
)

export const EditIcon = (p) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
)

export const TrashIcon = (p) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </Svg>
)

export const LockIcon = (p) => (
  <Svg {...p}>
    <rect x="4" y="10.5" width="16" height="10" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Svg>
)

export const UsersIcon = (p) => (
  <Svg {...p}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7" r="3.2" />
    <path d="M22 20v-1.5a4 4 0 0 0-3-3.8" />
    <path d="M16 4.2a3.2 3.2 0 0 1 0 5.6" />
  </Svg>
)

export const HashIcon = (p) => (
  <Svg {...p}>
    <path d="M5 9h14" />
    <path d="M5 15h14" />
    <path d="M11 4 9 20" />
    <path d="M16 4l-2 16" />
  </Svg>
)

export const PlusIcon = (p) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
)

export const BackIcon = (p) => (
  <Svg {...p}>
    <path d="M15 5 8 12l7 7" />
  </Svg>
)

export const DownIcon = (p) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="m5 12 7 7 7-7" />
  </Svg>
)

export const FileIcon = (p) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </Svg>
)

export const DownloadIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 20h16" />
  </Svg>
)

export const CheckIcon = (p) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
)

export const AlertIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16h.01" />
  </Svg>
)

export const BellIcon = (p) => (
  <Svg {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
    <path d="M13.7 20a2 2 0 0 1-3.4 0" />
  </Svg>
)

export const RetryIcon = (p) => (
  <Svg {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M20.5 4v5h-5" />
  </Svg>
)

export const ChatIcon = (p) => (
  <Svg {...p}>
    <path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
  </Svg>
)

export const InfoIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
)

export const InboxIcon = (p) => (
  <Svg {...p}>
    <path d="M3 13h5l1.5 3h5L16 13h5" />
    <path d="M5.5 5h13l2.5 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" />
  </Svg>
)
