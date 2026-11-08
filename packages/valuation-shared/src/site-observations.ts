// What an inspector records on site. Observations are stored as a flat
// { key: text } object on the inspection, so adding a field here needs no migration.
export interface ObservationField {
  key: string;
  label: string;
  type: 'select' | 'text' | 'number' | 'textarea';
  options?: readonly string[];
  unit?: string;
}

export interface ObservationSection {
  id: string;
  title: string;
  hint: string;
  fields: readonly ObservationField[];
}

export const OBSERVATION_SECTIONS: readonly ObservationSection[] = [
  {
    id: 'identity',
    title: 'Address & boundaries (as per site)',
    hint: 'What you find on the ground, to be set against the documents',
    fields: [
      { key: 'site_address', label: 'Address as per site', type: 'textarea' },
      { key: 'site_boundary_east', label: 'East side: who or what is there', type: 'text' },
      { key: 'site_boundary_west', label: 'West side: who or what is there', type: 'text' },
      { key: 'site_boundary_north', label: 'North side: who or what is there', type: 'text' },
      { key: 'site_boundary_south', label: 'South side: who or what is there', type: 'text' },
      { key: 'site_length_ft', label: 'Plot length', type: 'number', unit: 'ft' },
      { key: 'site_breadth_ft', label: 'Plot breadth', type: 'number', unit: 'ft' },
    ],
  },
  {
    id: 'use',
    title: 'Use & occupancy',
    hint: 'Who is using the property, and for what',
    fields: [
      { key: 'occupancy', label: 'Occupancy', type: 'select', options: ['Owner occupied', 'Tenant occupied', 'Vacant', 'Under construction', 'Partly occupied'] },
      { key: 'actual_use', label: 'Actual use', type: 'select', options: ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Mixed use'] },
      { key: 'occupant_name', label: 'Person met on site', type: 'text' },
    ],
  },
  {
    id: 'building',
    title: 'Building',
    hint: 'Structure, age and condition',
    fields: [
      { key: 'floors', label: 'Number of floors', type: 'number' },
      { key: 'age_years', label: 'Approx. age', type: 'number', unit: 'years' },
      { key: 'construction', label: 'Construction type', type: 'select', options: ['RCC framed', 'Load bearing walls', 'Steel / PEB', 'Kutcha / other'] },
      { key: 'quality', label: 'Quality of construction', type: 'select', options: ['Excellent', 'Good', 'Average', 'Poor'] },
      { key: 'condition', label: 'Present condition', type: 'select', options: ['New', 'Good', 'Fair', 'Needs repair', 'Dilapidated'] },
      { key: 'finishing', label: 'Finishing & fittings', type: 'text' },
      { key: 'site_year_built', label: 'Year of construction (as seen or told)', type: 'text' },
      { key: 'accommodation_ground', label: 'Accommodation on the ground floor', type: 'textarea' },
      { key: 'accommodation_first', label: 'Accommodation on the first floor', type: 'textarea' },
    ],
  },
  {
    id: 'site',
    title: 'Site & access',
    hint: 'Shape, road and anything that affects the land',
    fields: [
      { key: 'road_width_ft', label: 'Approach road width', type: 'number', unit: 'ft' },
      { key: 'road_type', label: 'Road type', type: 'select', options: ['Metalled', 'Kutcha', 'Service lane', 'Highway frontage'] },
      { key: 'shape', label: 'Plot shape', type: 'select', options: ['Regular', 'Irregular', 'Corner plot', 'Triangular'] },
      { key: 'encroachment', label: 'Encroachment', type: 'select', options: ['None seen', 'Minor', 'Major'] },
      { key: 'flood_prone', label: 'Flood or waterlogging', type: 'select', options: ['No', 'Yes'] },
      { key: 'road_widening', label: 'Road widening (existing or planned)', type: 'text' },
    ],
  },
  {
    id: 'services',
    title: 'Services & surroundings',
    hint: 'Utilities and the neighbourhood',
    fields: [
      { key: 'water', label: 'Water supply', type: 'select', options: ['Municipal', 'Borewell', 'Both', 'None'] },
      { key: 'electricity', label: 'Electricity', type: 'select', options: ['Available', 'Not available'] },
      { key: 'drainage', label: 'Drainage', type: 'select', options: ['Underground sewer', 'Septic tank', 'Open drain', 'None'] },
      { key: 'neighbourhood', label: 'Neighbourhood', type: 'select', options: ['Fully developed', 'Developing', 'Rural / outskirts'] },
      { key: 'locality_quality', label: 'Nearby locality', type: 'select', options: ['High', 'Middle', 'Poor'] },
      { key: 'landmark', label: 'Nearest landmark', type: 'text' },
    ],
  },
  {
    id: 'remarks',
    title: 'Identification & remarks',
    hint: 'How the property was identified and anything unusual',
    fields: [
      { key: 'identified_by', label: 'Property identified by', type: 'text' },
      { key: 'boundaries_match', label: 'Boundaries match the documents', type: 'select', options: ['Yes', 'No (see remarks)', 'Not checked'] },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
  },
];

export const OBSERVATION_KEYS: readonly string[] = OBSERVATION_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

// Counts only the recorded answers that belong to the form.
export function countObservations(observations: unknown): number {
  if (!observations || typeof observations !== 'object') return 0;
  return OBSERVATION_KEYS.filter((key) => String((observations as Record<string, unknown>)[key] ?? '').trim() !== '').length;
}

export const MIN_OBSERVATIONS = 5;

export const PHOTO_CATEGORIES = [
  'Front elevation',
  'Side / rear',
  'Interior',
  'Boundary & surroundings',
  'Road / access',
  'Name plate / identification',
  'Defects',
  'Other',
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const MIN_PHOTOS = 4;

export const MEASUREMENT_LABELS = ['Plot', 'Ground floor', 'First floor', 'Second floor', 'Basement', 'Terrace', 'Super built-up', 'Carpet'] as const;
export const MEASUREMENT_METHODS = ['Measuring tape', 'Laser distance meter', 'Scaled from approved plan', 'As per site layout'] as const;
