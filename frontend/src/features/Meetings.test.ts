import { expect, it } from "vitest";
import { notesMarkdown } from "./Meetings";
it("exports actual notes and explicitly labels missing owner and deadline", () => {
  const output = notesMarkdown("Design review", {
    summary: "Review the design.",
    key_points: [],
    concepts: [],
    decisions: [],
    action_items: [
      {
        description: "Review",
        owner: null,
        deadline: null,
        status: "open",
        evidence: "Review the design",
      },
    ],
    open_questions: ["When?"],
    follow_up_topics: [],
    uncertainties: [],
  });
  expect(output).toContain("# Design review");
  expect(output).toContain("Owner: Unassigned");
  expect(output).toContain("deadline: Not stated");
  expect(output).toContain("When?");
  expect(output).toContain("Evidence: “Review the design”");
});
