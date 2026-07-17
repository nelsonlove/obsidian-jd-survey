import { describe, it, expect } from "vitest";
import {
  renderCallout, renderSkeleton, renderWithProse, upsertSection, matchSection,
  SECTION_HEADING, renderEmbed, SNAPSHOT_CALLOUT_MARKER,
  replaceSnapshotCallout, sectionHasEmbedFence, sectionHasProse,
} from "./renderer";

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

describe("renderEmbed", () => {
  it("builds an EmbedRelativeTo icloud folder block (default virtual dir)", () => {
    expect(renderEmbed("10-19 Personal/13 Health & medical/13.22 Imaging")).toBe(
      "```EmbedRelativeTo\nicloud://10-19 Personal/13 Health & medical/13.22 Imaging/#\n```",
    );
  });
  it("honors a custom virtual directory name", () => {
    expect(renderEmbed("A/B", "docs")).toBe(
      "```EmbedRelativeTo\ndocs://A/B/#\n```",
    );
  });
});

describe("sectionHasProse", () => {
  const callout = renderCallout(2, "2026-07-05", 2, 0);
  const embed = renderEmbed("A/B");

  it("is true when the section has real prose", () => {
    expect(sectionHasProse(renderWithProse(callout, "Two files: taxes.", embed))).toBe(true);
  });
  it("is false for a skeleton-only section (callout + placeholder + embed)", () => {
    expect(sectionHasProse(renderSkeleton(callout, embed))).toBe(false);
  });
  it("is false for callout + embed with nothing else", () => {
    const section = `${SECTION_HEADING}\n\n${callout}\n\n${embed}\n`;
    expect(sectionHasProse(section)).toBe(false);
  });
  it("is false for a bare heading", () => {
    expect(sectionHasProse(`${SECTION_HEADING}\n`)).toBe(false);
  });
  it("counts a non-snapshot callout as prose", () => {
    const section = `${SECTION_HEADING}\n\n> [!warning] Do not touch\n> hand-authored\n`;
    expect(sectionHasProse(section)).toBe(true);
  });
});

describe("sectionHasEmbedFence", () => {
  it("is true when an EmbedRelativeTo fence is present anywhere", () => {
    const section = `${SECTION_HEADING}\n\nProse.\n\n\`\`\`EmbedRelativeTo\nicloud://A/B/#\n\`\`\`\n`;
    expect(sectionHasEmbedFence(section)).toBe(true);
  });
  it("is false when there is no EmbedRelativeTo fence", () => {
    const section = `${SECTION_HEADING}\n\nProse.\n\n\`\`\`bash\necho hi\n\`\`\`\n`;
    expect(sectionHasEmbedFence(section)).toBe(false);
  });
});

describe("replaceSnapshotCallout", () => {
  const fresh = renderCallout(9, "2026-07-17", 2, 0);

  it("replaces exactly the snapshot callout block, leaving other blockquotes alone", () => {
    const old = renderCallout(2, "2026-01-01", 2, 0);
    const section =
      `${SECTION_HEADING}\n\n${old}\n\n> [!warning] Keep me\n> human note\n\nProse here.\n`;
    const out = replaceSnapshotCallout(section, fresh);
    expect(out).toContain("9 items");
    expect(out).not.toContain("2 items");
    expect(out).toContain("> [!warning] Keep me\n> human note");
    expect(out).toContain("Prose here.");
  });

  it("inserts the fresh callout after the heading when no snapshot callout exists", () => {
    const section = `${SECTION_HEADING}\n\n> [!note] Human callout\n> text\n\nProse.\n`;
    const out = replaceSnapshotCallout(section, fresh);
    // Human callout untouched
    expect(out).toContain("> [!note] Human callout\n> text");
    // Fresh callout inserted right after the heading, before the human callout
    expect(out.indexOf(SNAPSHOT_CALLOUT_MARKER)).toBeLessThan(out.indexOf("[!note] Human callout"));
    expect(out).toContain("9 items");
  });
});

describe("renderWithProse + embed", () => {
  const callout = renderCallout(2, "2026-07-16", 2, 0);
  it("appends the embed after the prose when given", () => {
    const embed = renderEmbed("A/B");
    const out = renderWithProse(callout, "Two items.", embed);
    expect(out).toBe(
      "## Contents (Filesystem)\n\n" + callout + "\n\nTwo items.\n\n" + embed + "\n",
    );
  });
  it("omits the embed when not given (unchanged behavior)", () => {
    expect(renderWithProse(callout, "Two items.")).toBe(
      "## Contents (Filesystem)\n\n" + callout + "\n\nTwo items.\n",
    );
  });
});

describe("renderSkeleton + embed", () => {
  const callout = renderCallout(0, "2026-07-16", 2, 0);
  it("appends the embed after the placeholder when given", () => {
    const embed = renderEmbed("A/B");
    const out = renderSkeleton(callout, embed);
    expect(out).toContain("<!-- TODO: prose summary -->\n\n" + embed + "\n");
  });
});
