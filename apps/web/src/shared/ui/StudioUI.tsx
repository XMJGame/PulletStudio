import type { ButtonHTMLAttributes, ReactNode } from 'react';

const glyphs = {
  arrow: 'M19 12H5m7 7-7-7 7-7',
  right: 'M5 12h14m-7-7 7 7-7 7',
  plus: 'M12 5v14m-7-7h14',
  close: 'm6 6 12 12M18 6 6 18',
  search: 'M21 21l-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  grid: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-10-5v5l3 2',
  moon: 'M20.6 15A9 9 0 0 1 9 3.4 9 9 0 1 0 20.6 15Z',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2m-2 5a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  image: 'M4 4h16v16H4zM4 16l4-4 3 3 4-5 5 6M8 8h.01',
  note: 'M6 4h12v16H6zm3 5h6m-6 4h6m-6 4h3',
  spark: 'M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2Zm7 15v5m-2.5-2.5h5',
  cursor: 'm5 3 14 11-7 1-3 6L5 3Z',
  hand: 'M8 13V6a1 1 0 1 1 2 0v5-7a1 1 0 0 1 2 0v7-6a1 1 0 0 1 2 0v7-4a1 1 0 1 1 2 0v7c0 4-2 6-5 6h-1c-3 0-4-2-5-4l-2-4a1 1 0 0 1 2-1l3 3',
  upload: 'M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4',
  sliders: 'M5 4v16m7-16v16m7-16v16M3 9h4m3 5h4m3-6h4',
  chevron: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  alert: 'M12 9v4m0 4h.01M12 3 2.5 20h19L12 3Z',
  play: 'm9 5 11 7-11 7V5Z',
  film: 'M4 4h16v16H4zm4 0v16m8-16v16M4 9h4m-4 6h4m8-6h4m-4 6h4',
  fit: 'M9 4H4v5m11-5h5v5m0 6v5h-5m-6 0H4v-5',
  minus: 'M5 12h14',
  book: 'M5 4h5v16H5zm5 0h5v16h-5zm5 1 3-1 4 15-3 1z',
  download: 'M12 4v12m-4-4 4 4 4-4M4 18v2h16v-2',
  dots: 'M5 12h.01m7 0h.01m7 0h.01',
} as const;

export function StudioIcon({ name, size = 18 }: { name: keyof typeof glyphs; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={glyphs[name]} />
    </svg>
  );
}

export function StudioButton({
  variant = 'default',
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost';
  icon?: keyof typeof glyphs;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`v2-button ${props.className ?? ''}`}
      data-variant={variant}
      data-icon={icon && !children ? '' : undefined}
    >
      {icon && <StudioIcon name={icon} />}
      {children}
    </button>
  );
}

export function StudioBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="v2-brand">
      <span className="v2-mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 19V5h8a4.5 4.5 0 0 1 0 9h-4m0-5h4M6 14h4v5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {!compact && 'Pullet Studio'}
    </span>
  );
}
