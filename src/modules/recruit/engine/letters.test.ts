import { describe, expect, it } from "vitest";
import { interviewPlaceText, interviewTimeText } from "./letters";

const ZONE = "Asia/Ho_Chi_Minh";
// 02:30 UTC on a Thursday is 09:30 in Vietnam.
const start = new Date("2026-10-08T02:30:00Z");
const end = new Date("2026-10-08T03:30:00Z");

describe("interviewTimeText", () => {
  it("writes the day and the hours in Vietnam's zone, with the offset printed", () => {
    expect(interviewTimeText(start, end, "vi", ZONE)).toBe("Thứ Năm, 08/10/2026, 09:30–10:30 GMT+7");
  });

  it("writes it in English for a candidate who reads English", () => {
    expect(interviewTimeText(start, end, "en", ZONE)).toBe("Thursday, 8 October 2026, 09:30–10:30 GMT+7");
  });

  it("takes the office's day, not UTC's, across midnight", () => {
    // 23:30 UTC on the 7th is 06:30 on the 8th in Vietnam.
    expect(interviewTimeText(new Date("2026-10-07T23:30:00Z"), new Date("2026-10-08T00:30:00Z"), "vi", ZONE)).toBe("Thứ Năm, 08/10/2026, 06:30–07:30 GMT+7");
  });
});

describe("interviewPlaceText", () => {
  const words = { video: "Trực tuyến", phone: "Qua điện thoại", office: "Văn phòng SuZu Media" };

  it("is the meeting link for a video call, or says it is online", () => {
    expect(interviewPlaceText({ mode: "video", location: null, meetingUrl: "https://meet.example/x" }, words)).toBe("https://meet.example/x");
    expect(interviewPlaceText({ mode: "video", location: null, meetingUrl: null }, words)).toBe("Trực tuyến");
  });

  it("says a phone call is one", () => {
    expect(interviewPlaceText({ mode: "phone", location: null, meetingUrl: null }, words)).toBe("Qua điện thoại");
  });

  it("is the address typed for an office interview, or the company's office — never empty", () => {
    expect(interviewPlaceText({ mode: "onsite", location: " Tầng 4 ", meetingUrl: null }, words)).toBe("Tầng 4");
    expect(interviewPlaceText({ mode: "onsite", location: "  ", meetingUrl: null }, words)).toBe("Văn phòng SuZu Media");
  });
});
