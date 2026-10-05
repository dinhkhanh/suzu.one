// The browser's one reading of where the phone is: at the check-in key, and in the position picker
// of the off-site and work-location forms. Only when asked — never tracked (NFR-PRV-02).

export type PositionReading = { latitude: number; longitude: number; accuracyM: number };

// Ten seconds is as long as anyone waits at the door; without a fix the punch still goes through, flagged.
export function readPosition(): Promise<{ position: PositionReading | null; problem: string | null }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ position: null, problem: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (reading) => resolve({ position: { latitude: reading.coords.latitude, longitude: reading.coords.longitude, accuracyM: reading.coords.accuracy }, problem: null }),
      (error) => resolve({ position: null, problem: error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}
