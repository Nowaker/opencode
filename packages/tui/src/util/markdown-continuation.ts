/**
 * What a newline typed into a prompt inserts, with a little Markdown help:
 *
 * - On a numbered item (`1. `, `9) `) it starts the next number; on a bullet
 *   (`- `, `* `, `+ `, `- [x] `) the same bullet, a task box unchecked. The
 *   indent and the spacing after the marker carry over, and text after the
 *   caret moves into the new item. On an item with nothing in it the marker
 *   is removed instead, which is how a list ends.
 * - On a line that opens a code fence (```` ``` ````, with an info string or
 *   not, caret at its end) it adds an empty line and the closing fence below
 *   it, unless an odd number of fence lines follows the caret: one of those
 *   already closes this block, while an even number are blocks of their own.
 * - Inside a code block, and everywhere else, it is a plain newline.
 *
 * A port of opencode-tools `_lib/markdown-continuation`, which Vibeterm's own
 * prompt fields and Portal use; keep the two in step. The prompt textarea
 * applies it to its newline (`component/prompt/textarea.ts`).
 */

export interface TextWithCursor {
  readonly text: string;
  /** UTF-16 index into `text`. */
  readonly cursor: number;
}

const FENCE = /^(\s*)(```+)(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})([.)])(\s+)/;
const BULLET = /^(\s*)([-*+])(\s+)(\[[ xX]\]\s+)?/;

function isFence(line: string): boolean {
  return /^\s*```/.test(line);
}

function countFences(lines: readonly string[]): number {
  return lines.filter(isFence).length;
}

function insertAt(text: string, cursor: number, chunk: string, caretOffset = chunk.length): TextWithCursor {
  return { text: text.slice(0, cursor) + chunk + text.slice(cursor), cursor: cursor + caretOffset };
}

export function markdownNewline(text: string, cursor: number): TextWithCursor {
  const start = text.lastIndexOf("\n", cursor - 1) + 1;
  const endIndex = text.indexOf("\n", cursor);
  const end = endIndex === -1 ? text.length : endIndex;
  const before = text.slice(start, cursor);
  const after = text.slice(cursor, end);
  const plain = insertAt(text, cursor, "\n");

  const fencesBefore = countFences(text.slice(0, start).split("\n").slice(0, -1));
  const insideCode = fencesBefore % 2 === 1;

  const fence = FENCE.exec(before);
  if (fence && after.trim() === "") {
    if (insideCode) return plain;
    const fencesAfter = end < text.length ? countFences(text.slice(end + 1).split("\n")) : 0;
    if (fencesAfter % 2 === 1) return plain;
    const indent = fence[1] ?? "";
    return insertAt(text, cursor, `\n${indent}\n${indent}${fence[2]}`, 1 + indent.length);
  }
  if (insideCode) return plain;

  const numbered = NUMBERED.exec(before);
  const bullet = numbered ? null : BULLET.exec(before);
  const marker = numbered ?? bullet;
  if (!marker) return plain;

  if (text.slice(start + marker[0].length, end).trim() === "") {
    // An empty item ends the list: the marker goes, and no new line is added.
    return { text: text.slice(0, start) + text.slice(end), cursor: start };
  }
  const next = numbered
    ? `${numbered[1]}${Number(numbered[2]) + 1}${numbered[3]}${numbered[4]}`
    : `${bullet![1]}${bullet![2]}${bullet![3]}${bullet![4] ? "[ ] " : ""}`;
  return insertAt(text, cursor, `\n${next}`);
}
