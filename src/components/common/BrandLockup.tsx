import React from 'react';
import { BrandLogo } from './BrandLogo';

interface BrandLockupProps {
  logoUrl?: string;
  name?: string;
  /** `nav` for the top bar, `card` for the sign-in form header. */
  size?: 'nav' | 'card';
  className?: string;
}

/**
 * The one brand lockup used on the auth screens: a larger logo tile and a
 * stacked wordmark. Keeping it in one place means the navbar and the sign-in
 * card can never drift apart.
 */
export const BrandLockup: React.FC<BrandLockupProps> = ({
  logoUrl,
  name,
  size = 'nav',
  className = '',
}) => {
  const brandName = (name || 'SKYHOOK').trim();
  const words = brandName.split(/\s+/).filter(Boolean);

  // Two lines read best. Multi-word names split on the space; a single word
  // (SKYHOOK) splits down the middle. No "ERP" tag rides along with the mark.
  let top = brandName;
  let bottom = '';
  if (words.length > 1) {
    const half = Math.ceil(words.length / 2);
    top = words.slice(0, half).join(' ');
    bottom = words.slice(half).join(' ');
  } else if (brandName.length > 4) {
    // SKYHOOK reads as SKY / HOOK, never SKYH / OOK.
    const midpoint = Math.floor(brandName.length / 2);
    top = brandName.slice(0, midpoint);
    bottom = brandName.slice(midpoint);
  }

  return (
    <span className={`brand-lockup brand-lockup--${size}${className ? ` ${className}` : ''}`}>
      <span className="brand-lockup__tile">
        <BrandLogo src={logoUrl} className="brand-lockup__logo" />
      </span>
      <span className="brand-lockup__wordmark">
        <span className="brand-lockup__line">{top}</span>
        {bottom && <span className="brand-lockup__line">{bottom}</span>}
      </span>
    </span>
  );
};
