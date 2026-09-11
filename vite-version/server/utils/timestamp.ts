/**
 * InterDash Server — Database Timestamp Utilities
 *
 * Provides safe, timezone-independent UTC parsing for timestamps retrieved
 * from SQLite database columns or incoming serialized dates.
 */

/**
 * Safely parse any database timestamp into a Date object evaluated in UTC.
 *
 * Handles:
 * - SQLite datetime format: "YYYY-MM-DD HH:mm:ss"
 * - ISO format without timezone: "YYYY-MM-DDTHH:mm:ss"
 * - Full ISO 8601 UTC string: "YYYY-MM-DDTHH:mm:ss.sssZ"
 * - ISO with explicit offset: "YYYY-MM-DDTHH:mm:ss+05:30", "YYYY-MM-DDTHH:mm:ss-04:00"
 * - Existing Date objects
 * - Epoch timestamps in milliseconds
 *
 * Guarantees:
 * - Never double-appends timezone identifiers
 * - Never parses UTC database timestamps as local server/host timezone
 */
export function parseDatabaseTimestampUtc(
  value: string | Date | number | null | undefined
): Date {
  if (value === null || value === undefined) {
    return new Date(0);
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? new Date(0) : value;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }

  const str = String(value).trim();
  if (!str) {
    return new Date(0);
  }

  // Check if string has explicit timezone offset (+HH:MM, -HH:MM, or Z)
  // Matches: Z, z, +00:00, -04:00, +0530, etc. at the end of the string
  const hasTimezone = /([Zz]|[+-]\d{2}(?::?\d{2})?)$/.test(str);

  if (hasTimezone) {
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? new Date(0) : parsed;
  }

  // SQLite standard format "YYYY-MM-DD HH:mm:ss" or ISO without tz "YYYY-MM-DDTHH:mm:ss"
  // Treat as UTC by normalizing space to T and appending "Z"
  const normalized = str.includes("T") ? str : str.replace(" ", "T");
  const parsed = new Date(`${normalized}Z`);
  return isNaN(parsed.getTime()) ? new Date(0) : parsed;
}
