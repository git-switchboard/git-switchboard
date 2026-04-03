interface FooterRow {
  help: string;
  quota?: string;
}

const FOOTER_SEPARATOR = ' | ';

function wrapFooterParts(parts: string[], maxWidth: number): string[] {
  if (parts.length === 0) return [];

  const rows: string[] = [];
  let current = '';

  for (const [index, part] of parts.entries()) {
    const segment = index === 0 ? part : `${FOOTER_SEPARATOR}${part}`;
    const candidate = current + segment;
    if (candidate.length > maxWidth && current) {
      rows.push(current);
      current = part;
      continue;
    }
    current = candidate;
  }

  if (current) rows.push(current);

  return rows;
}

export function buildFooterRows(
  parts: string[],
  width: number,
  quota?: string
): FooterRow[] {
  const helpWidth = Math.max(1, width - 4);

  if (!quota) {
    return wrapFooterParts(parts, helpWidth).map((help) => ({ help }));
  }

  const reservedHelpWidth = helpWidth - quota.length - 1;
  const minimumReservedWidth = parts[0]?.length ?? 0;

  if (reservedHelpWidth >= minimumReservedWidth) {
    return wrapFooterParts(parts, reservedHelpWidth).map((help, index) => ({
      help,
      quota: index === 0 ? quota : undefined,
    }));
  }

  return [
    ...wrapFooterParts(parts, helpWidth).map((help) => ({ help })),
    { help: '', quota },
  ];
}

export function FooterRows({
  rows,
  fg,
}: {
  rows: FooterRow[];
  fg: string;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <box
          key={`${index}-${row.help}-${row.quota ?? ''}`}
          flexDirection="row"
          justifyContent="space-between"
          style={{ width: '100%' }}
        >
          <box style={{ flexGrow: 1 }}>
            {row.help ? <text content={` ${row.help}`} fg={fg} /> : null}
          </box>
          {row.quota ? <text content={row.quota} fg={fg} /> : null}
        </box>
      ))}
    </>
  );
}
