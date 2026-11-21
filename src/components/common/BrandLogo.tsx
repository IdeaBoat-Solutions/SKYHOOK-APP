import React, { useEffect, useState } from 'react';

export const DEFAULT_LOGO = '/assets/image.png';

interface BrandLogoProps {
  /** The company's own logo (Settings). Falls back to the Skyhook mark if empty or broken. */
  src?: string;
  className?: string;
  alt?: string;
}

/**
 * The Skyhook brand mark. A saved logo URL can be stale or unreachable, and a broken-image
 * icon on the login screen looks like the whole app is broken, so a failed load falls back
 * to the bundled logo, and finally to the plain name.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({ src, className = '', alt = 'Skyhook' }) => {
  const [current, setCurrent] = useState(src || DEFAULT_LOGO);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrent(src || DEFAULT_LOGO);
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <span className={`flex items-center justify-center font-black tracking-tight text-logo-700 ${className}`}>
        SKYHOOK
      </span>
    );
  }
  return (
    <img
      src={current}
      alt={alt}
      className={`object-contain ${className}`}
      // The bundled PNG carries a 1px grey scan edge on its left side; crop it.
      style={current === DEFAULT_LOGO ? { clipPath: 'inset(0 0 0 1.2%)' } : undefined}
      onError={() => (current !== DEFAULT_LOGO ? setCurrent(DEFAULT_LOGO) : setFailed(true))}
    />
  );
};
