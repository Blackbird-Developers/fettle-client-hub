import { describe, expect, it } from "vitest";
import { isNameInList, normaliseName, pinnedRank } from "./nameLists";
import {
  type TherapistRow,
  accreditationLabel,
  blockedReason,
  calendarIdOf,
  consultationsOffered,
  findTherapist,
  isBookable,
  isSet,
  normaliseTag,
  servicesOffered,
  sessionTypeId,
  therapistTags,
} from "./therapists";

function row(overrides: Partial<TherapistRow> = {}): TherapistRow {
  return {
    id: 1,
    name: "Elaine O'Dwyer",
    url: "https://fettle.ie/our-therapists/elaine-o-dwyer",
    calendarid: "4567890",
    status: "active",
    tags: [],
    tags2: null,
    appointmentidindividual: "56122573",
    appointmentidcouples: null,
    appointmentidyouth: null,
    isPsychologist: null,
    ...overrides,
  };
}

describe("name lists", () => {
  it("ignores accents, apostrophes and case", () => {
    expect(normaliseName("Cara Bourke O’Shaughnessy")).toBe("cara bourke oshaughnessy");
    expect(isNameInList("ANA MOORE", ["Ana Moore"])).toBe(true);
    expect(isNameInList("Ána Moore", ["Ana Moore"])).toBe(true);
  });

  it("matches a longer name that starts with an entry, but not a different name", () => {
    expect(isNameInList("Ana Moore Byrne", ["Ana Moore"])).toBe(true);
    expect(isNameInList("Ana Moorehead", ["Ana Moore"])).toBe(false);
    expect(isNameInList("", ["Ana Moore"])).toBe(false);
  });

  it("ranks pinned therapists in order", () => {
    expect(pinnedRank("Lisa Kelly")).toBe(0);
    expect(pinnedRank("olivia fahy")).toBe(2);
    expect(pinnedRank("Someone Else")).toBe(-1);
  });
});

describe("isSet", () => {
  it("treats null, empty and the string NULL as empty", () => {
    expect(isSet(null)).toBe(false);
    expect(isSet(undefined)).toBe(false);
    expect(isSet("")).toBe(false);
    expect(isSet("  ")).toBe(false);
    expect(isSet("NULL")).toBe(false);
    expect(isSet("null")).toBe(false);
    expect(isSet("123")).toBe(true);
    expect(isSet(0)).toBe(true);
  });
});

describe("tags", () => {
  it("normalises the live variants", () => {
    expect(normaliseTag("self esteem,")).toBe("self-esteem");
    expect(normaliseTag(" Self Esteem ")).toBe("self-esteem");
    expect(normaliseTag("eating-disorders")).toBe("eating disorders");
    expect(normaliseTag("Anger  Management")).toBe("anger management");
  });

  it("reads tag1–tag5, tags[] and tags2", () => {
    const tags = therapistTags(
      row({ tag1: "Anxiety", tag3: "NULL", tags: ["Grief", ""], tags2: "couples, self esteem," })
    );
    expect([...tags].sort()).toEqual(["anxiety", "couples", "grief", "self-esteem"]);
  });
});

describe("servicesOffered", () => {
  it("offers individual when the type is set", () => {
    expect(servicesOffered(row())).toEqual(["individual"]);
    expect(servicesOffered(row({ appointmentidindividual: "NULL" }))).toEqual([]);
  });

  it("needs the couples tag for couples", () => {
    expect(servicesOffered(row({ appointmentidcouples: "35649630" }))).toEqual(["individual"]);
    expect(servicesOffered(row({ appointmentidcouples: "35649630", tags2: "couples" }))).toEqual([
      "individual",
      "couples",
    ]);
  });

  it("needs a youth or teen tag for youth, and respects the youth exclusion", () => {
    const youth = { appointmentidyouth: "50988945" };
    expect(servicesOffered(row({ ...youth }))).toEqual(["individual"]);
    expect(servicesOffered(row({ ...youth, tags: ["Teen"] }))).toEqual(["individual", "youth"]);
    expect(servicesOffered(row({ ...youth, tags: ["youth"], name: "Fergal Clancy" }))).toEqual(["individual"]);
  });

  it("drops types that aren't public when the public ids are given", () => {
    const publicIds = new Set(["111"]);
    expect(servicesOffered(row({ appointmentidindividual: "56122573" }), publicIds)).toEqual([]);
    expect(servicesOffered(row({ appointmentidindividual: 111 }), publicIds)).toEqual(["individual"]);
  });

  it("returns the therapist's own type id", () => {
    expect(sessionTypeId(row(), "individual")).toBe("56122573");
    expect(sessionTypeId(row(), "couples")).toBeNull();
  });
});

