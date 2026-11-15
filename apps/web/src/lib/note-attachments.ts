export interface NoteAttachment {
  id: string;
  name: string;
  mime: string;
}

export function attachmentReferences(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/\/api\/attachments\/([A-Za-z0-9_-]+)/g)].map((match) => match[1]!),
  );
}

export function attachmentMarkdown(attachment: NoteAttachment): string {
  const name = attachment.name.replace(/[\\[\]`*_<>]/g, "\\$&").replace(/[\r\n]+/g, " ");
  const link = `[${name}](/api/attachments/${encodeURIComponent(attachment.id)})`;
  return attachment.mime.startsWith("image/") ? `!${link}` : link;
}

export interface AttachmentCleanup {
  ids: string[];
  content: string;
}
