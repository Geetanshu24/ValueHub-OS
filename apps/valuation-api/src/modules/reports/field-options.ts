// Boxes in the bank formats whose answer is one of a few fixed choices. The form shows these as
// dropdowns; every other box stays free text. Keyed by field key, shared by all bank formats
// (a key a format does not have is simply ignored). Whatever is already in a box stays selectable
// even when it is not listed, so suggestions from records and older answers are never lost.
const YES_NO = ['Yes', 'No'];
const YES_NO_UNKNOWN = ['Yes', 'No', 'Not known'];
const GRADE = ['Excellent', 'Good', 'Normal', 'Poor'];
const USE = ['Residential', 'Commercial', 'Industrial'];

export const FIELD_OPTIONS: Record<string, string[]> = {
  // Location and area
  area_residential: YES_NO,
  area_commercial: YES_NO,
  area_industrial: YES_NO,
  area_type: USE,
  class_high_middle_poor: ['High', 'Middle', 'Poor'],
  class_urban_rural: ['Metro', 'Urban', 'Semi Urban', 'Rural'],
  corporation_limit: ['Corporation limit', 'Village Panchayat', 'Municipality'],
  govt_enactments: ['Not in our knowledge', 'Not known', 'Yes', 'No'],
  agri_conversion: YES_NO_UNKNOWN,
  approved_land_use: [...USE, 'Agricultural'],
  // Characteristics of the site
  site_flooding: YES_NO,
  site_approved_layout: YES_NO,
  site_corner: ['Corner plot', 'Intermittent plot'],
  site_road_type: ['Tar road', 'Concrete (CC) road', 'WBM road', 'Gravel road', 'Kachha road'],
  site_landlocked: YES_NO,
  site_power: YES_NO,
  site_sewer: YES_NO,
  site_shape: ['Regular', 'Irregular', 'Rectangular', 'Square', 'Triangular'],
  site_level: ['Level', 'Sloping', 'Above road level', 'Below road level'],
  road_type: ['Tar road', 'Concrete (CC) road', 'WBM road', 'Gravel road', 'Kachha road'],
  lg_10: YES_NO_UNKNOWN,
  lg_11: ['Yes', 'No', 'Not available'],
  lg_15: YES_NO_UNKNOWN,
  lg_16: YES_NO_UNKNOWN,
  f91: YES_NO_UNKNOWN,
  // Building
  b_type: USE,
  building_type: USE,
  b_construction: ['Load bearing', 'RCC framed', 'Steel framed'],
  en_type: ['Load bearing', 'RCC framed', 'Steel framed'],
  structure_type: ['Load bearing', 'RCC framed', 'Steel framed'],
  b_condition_exterior: GRADE,
  b_condition_interior: GRADE,
  en_appearance: ['Excellent', 'Good', 'Ordinary', 'Poor'],
  b_map_verified: YES_NO,
  tp_4: YES_NO,
  cw_present: ['Present', 'Not Present'],
  el_wiring: ['Concealed', 'Surface / open'],
  el_fittings: ['Superior', 'Good', 'Ordinary'],
  // Declarations and enclosures
  dec_4: YES_NO,
  le_tenure: ['Freehold', 'Leasehold'],
  property_type: ['Flat', 'Independent house', 'Plot / land', 'Commercial', 'Industrial'],
  as_sarfaesi: YES_NO,
  as_social: YES_NO,
  enc_d: ['Yes (Attached)', 'No'],
  enc_h: YES_NO,
  enc_i: YES_NO,
};
