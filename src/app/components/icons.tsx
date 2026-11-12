import React from 'react';

type IconName =
  | 'image'
  | 'video'
  | 'folder'
  | 'plus'
  | 'minus'
  | 'play'
  | 'pause'
  | 'trash'
  | 'copy'
  | 'undo'
  | 'redo'
  | 'download'
  | 'upload'
  | 'palette'
  | 'layers'
  | 'settings'
  | 'search'
  | 'eye'
  | 'eyeOff'
  | 'grid'
  | 'graph'
  | 'sparkles'
  | 'wand'
  | 'chevron'
  | 'check'
  | 'close'
  | 'fit'
  | 'zoomIn'
  | 'zoomOut'
  | 'film'
  | 'sheet'
  | 'split'
  | 'sliders'
  | 'node'
  | 'link'
  | 'brush'
  | 'eraser'
  | 'refresh'
  | 'save'
  | 'folderOpen'
  | 'background'
  | 'cube';

const PATHS: Record<IconName, React.ReactNode> = {
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 15-5-5L5 20" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="5" width="14" height="14" rx="2" />
      <path d="m16 10 6-3v10l-6-3" />
    </>
  ),
  folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  folderOpen: <path d="M3 8V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1M3 8h18l-2 10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
      <path d="M10 10v6M14 10v6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14h-1" />,
  redo: <path d="m15 14 5-5-5-5M20 9h-9a7 7 0 0 0 0 14h1" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  upload: <path d="M12 16V4m0 0 4 4m-4-4L8 8M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.7 0 2-1 1.4-2-.8-1.4.2-3 1.8-3H18a3 3 0 0 0 3-3 9 9 0 0 0-9-10Z" />
      <circle cx="7.5" cy="10" r="1" />
      <circle cx="10" cy="6.5" r="1" />
      <circle cx="15" cy="7" r="1" />
      <circle cx="17.5" cy="11" r="1" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.5.66.85 1.2 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18M10.6 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 4M6.2 6.2A17 17 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.1-.8" />
      <path d="M9.9 9.9A3 3 0 0 0 14.1 14" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  graph: (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7 6h10M6 8l5 8M18 8l-5 8" />
    </>
  ),
  sparkles: <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  wand: <path d="m15 4 5 5L7 22H2v-5zM14 5l5 5M6 18l-2-2" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  check: <path d="m4 12 5 5L20 6" />,
  close: <path d="M5 5l14 14M19 5 5 19" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8v6M8 11h6M21 21l-4.3-4.3" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M8 11h6M21 21l-4.3-4.3" />
    </>
  ),
  film: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5" />
    </>
  ),
  sheet: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="3" width="18" height="8" rx="1.5" />
      <rect x="3" y="13" width="18" height="8" rx="1.5" />
      <path d="M3 12h18" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
  node: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
    </>
  ),
  link: <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />,
  brush: <path d="M14 4l6 6-9 9H5v-6zM13 5l6 6" />,
  eraser: <path d="m7 21-4-4L16 4l6 6-9 9H7zM14 6l6 6" />,
  refresh: <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />,
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h8V3M8 21v-7h8v7" />
    </>
  ),
  background: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 15c4-4 8 4 12 0s5-3 6-2" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3 21 8v8l-9 5-9-5V8z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
  filled = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  filled?: boolean;
}): React.ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
