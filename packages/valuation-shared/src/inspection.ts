// Mirrors InspectionStatus / DiscrepancyStatus in apps/valuation-api/prisma/schema.prisma.
export const INSPECTION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const DISCREPANCY_STATUSES = ['UNRESOLVED', 'RESOLVED', 'DISCLOSED', 'ESCALATED'] as const;
export type DiscrepancyStatus = (typeof DISCREPANCY_STATUSES)[number];

// Outcomes a valuer may record. Only RESOLVED and DISCLOSED clear the
// quality-review gate; ESCALATED keeps blocking until further evidence.
export const DISCREPANCY_RESOLUTIONS = ['RESOLVED', 'DISCLOSED', 'ESCALATED'] as const;
export type DiscrepancyResolution = (typeof DISCREPANCY_RESOLUTIONS)[number];

// Area facts an inspection measurement can be checked against. Document
// fields and measurements pair up by sharing one of these keys.
export const AREA_FIELD_KEYS = ['plot_area_sqm', 'built_up_area_sqm', 'carpet_area_sqm'] as const;
export type AreaFieldKey = (typeof AREA_FIELD_KEYS)[number];

// Differences at or below this share of the document value are treated as
// measurement noise; anything larger is flagged for the valuer.
export const AREA_TOLERANCE_PERCENT = 0.5;
