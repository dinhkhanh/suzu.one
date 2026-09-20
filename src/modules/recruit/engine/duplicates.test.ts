import { describe, expect, it } from "vitest";
import { isCertainDuplicate, NAME_MATCH_THRESHOLD, nameSimilarity, normaliseEmail, normalisePhone, probeFor, rankDuplicates } from "./duplicates";

const row = (id: string, fullName: string, email: string | null, phone: string | null) => ({
  id,
  fullName,
  searchName: fullName.toLowerCase(),
  emailKey: normaliseEmail(email),
  phoneKey: normalisePhone(phone),
});

describe("normaliseEmail", () => {
  it("lower-cases, trims and drops the +tag", () => {
    expect(normaliseEmail("  Linh.Tran+Jobs@Example.COM ")).toBe("linh.tran@example.com");
  });

  // Dots are a Gmail-only equivalence. Treating them that way everywhere would merge two different
  // mailboxes at any company that runs its own mail.
  it("drops dots for Google's domains and keeps them everywhere else", () => {
    expect(normaliseEmail("tran.thi.mai@gmail.com")).toBe("tranthimai@gmail.com");
    expect(normaliseEmail("tran.thi.mai@googlemail.com")).toBe("tranthimai@googlemail.com");
    expect(normaliseEmail("tran.thi.mai@suzu.vn")).toBe("tran.thi.mai@suzu.vn");
  });

  it("returns null for anything that is not an address, so junk never matches junk", () => {
    for (const junk of ["", "   ", "nobody", "@example.com", "a@", "a@b", "two words@example.com", null, undefined]) {
      expect(normaliseEmail(junk)).toBeNull();
    }
  });
});

describe("normalisePhone", () => {
  it("reduces every shape of one Vietnamese mobile to the same digits", () => {
    for (const typed of ["0912345678", "0912 345 678", "+84 912 345 678", "84912345678", "0084912345678", "(091) 234-5678"]) {
      expect(normalisePhone(typed)).toBe("912345678");
    }
  });

  it("drops numbers too short to identify anybody", () => {
    expect(normalisePhone("1234567")).toBeNull();
    expect(normalisePhone("—")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });

  // A landline keeps its area code; only the national trunk 0 comes off.
  it("keeps a Hanoi landline distinct", () => {
    expect(normalisePhone("024 3936 1234")).toBe("2439361234");
  });
});

describe("nameSimilarity", () => {
  it("ignores accents and case", () => {
    expect(nameSimilarity("Nguyễn Thị Đào", "nguyen thi dao")).toBe(1);
  });

  it("ignores the order the words were typed in", () => {
    expect(nameSimilarity("Trần Thị Mai", "Mai Trần Thị")).toBe(1);
  });

  it("scores a near miss high and two different people low", () => {
    expect(nameSimilarity("Nguyễn Văn An", "Nguyen Van Anh")).toBeGreaterThan(0.8);
    expect(nameSimilarity("Nguyễn Văn An", "Phạm Quốc Bảo")).toBeLessThan(0.4);
  });

  it("is 0 when either side is empty", () => {
    expect(nameSimilarity("", "Nguyễn Văn An")).toBe(0);
  });
});

describe("rankDuplicates", () => {
  const onFile = [
    row("a", "Trần Thị Mai", "tran.thi.mai@gmail.com", "0912345678"),
    row("b", "Nguyễn Văn An", "an.nguyen@example.com", "0987654321"),
    row("c", "Phạm Quốc Bảo", null, null),
  ];

  it("matches the same mailbox typed differently", () => {
    const matches = rankDuplicates(probeFor({ fullName: "Mai Tran", email: "tranthimai+cv@gmail.com" }), onFile);
    expect(matches.map((match) => match.id)).toEqual(["a"]);
    expect(matches[0].signals).toEqual(["email"]);
    expect(isCertainDuplicate(matches)).toBe(true);
  });

  it("matches the same number typed differently", () => {
    const matches = rankDuplicates(probeFor({ fullName: "Ai Đó Khác", phone: "+84 987 654 321" }), onFile);
    expect(matches.map((match) => match.id)).toEqual(["b"]);
    expect(matches[0].signals).toEqual(["phone"]);
  });

  // The decision this engine exists to defend, and the bug the first version had: an *identical*
  // name scores 1, so certainty must follow the signal rather than the number. There really are a
  // great many people called Nguyễn Văn An.
  it("reports a bare name match as uncertain even when the name is identical", () => {
    const matches = rankDuplicates(probeFor({ fullName: "Nguyễn Văn An", email: "other.an@example.com", phone: "0900000000" }), onFile);
    expect(matches.map((match) => match.id)).toEqual(["b"]);
    expect(matches[0].signals).toEqual(["name"]);
    expect(matches[0].score).toBe(1);
    expect(matches[0].certain).toBe(false);
    expect(isCertainDuplicate(matches)).toBe(false);
  });

  it("puts an identifier match above a name match", () => {
    const probe = probeFor({ fullName: "Phạm Quốc Bảo", email: "tran.thi.mai@gmail.com" });
    const matches = rankDuplicates(probe, onFile);
    expect(matches.map((match) => match.id)).toEqual(["a", "c"]);
    expect(matches[0].signals).toEqual(["email"]);
    expect(matches[1].signals).toEqual(["name"]);
  });

  it("finds nobody when nothing matches", () => {
    expect(rankDuplicates(probeFor({ fullName: "Lê Hoàng Yến", email: "yen@example.com", phone: "0933111222" }), onFile)).toEqual([]);
  });

  it("never matches on a null identifier meeting another null identifier", () => {
    const matches = rankDuplicates(probeFor({ fullName: "Ai Đó Hoàn Toàn Khác", email: null, phone: null }), onFile);
    expect(matches).toEqual([]);
  });

  // One letter apart is exactly the case a recruiter should be shown; a different person is not.
  it("keeps the threshold on the right side of a near miss and a different name", () => {
    expect(NAME_MATCH_THRESHOLD).toBeGreaterThan(0.8);
    expect(nameSimilarity("Lê Minh Quân", "Lê Minh Quang")).toBeGreaterThanOrEqual(NAME_MATCH_THRESHOLD);
    expect(nameSimilarity("Lê Minh Quân", "Lê Thu Hà")).toBeLessThan(NAME_MATCH_THRESHOLD);
  });
});
