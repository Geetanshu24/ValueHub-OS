// Mirrors the PropertyClass enum in apps/valuation-api/prisma/schema.prisma.
// Each class gets its own calculation engine; they are never merged.
export const PROPERTY_CLASSES = [
  'FLAT',
  'HOUSE',
  'LAND',
  'COMMERCIAL',
  'INDUSTRIAL',
  'MIXED_USE',
] as const;

export type PropertyClass = (typeof PROPERTY_CLASSES)[number];

export const PROPERTY_CLASS_LABELS: Record<PropertyClass, string> = {
  FLAT: 'Flat / apartment',
  HOUSE: 'Independent house / villa',
  LAND: 'Vacant / agricultural land',
  COMMERCIAL: 'Shop / office / showroom',
  INDUSTRIAL: 'Factory / warehouse',
  MIXED_USE: 'Mixed-use / project',
};
