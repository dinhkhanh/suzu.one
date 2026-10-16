// The four attendance request types, in the order the form lists them. A file of its own with no
// imports: `inputs.ts` reads the list while it loads, and taking it from `requests.ts` closed an
// import cycle (requests → … → leave/service → leave/requests → inputs → requests) that, in
// whichever build worker entered it there, read the list before it existed.
export const ATTENDANCE_REQUEST_TYPES = ["attendance_correction", "remote_work", "overtime", "holiday_work"] as const;