describe("consultationsOffered", () => {
  const psych = row({
    isPsychologist: "true",
    ocdAssessment: "92852936",
    anxietyAssessment: "92853020",
    depressionAssessment: "92853161",
  });

  it("lists the psychologist's consultations in display order", () => {
    expect(consultationsOffered(psych)).toEqual([
      { key: "depression", typeId: "92853161" },
      { key: "anxiety", typeId: "92853020" },
      { key: "ocd", typeId: "92852936" },
    ]);
  });

  it("accepts column name variants and psychologist flag variants", () => {
    const variant = { id: 2, name: "X", isPsychologist: "yes", OCD_Assessment: "92852936" } as unknown as TherapistRow;
    expect(consultationsOffered(variant)).toEqual([{ key: "ocd", typeId: "92852936" }]);
    expect(consultationsOffered(row({ isPsychologist: 1, ocdAssessment: "1" }))).toHaveLength(1);
  });

  it("is empty for therapists who aren't psychologists", () => {
    expect(consultationsOffered(row({ ocdAssessment: "92852936" }))).toEqual([]);
    expect(consultationsOffered(row({ isPsychologist: null, ocdAssessment: "92852936" }))).toEqual([]);
  });
});

describe("bookable", () => {
  it("needs an active, listed-for-booking therapist", () => {
    expect(isBookable(row())).toBe(true);
    expect(isBookable(row({ status: "inactive" }))).toBe(false);
    expect(isBookable(row({ name: "Ana Moore" }))).toBe(false);
    expect(isBookable(row({ name: "Janet Homan" }))).toBe(false);
    expect(isBookable(row({ name: "Emma Keane" }))).toBe(true);
  });

  it("gives the reason the intro blocks a therapist", () => {
    expect(blockedReason(row())).toBeNull();
    expect(blockedReason(row({ name: "Ana Moore" }))).toBe("not_accepting");
    expect(blockedReason(row({ appointmentidindividual: "" }))).toBe("no_services");
    expect(blockedReason(row({ isPsychologist: "true" }))).toBe("no_consultations");
  });
});

describe("findTherapist", () => {
  const rows = [
    row({ id: 7, name: "Elaine O'Dwyer", calendarid: "4567890" }),
    row({ id: 8, name: "Lisa Kelly", calendarid: "1234567", url: "https://fettle.ie/our-therapists/lisa-kelly/" }),
  ];

  it("finds by table id, then calendar id, then slug, then name", () => {
    expect(findTherapist("8", rows)?.name).toBe("Lisa Kelly");
    expect(findTherapist(4567890, rows)?.name).toBe("Elaine O'Dwyer");
    expect(findTherapist("lisa-kelly", rows)?.name).toBe("Lisa Kelly");
    expect(findTherapist("elaine odwyer", rows)?.name).toBe("Elaine O'Dwyer");
    expect(findTherapist("Lisa", rows)?.name).toBe("Lisa Kelly");
  });

  it("returns null for nothing or nobody", () => {
    expect(findTherapist(null, rows)).toBeNull();
    expect(findTherapist("  ", rows)).toBeNull();
    expect(findTherapist("nobody-here", rows)).toBeNull();
  });
});

describe("display helpers", () => {
  it("formats accreditation badges", () => {
    expect(accreditationLabel("APCPPre")).toBe("APCP Pre-Accredited");
    expect(accreditationLabel("PSI Full")).toBe("PSI Accredited");
    expect(accreditationLabel("IACPFul")).toBe("IACP Accredited");
    expect(accreditationLabel("")).toBeNull();
    expect(accreditationLabel("something")).toBeNull();
  });

  it("reads the calendar id as a number", () => {
    expect(calendarIdOf(row({ calendarid: " 4567890 " }))).toBe(4567890);
    expect(calendarIdOf(row({ calendarid: "NULL" }))).toBeNull();
  });
});
