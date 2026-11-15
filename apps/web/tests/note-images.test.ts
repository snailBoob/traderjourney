import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/rich-editor";
import { attachmentMarkdown, attachmentReferences } from "../src/lib/note-attachments";

it("renders stored image dimensions while stripping executable HTML", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      children:
        '<img src="/api/attachments/image" alt="Chart" width="320" height="160" onerror="alert(1)" /><script>alert(2)</script>',
    }),
  );
  expect(html).toContain('src="/api/attachments/image"');
  expect(html).toContain('width="320"');
  expect(html).toContain('height="160"');
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("<script");
});

it("inserts hostile filenames as text, not extra links or HTML", () => {
  const markdown = attachmentMarkdown({
    id: "file",
    mime: "application/pdf",
    name: "[x](javascript:alert(1))<script>.pdf",
  });
  const html = renderToStaticMarkup(createElement(Markdown, { children: markdown }));
  expect(html).toContain('href="/api/attachments/file"');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain("<script");
  expect([
    ...attachmentReferences(markdown + '\n<img src="/api/attachments/pic_123" width="250" />'),
  ]).toEqual(["file", "pic_123"]);
});
