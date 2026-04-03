import type { CheckRun } from './types.js';

export interface CheckRunCandidate {
  id: number;
  name: string;
  status: CheckRun['status'];
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  appSlug: string | null;
  suiteId: number | null;
  suiteCreatedAt: string | null;
  workflowRunId: number | null;
  workflowRunNumber: number | null;
  workflowRunCreatedAt: string | null;
  workflowName: string | null;
  matchingPullRequestNumbers: number[];
}

function checkIdentity(candidate: CheckRunCandidate): string {
  const appSlug = candidate.appSlug ?? 'unknown-app';
  const workflowName = candidate.workflowName ?? '';
  return workflowName
    ? `${appSlug}:${workflowName}:${candidate.name}`
    : `${appSlug}:${candidate.name}`;
}

function isoToTime(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function matchesPullRequest(
  candidate: CheckRunCandidate,
  pullNumber: number
): boolean {
  return (
    pullNumber > 0 && candidate.matchingPullRequestNumbers.includes(pullNumber)
  );
}

function compareCandidates(
  a: CheckRunCandidate,
  b: CheckRunCandidate,
  pullNumber: number
): number {
  const aMatchesPr = matchesPullRequest(a, pullNumber);
  const bMatchesPr = matchesPullRequest(b, pullNumber);
  if (aMatchesPr !== bMatchesPr) {
    return aMatchesPr ? 1 : -1;
  }

  const runNumberDiff = (a.workflowRunNumber ?? -1) - (b.workflowRunNumber ?? -1);
  if (runNumberDiff !== 0) return runNumberDiff;

  const runCreatedDiff =
    isoToTime(a.workflowRunCreatedAt ?? a.suiteCreatedAt) -
    isoToTime(b.workflowRunCreatedAt ?? b.suiteCreatedAt);
  if (runCreatedDiff !== 0) return runCreatedDiff;

  const workflowRunIdDiff = (a.workflowRunId ?? -1) - (b.workflowRunId ?? -1);
  if (workflowRunIdDiff !== 0) return workflowRunIdDiff;

  const suiteIdDiff = (a.suiteId ?? -1) - (b.suiteId ?? -1);
  if (suiteIdDiff !== 0) return suiteIdDiff;

  const startedDiff =
    isoToTime(a.startedAt ?? a.completedAt) -
    isoToTime(b.startedAt ?? b.completedAt);
  if (startedDiff !== 0) return startedDiff;

  return a.id - b.id;
}

export function selectRelevantCheckRuns(
  candidates: readonly CheckRunCandidate[],
  pullNumber: number
): CheckRun[] {
  const latestByIdentity = new Map<string, CheckRunCandidate>();

  for (const candidate of candidates) {
    const identity = checkIdentity(candidate);
    const existing = latestByIdentity.get(identity);
    if (
      !existing ||
      compareCandidates(candidate, existing, pullNumber) > 0
    ) {
      latestByIdentity.set(identity, candidate);
    }
  }

  return [...latestByIdentity.values()].map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    status: candidate.status,
    conclusion: candidate.conclusion,
    detailsUrl: candidate.detailsUrl,
    startedAt: candidate.startedAt,
    completedAt: candidate.completedAt,
  }));
}
