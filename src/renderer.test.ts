import { describe, it, expect } from "vitest";
import { renderCallout, renderSkeleton, renderWithProse, upsertSection, matchSection, SECTION_HEADING } from "./renderer";

describe("renderCallout", () => {
  it("renders without stubs", () => {
    expect(renderCallout(24, "2026-06-17", 2, 0)).toBe(
      "> [!info] Filesystem snapshot\n> 24 items · surveyed 2026-06-17 · depth 2",
    );
  });
  it("singularizes and appends stubs", () => {
    expect(renderCallout(1, "2026-06-17", 2, 3)).toBe(
      "> [!info] Filesystem snapshot\n> 1 item · surveyed 2026-06-17 · depth 2 · 3 iCloud stubs",
    );
    expect(renderCallout(5, "2026-06-17", 1, 1)).toContain("· 1 iCloud stub");
  });
});

describe("matchSection", () => {
  const callout = renderCallout(2, "2026-07-05", 2, 0);
  const section = renderSkeleton(callout);

  it("returns the section text when present", () => {
    const body = "# Title\n\n" + section + "\nMore.\n";
    const matched = matchSection(body);
    expect(matched).toBeTruthy();
    expect(matched).toContain(SECTION_HEADING);
  });

  it("returns null when no section exists", () => {
    const body = "# Title\n\nJust some text\n";
    const matched = matchSection(body);
    expect(matched).toBeNull();
  });
});

describe("upsertSection", () => {
  const callout = renderCallout(2, "2026-07-05", 2, 0);
  const section = renderSkeleton(callout);

  it("inserts after the H1 when no section exists", () => {
    const body = "# Title\n\nSome prose.\n";
    const out = upsertSection(body, section);
    expect(out).toContain("# Title\n\n## Contents (Filesystem)");
    expect(out).toContain("Some prose.");
  });

  it("replaces an existing section in place and is idempotent", () => {
    const body = "# Title\n\n" + section + "\n## Other\n\nMore.\n";
    const once = upsertSection(body, renderWithProse(callout, "New prose."));
    const twice = upsertSection(once, renderWithProse(callout, "New prose."));
    expect(once).toBe(twice);
    expect(once).toContain("New prose.");
    expect(once).not.toContain("<!-- TODO: prose summary -->");
    expect(once).toContain("More.");
    expect(once).toContain("## Other");
  });

  it("stops at the next ## heading", () => {
    const body = "# T\n\n" + section + "\n## Next\n\nkeep me\n";
    const out = upsertSection(body, renderWithProse(callout, "P"));
    expect(out).toContain("## Next");
    expect(out).toContain("keep me");
  });

  it("replaces a hand-written multi-paragraph section and preserves the next ## heading", () => {
    const body = "# T\n\n## Contents (Filesystem)\n\nPara one.\n\nPara two.\n\n## Next\n\nkeep\n";
    const out = upsertSection(body, renderWithProse(callout, "New."));
    expect(out).toContain("New.");
    expect(out).toContain("## Next");
    expect(out).toContain("keep");
    expect(out).not.toContain("Para one.");
    expect(out.match(/## Contents \(Filesystem\)/g)!.length).toBe(1);
  });

  it("replaces a section at EOF without creating a duplicate", () => {
    const body = "# T\n\n## Contents (Filesystem)\n\nOld prose.\n";
    const out = upsertSection(body, renderWithProse(callout, "New."));
    expect(out).toContain("New.");
    expect(out).not.toContain("Old prose.");
    expect(out.match(/## Contents \(Filesystem\)/g)!.length).toBe(1);
    expect(out).toBe(upsertSection(out, renderWithProse(callout, "New."))); // idempotent
  });
});

describe("matchSection (extended)", () => {
  const callout = renderCallout(2, "2026-07-05", 2, 0);

  it("matchSection extracts a hand-written section body", () => {
    const body = "# T\n\n## Contents (Filesystem)\n\nPara one.\n\nPara two.\n\n## Next\n\nx\n";
    const s = matchSection(body)!;
    expect(s.startsWith("## Contents (Filesystem)")).toBe(true);
    expect(s).toContain("Para one.");
    expect(s).toContain("Para two.");
    expect(s).not.toContain("## Next");
    expect(matchSection("# no section here\n")).toBeNull();
  });
});
