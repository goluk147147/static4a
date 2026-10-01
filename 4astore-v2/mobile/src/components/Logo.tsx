import React from 'react';
import { SvgXml } from 'react-native-svg';

// Same artwork as web/public/legacy/images/logo.svg.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 50" width="180" height="50">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#A8D4F5"/><stop offset="100%" stop-color="#5BA3D9"/></linearGradient></defs>
  <rect x="4" y="12" width="32" height="34" rx="6" ry="6" fill="url(#g)"/>
  <path d="M12 14 C12 5, 28 5, 28 14" fill="none" stroke="#F5A623" stroke-width="3.5" stroke-linecap="round"/>
  <text x="8" y="38" font-family="sans-serif" font-size="18" font-weight="900" fill="#F5A623">4</text>
  <text x="21" y="38" font-family="sans-serif" font-size="18" font-weight="900" fill="#4CAF50">A</text>
  <circle cx="9" cy="11" r="3" fill="#E53935"/>
  <path d="M9 8 C9 6.5, 10.5 6, 10.5 7.5" fill="#4CAF50"/>
  <ellipse cx="32" cy="10" rx="3.5" ry="2" fill="#388E3C" transform="rotate(-20 32 10)"/>
  <text x="42" y="30" font-family="sans-serif" font-size="18" font-weight="900" fill="#291b16" letter-spacing="1">STORE</text>
  <text x="42" y="43" font-family="sans-serif" font-size="9" font-weight="600" fill="#76645c" letter-spacing="0.35">GROCERY IN MINUTES</text>
</svg>`;

export default function Logo({ height = 42 }: { height?: number }) {
  return <SvgXml xml={LOGO} height={height} width={(height * 180) / 50} accessibilityLabel="4A Store" />;
}
