export type RepresentativeTempSource = "CONTACT" | "IR_SURFACE";

/**
 * Representative battery temperature: the larger valid value of the contact
 * and IR-surface peaks. Room temperature is never a candidate — it is the
 * reference for heat rise, not a battery reading.
 */
export function representativeTemperature(
  tempContact: number | null,
  tempIrSurface: number | null,
): { valueC: number | null; source: RepresentativeTempSource | null } {
  const candidates = [tempContact, tempIrSurface].filter((value): value is number => value !== null);
  if (!candidates.length) return { valueC: null, source: null };
  const valueC = Math.max(...candidates);
  return { valueC, source: tempContact === valueC ? "CONTACT" : "IR_SURFACE" };
}

/**
 * Heat rise = representative temperature − room temperature (°C).
 *
 * Null when either side is missing: substituting the surface temperature would
 * silently turn a room-temperature drift into "the battery cooled down".
 * Negative values are kept — a room warmer than the battery is itself the
 * drift signal the ambient probe exists to expose.
 */
export function heatRiseC(representativeTempC: number | null, tempAmbientC: number | null): number | null {
  if (representativeTempC === null || tempAmbientC === null) return null;
  return Math.round((representativeTempC - tempAmbientC) * 100) / 100;
}
