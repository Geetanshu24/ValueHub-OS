export interface Change {
  field: string;
  from: unknown;
  to: unknown;
}

export interface LineLike {
  component: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  treatment: string;
  sourceNote?: string | null;
}

export interface ValuationLike {
  versionNumber: number;
  status: string;
  method: string;
  areaBasis: string;
  adoptedAreaSqm: number;
  adoptedAreaSource: string;
  assumptions: string | null;
  totalValue: number;
  changeReason: string | null;
  lines: LineLike[];
}

export interface LineChange {
  component: string;
  change: 'ADDED' | 'REMOVED' | 'CHANGED';
  from?: LineLike;
  to?: LineLike;
  fields?: string[];
}

const HEADER_FIELDS = ['method', 'areaBasis', 'adoptedAreaSqm', 'adoptedAreaSource', 'assumptions', 'totalValue'] as const;
const LINE_FIELDS = ['quantity', 'unit', 'rate', 'amount', 'treatment', 'sourceNote'] as const;

const norm = (value: unknown) => (value === undefined || value === null || value === '' ? null : value);
const differs = (a: unknown, b: unknown) => norm(a) !== norm(b);

export function diffLines(from: LineLike[], to: LineLike[]): LineChange[] {
  const before = new Map(from.map((l) => [l.component, l]));
  const after = new Map(to.map((l) => [l.component, l]));
  const changes: LineChange[] = [];
  for (const [component, line] of after) {
    const old = before.get(component);
    if (!old) {
      changes.push({ component, change: 'ADDED', to: line });
      continue;
    }
    const fields = LINE_FIELDS.filter((f) => differs(old[f], line[f]));
    if (fields.length > 0) changes.push({ component, change: 'CHANGED', from: old, to: line, fields: [...fields] });
  }
  for (const [component, line] of before) if (!after.has(component)) changes.push({ component, change: 'REMOVED', from: line });
  return changes;
}

// What changed between two versions of one valuation, and the net effect.
export function diffValuations(from: ValuationLike, to: ValuationLike) {
  const header: Change[] = HEADER_FIELDS.filter((f) => differs(from[f], to[f])).map((f) => ({ field: f, from: from[f], to: to[f] }));
  return {
    fromVersion: from.versionNumber,
    toVersion: to.versionNumber,
    changeReason: to.changeReason,
    header,
    lines: diffLines(from.lines, to.lines),
    totalDelta: Math.round((to.totalValue - from.totalValue) * 100) / 100,
  };
}

export interface SnapshotLike {
  sections: { heading: string; rows: { label: string; value: string }[] }[];
  workings: { lines: LineLike[]; totalValue: number };
  limitations: string[];
  annexures: { documentId: string; fileName: string; sha256: string }[];
  photos: { id: string }[];
  template: { name: string; version: number };
}

// Report-level comparison: printed fields, workings, wording and attachments.
export function diffSnapshots(from: SnapshotLike, to: SnapshotLike) {
  const rows = (s: SnapshotLike) => new Map(s.sections.flatMap((sec) => sec.rows.map((r) => [`${sec.heading} › ${r.label}`, r.value] as const)));
  const a = rows(from);
  const b = rows(to);
  const fields: Change[] = [];
  for (const [key, value] of b) if (differs(a.get(key), value)) fields.push({ field: key, from: a.get(key) ?? null, to: value });
  for (const [key, value] of a) if (!b.has(key)) fields.push({ field: key, from: value, to: null });

  const setDiff = <T>(x: T[], y: T[]) => ({ added: y.filter((v) => !x.includes(v)), removed: x.filter((v) => !y.includes(v)) });
  return {
    template: differs(`${from.template.name}@${from.template.version}`, `${to.template.name}@${to.template.version}`) ? { from: from.template, to: to.template } : null,
    fields,
    lines: diffLines(from.workings.lines, to.workings.lines),
    totalDelta: Math.round((to.workings.totalValue - from.workings.totalValue) * 100) / 100,
    limitations: setDiff(from.limitations, to.limitations),
    annexures: setDiff(from.annexures.map((x) => `${x.fileName} (${x.sha256.slice(0, 8)})`), to.annexures.map((x) => `${x.fileName} (${x.sha256.slice(0, 8)})`)),
    photoCount: { from: from.photos.length, to: to.photos.length },
  };
}
