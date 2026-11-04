// Human-readable IDs from the blueprint, e.g. VH-PROP-000184 and
// VH-ASG-2026-00921. Counters are issued per firm by the API.
export function formatPropertyCode(sequence: number): string {
  return `VH-PROP-${String(sequence).padStart(6, '0')}`;
}

export function formatAssignmentCode(year: number, sequence: number): string {
  return `VH-ASG-${year}-${String(sequence).padStart(5, '0')}`;
}

export function formatQueryCode(year: number, sequence: number): string {
  return `Q-${year}-${String(sequence).padStart(5, '0')}`;
}

export function formatInvoiceCode(sequence: number): string {
  return `VH-INV-${String(sequence).padStart(4, '0')}`;
}
