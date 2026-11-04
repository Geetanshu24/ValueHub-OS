export interface AreaFact {
  fieldKey: string;
  value: number;
  source: string;
}

export interface AreaMeasurement {
  fieldKey: string;
  areaSqm: number;
  source: string;
}

export interface DetectedDiscrepancy {
  fieldKey: string;
  description: string;
  valueA: string;
  sourceA: string;
  valueB: string;
  sourceB: string;
}

const formatSqm = (value: number) => String(Number(value.toFixed(2)));

// Compares each documented area with each site measurement of the same
// fact. It only reports differences; it never decides which value is right.
export function detectAreaDiscrepancies(
  facts: AreaFact[],
  measurements: AreaMeasurement[],
  tolerancePercent: number,
): DetectedDiscrepancy[] {
  const found: DetectedDiscrepancy[] = [];
  for (const measurement of measurements) {
    for (const fact of facts) {
      if (fact.fieldKey !== measurement.fieldKey || fact.value <= 0) continue;
      const differencePercent = (Math.abs(measurement.areaSqm - fact.value) / fact.value) * 100;
      if (differencePercent <= tolerancePercent) continue;
      found.push({
        fieldKey: fact.fieldKey,
        description: `Documented ${formatSqm(fact.value)} sq. m vs measured ${formatSqm(measurement.areaSqm)} sq. m (${differencePercent.toFixed(1)}% apart)`,
        valueA: formatSqm(fact.value),
        sourceA: fact.source,
        valueB: formatSqm(measurement.areaSqm),
        sourceB: measurement.source,
      });
    }
  }
  return found;
}
