// The privacy module's entry point for other modules (NFR-PRV-01..04). Kept to the consent reads
// and writes on purpose: attendance asks it before keeping a position, and nothing here may import
// attendance back.
import "server-only";

export { gpsConsentOf, mayRecordPosition, recordConsentEvent } from "./consents";
export { type ConsentState, GPS_NOTICE_VERSION, PUNCH_POSITION_RETENTION_DAYS } from "./engine/retention";
