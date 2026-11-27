import { describe, expect, it } from "bun:test";
import { markdownNewline } from "../../src/util/markdown-continuation"

/** `|` marks the caret in both the input and the expected result. */
function enter(marked: string): string {
  const cursor = marked.indexOf("|");
  const next = markdownNewline(marked.slice(0, cursor) + marked.slice(cursor + 1), cursor);
  return next.text.slice(0, next.cursor) + "|" + next.text.slice(next.cursor);
}

describe("numbered lists", () => {
  it("continues with the next number", () => {
    expect(enter("1. first|")).toBe("1. first\n2. |");
    expect(enter("intro\n9) ninth|")).toBe("intro\n9) ninth\n10) |");
  });

  it("keeps the indent and the spacing after the marker", () => {
    expect(enter("  3.  nested|")).toBe("  3.  nested\n  4.  |");
  });

  it("moves the text after the caret into the new item", () => {
    expect(enter("1. ab|cd")).toBe("1. ab\n2. |cd");
  });

  it("ends the list on an empty item instead of adding another", () => {
    expect(enter("1. one\n2. |")).toBe("1. one\n|");
  });

  it("inserts a plain newline when the caret is inside the marker", () => {
    expect(enter("1|. one")).toBe("1\n|. one");
  });
});

describe("bullets", () => {
  it("continues with the same bullet", () => {
    expect(enter("- one|")).toBe("- one\n- |");
    expect(enter("* one|")).toBe("* one\n* |");
    expect(enter("  + one|")).toBe("  + one\n  + |");
  });

  it("continues a task list with an unchecked box", () => {
    expect(enter("- [x] done|")).toBe("- [x] done\n- [ ] |");
  });

  it("ends the list on an empty bullet", () => {
    expect(enter("- one\n  - |")).toBe("- one\n|");
  });

  it("leaves a horizontal rule and plain text alone", () => {
    expect(enter("---|")).toBe("---\n|");
    expect(enter("plain|")).toBe("plain\n|");
    expect(enter("-not a bullet|")).toBe("-not a bullet\n|");
  });
});

describe("code fences", () => {
  it("adds the closing fence below a new empty line", () => {
    expect(enter("```|")).toBe("```\n|\n```");
    expect(enter("text\n```ts|")).toBe("text\n```ts\n|\n```");
  });

  it("keeps the fence's indent", () => {
    expect(enter("  ```|")).toBe("  ```\n  |\n  ```");
  });

  it("adds no closer when an odd number of fences follows: one of them closes it", () => {
    expect(enter("```|\ncode\n```")).toBe("```\n|\ncode\n```");
    expect(enter("```|\n```\n```\n```")).toBe("```\n|\n```\n```\n```");
  });

  it("adds a closer when an even number follows: those are a block of their own", () => {
    expect(enter("```|\n\n```\nother\n```")).toBe("```\n|\n```\n\n```\nother\n```");
  });

  it("adds nothing after a closing fence", () => {
    expect(enter("```\ncode\n```|")).toBe("```\ncode\n```\n|");
  });

  it("adds nothing when text follows the caret on the fence line", () => {
    expect(enter("``|`")).toBe("``\n|`");
  });

  it("continues no list inside a code block", () => {
    expect(enter("```\n1. step|\n```")).toBe("```\n1. step\n|\n```");
    expect(enter("```\n- item|")).toBe("```\n- item\n|");
  });
});
