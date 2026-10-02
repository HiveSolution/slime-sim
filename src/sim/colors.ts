import { Rgb } from './slime-simulation';

/** Parses `#rgb` or `#rrggbb` into 0..1 components; returns `fallback` for anything else. */
export function parseHexColor(value: string, fallback: Rgb): Rgb {
  const hex = value.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    return fallback;
  }
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
