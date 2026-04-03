const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Blend a color toward the background to keep it recognizable but less prominent.
 */
export function muteColor(
  color: string,
  amount = 0.45,
  background = '#1a1b26'
): string {
  if (!HEX_COLOR.test(color) || !HEX_COLOR.test(background)) return color;

  const mix = clamp01(amount);
  const channels = [1, 3, 5].map((offset) => {
    const source = Number.parseInt(color.slice(offset, offset + 2), 16);
    const target = Number.parseInt(background.slice(offset, offset + 2), 16);
    return Math.round(source * (1 - mix) + target * mix)
      .toString(16)
      .padStart(2, '0');
  });

  return `#${channels.join('')}`;
}
