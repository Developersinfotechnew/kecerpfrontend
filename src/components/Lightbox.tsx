'use client';

import { useEffect } from 'react';

/**
 * In-app image viewer. The signed download URL opens in a new tab by
 * default, which shrinks and zooms the image and reads as "blurry" in
 * screenshots. A lightbox shows the file at its natural size with no
 * downscale, so what the user sees is what was uploaded. Esc or a
 * backdrop click closes it.
 */
export function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-6"
      style={{ background: 'rgba(15, 23, 41, 0.85)' }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <div
          className="mb-2 flex items-center justify-between gap-4"
          style={{ color: 'var(--faint)' }}
        >
          <span className="text-[12.5px]">{name}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[20px] leading-none"
            style={{ color: 'var(--muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <img
          src={src}
          alt={name}
          className="max-h-[85vh] max-w-[90vw]"
          style={{ objectFit: 'contain', borderRadius: 4 }}
        />
      </div>
    </div>
  );
}
