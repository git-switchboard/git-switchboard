import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface TerminalSpan {
  text: string;
  fg: [number, number, number, number];
  bg: [number, number, number, number];
  width: number;
}

export interface TerminalLine {
  spans: TerminalSpan[];
}

export interface TerminalFrame {
  cols: number;
  rows: number;
  lines: TerminalLine[];
}

export type LandingData = {
  branchPickerFrame: TerminalFrame | null;
  prDashboardFrame: TerminalFrame | null;
};

export async function data(): Promise<LandingData> {
  try {
    const framePath = join(process.cwd(), 'generated', 'terminal-frame.json');
    const raw = await readFile(framePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      branchPickerFrame: parsed.branchPicker ?? null,
      prDashboardFrame: parsed.prDashboard ?? null,
    };
  } catch {
    console.warn('[docs-site] No terminal frame found, using fallback');
    return { branchPickerFrame: null, prDashboardFrame: null };
  }
}
