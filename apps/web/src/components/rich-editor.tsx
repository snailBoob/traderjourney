"use client";
import {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
const VisualNoteEditor = dynamic(() => import("./visual-note-editor"), { ssr: false });
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/** Render a single source newline as a visible line break; blank lines remain paragraph breaks. */
function remarkSingleLineBreaks() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (!Array.isArray(node?.children)) return;
      const next: any[] = [];
      for (const child of node.children) {
        if (
          child.type === "text" &&
          typeof child.value === "string" &&
          child.value.includes("\n")
        ) {
          const lines = child.value.split("\n");
          lines.forEach((line: string, index: number) => {
            if (line) next.push({ ...child, value: line });
            if (index < lines.length - 1) next.push({ type: "break" });
          });
        } else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, FileText, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { fieldClass } from "@/components/filter-fields";
import { VoiceNote } from "@/components/voice-note";
import { postJson, useApi } from "@/lib/use-api";
import { formatInlineSelection, remarkRepairSpacedEmphasis } from "@/lib/note-formatting";
import { tradeLinkLabel, tradeMarkdownLink, type LinkableTrade } from "@/lib/trade-links";
export function Markdown({ children }: { children: string }) {
  return (
    <div className="journal-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkRepairSpacedEmphasis, remarkSingleLineBreaks]}
        rehypePlugins={[
          rehypeRaw,
          [
            rehypeSanitize,
            {
              ...defaultSchema,
              attributes: {
                ...defaultSchema.attributes,
                img: [...(defaultSchema.attributes?.img ?? []), "width", "height"],
              },
            },
          ],
        ]}
        components={{
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) =>
            href?.startsWith("/trades/") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href}>{children}</a>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
const BUILT_INS = [
  {
    id: "pre",
    name: "Pre-market plan",
    content:
      "## Market context\n\n## Setups to watch\n\n## Risk limits\n- [ ] Confirm daily risk limit\n- [ ] Check scheduled events\n\n## My intention\n",
    scopes: ["journal"],
  },
  {
    id: "review",
    name: "Trade review",
    content: "## Setup and thesis\n\n## Execution\n\n## What worked\n\n## What I will change\n",
    scopes: ["trade", "missed"],
  },
  {
    id: "weekly",
    name: "Weekly review",
    content:
      "## Wins this week\n\n## Repeated mistakes\n\n## Rules I followed\n\n## One improvement for next week\n",
    scopes: ["journal"],
  },
];

const TEMPLATE_SCOPE_OPTIONS = [
  ["journal", "Daily Journal"],
  ["trade", "Trade Notes"],
  ["missed", "Missed Trades"],
  ["notebook", "Notebook"],
] as const;
function TemplateScopePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const labels = new Map<string, string>([["all", "Everywhere"], ...TEMPLATE_SCOPE_OPTIONS]);
  const selectedLabel = value.includes("all")
    ? "Everywhere"
    : value.length === 0
      ? "Choose locations"
      : value.length === 1
        ? (labels.get(value[0]!) ?? "Choose locations")
        : `${value.length} locations`;
  const toggle = (id: string) => {
    if (id === "all") {
      onChange(value.includes("all") ? [] : ["all"]);
      return;
    }
    const next = value.filter((item) => item !== "all");
    onChange(next.includes(id) ? next.filter((item) => item !== id) : [...next, id]);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between rounded-lg font-normal"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
      >
        <DropdownMenuCheckboxItem
          checked={value.includes("all")}
          className="pl-2.5 pr-8"
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={() => toggle("all")}
        >
          {value.includes("all") && <Check className="absolute right-2.5 size-4" />}Everywhere
        </DropdownMenuCheckboxItem>
        {TEMPLATE_SCOPE_OPTIONS.map(([id, label]) => (
          <DropdownMenuCheckboxItem
            key={id}
            checked={value.includes(id)}
            disabled={value.includes("all")}
            className="pl-2.5 pr-8"
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggle(id)}
          >
            {value.includes(id) && <Check className="absolute right-2.5 size-4" />}
            {label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface RichEditorHandle {
  focus(position?: "start" | "end"): void;
  appendMarkdown?(markdown: string): void;
  appendPlainText?(text: string): void;
  undo?(): void;
  redo?(): void;
}
export function RichEditor({
  id,
  value,
  onChange,
  placeholder = "Write your review…",
  defaultMode,
  mode,
  onModeChange,
  showModeToggle = true,
  editorRef,
  templateScope,
  showTemplateTools = true,
  showTradeLink = true,
  showDictate = false,
  compact = false,
  closeOnBlur = false,
  visual = false,
  toolbarAfterTemplates,
  toolbarEnd,
  toolbarStart,
  toolbarClassName = "",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  defaultMode?: "preview" | "edit";
  mode?: "preview" | "edit";
  onModeChange?: (mode: "preview" | "edit") => void;
  showModeToggle?: boolean;
  editorRef?: Ref<RichEditorHandle>;
  templateScope?: "journal" | "notebook" | "trade" | "missed";
  showTemplateTools?: boolean;
  showTradeLink?: boolean;
  showDictate?: boolean;
  compact?: boolean;
  closeOnBlur?: boolean;
  visual?: boolean;
  toolbarAfterTemplates?: ReactNode;
  toolbarEnd?: ReactNode;
  toolbarStart?: ReactNode;
  toolbarClassName?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null),
    [localPreview, setLocalPreview] = useState(() =>
      defaultMode ? defaultMode === "preview" : Boolean(value.trim()),
    ),
    [error, setError] = useState("");
  const visualRef = useRef<RichEditorHandle>(null);
  const pendingFocus = useRef<{ position?: "start" | "end" } | null>(null);
  const attachVisualEditor = useCallback((handle: RichEditorHandle | null) => {
    visualRef.current = handle;
    if (handle && pendingFocus.current) {
      const { position } = pendingFocus.current;
      pendingFocus.current = null;
      handle.focus(position);
    }
  }, []);
  const templateInserted = useRef(false);
  const preview = !visual && (mode ? mode === "preview" : localPreview);
  const setPreview = (next: boolean) => {
    setLocalPreview(next);
    onModeChange?.(next ? "preview" : "edit");
  };
  useImperativeHandle(editorRef, () => ({
    appendPlainText: (text) => visualRef.current?.appendPlainText?.(text),
    focus(position) {
      if (visual) {
        if (visualRef.current) visualRef.current.focus(position);
        else pendingFocus.current = { position };
        return;
      }
      setPreview(false);
      requestAnimationFrame(() => {
        ref.current?.focus();
        const offset = position === "start" ? 0 : value.length;
        ref.current?.setSelectionRange(offset, offset);
      });
    },
  }));
  const { data, refresh } = useApi<{
    templates: { id: string; name: string; content: string; scopesJson: string }[];
  }>(`/api/workspace/templates${templateScope ? `?scope=${templateScope}` : ""}`);
  const [linkOpen, setLinkOpen] = useState(false),
    [search, setSearch] = useState(""),
    [editingTemplateId, setEditingTemplateId] = useState<string | null>(null),
    [editingTemplateName, setEditingTemplateName] = useState(""),
    [editingTemplateContent, setEditingTemplateContent] = useState(""),
    [editingTemplateScopes, setEditingTemplateScopes] = useState<string[]>([]),
    [editTemplateOpen, setEditTemplateOpen] = useState(false),
    [deleteTemplate, setDeleteTemplate] = useState<{ id: string; name: string } | null>(null),
    [saveTemplateOpen, setSaveTemplateOpen] = useState(false),
    [saveTemplateName, setSaveTemplateName] = useState(""),
    [saveTemplateScopes, setSaveTemplateScopes] = useState<string[]>(
      templateScope ? [templateScope] : ["all"],
    );
  const {
    data: trades,
    error: tradeError,
    loading: tradesLoading,
  } = useApi<{
    trades: LinkableTrade[];
    hasMore: boolean;
  }>(linkOpen ? `/api/trades/lookup?q=${encodeURIComponent(search)}` : null);
  function insert(before: string, after = "") {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length,
      end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end));
    setPreview(false);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(start + before.length, end + before.length);
    });
  }
  function formatInline(marker: "*" | "**") {
    const next = formatInlineSelection(
      value,
      ref.current?.selectionStart ?? value.length,
      ref.current?.selectionEnd ?? value.length,
      marker,
    );
    onChange(next.value);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }
  const linkTools = (
    <>
      {showTradeLink && (
        <Button
          type="button"
          size="sm"
          variant={visual ? "outline" : "ghost"}
          onClick={() => setLinkOpen(!linkOpen)}
        >
          Link trade
        </Button>
      )}
      {showDictate && (
        <div className="ml-auto shrink-0">
          <VoiceNote
            onPrepare={() => {
              setPreview(false);
              if (visual) visualRef.current?.focus();
              else ref.current?.focus();
            }}
            onText={(text) => {
              if (visual) {
                visualRef.current?.appendMarkdown?.(text);
                return;
              }
              const next = value ? `${value} ${text}` : text;
              onChange(next);
              requestAnimationFrame(() => ref.current?.focus());
            }}
          />
        </div>
      )}
    </>
  );
  return (
    <div
      className="space-y-2 min-w-0"
      onKeyDownCapture={(event) => {
        if (
          !visual ||
          !(event.metaKey || event.ctrlKey) ||
          event.altKey ||
          event.key.toLowerCase() !== "z"
        )
          return;
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) visualRef.current?.redo?.();
        else visualRef.current?.undo?.();
      }}
    >
      <div
        className={
          visual
            ? `notebook-actions flex items-center gap-2 overflow-x-auto ${toolbarClassName}`
            : "space-y-1"
        }
      >
        {!preview && (
          <>
            {visual && toolbarStart}
            {!visual && (
              <div className="flex flex-nowrap items-center gap-1 overflow-x-auto">
                {!visual && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => formatInline("**")}
                      aria-label="Bold"
                    >
                      B
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => formatInline("*")}
                      aria-label="Italic"
                    >
                      <i>I</i>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => insert("\n## ")}
                      aria-label="Heading"
                    >
                      H2
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => insert("\n- ")}
                      aria-label="Bullet list"
                    >
                      List
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => insert("\n- [ ] ")}
                      aria-label="Checklist"
                    >
                      Checklist
                    </Button>
                  </>
                )}
                {linkTools}
              </div>
            )}
            {showTemplateTools && (
              <div
                className={
                  visual ? "contents" : "flex flex-nowrap items-center gap-1 overflow-x-auto"
                }
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label="Insert note template"
                      className={visual ? "gap-2" : "gap-2 rounded-lg"}
                    >
                      {visual ? "Insert template" : "Insert template…"}
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    aria-label="Note templates"
                    onCloseAutoFocus={(event) => {
                      if (visual && templateInserted.current) {
                        event.preventDefault();
                        templateInserted.current = false;
                        visualRef.current?.focus();
                      }
                    }}
                  >
                    {[
                      ...BUILT_INS.filter(
                        (template) => !templateScope || template.scopes.includes(templateScope),
                      ),
                      ...(data?.templates ?? []),
                    ].map((template) => {
                      const isBuiltIn = BUILT_INS.some((builtIn) => builtIn.id === template.id);
                      return (
                        <div
                          key={template.id}
                          className="group relative flex items-center gap-1 rounded-md hover:bg-muted"
                        >
                          <DropdownMenuItem
                            className="min-w-0 flex-1 bg-transparent hover:bg-transparent focus:bg-transparent data-[highlighted]:bg-transparent"
                            onSelect={() => {
                              if (visual) {
                                templateInserted.current = true;
                                visualRef.current?.appendMarkdown?.(template.content);
                              } else onChange(value + (value ? "\n\n" : "") + template.content);
                            }}
                          >
                            <FileText
                              aria-hidden="true"
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">{template.name}</span>
                          </DropdownMenuItem>
                          {!isBuiltIn && (
                            <>
                              <button
                                type="button"
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`Edit template ${template.name}`}
                                title="Edit template"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  let scopes = ["all"];
                                  if ("scopesJson" in template) {
                                    try {
                                      scopes = JSON.parse(template.scopesJson) as string[];
                                    } catch {}
                                  }
                                  setEditingTemplateId(template.id);
                                  setEditingTemplateName(template.name);
                                  setEditingTemplateContent(template.content);
                                  setEditingTemplateScopes(scopes);
                                  setEditTemplateOpen(true);
                                }}
                              >
                                <Pencil aria-hidden="true" className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground hover:bg-background/70 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`Delete template ${template.name}`}
                                title="Delete template"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setDeleteTemplate({ id: template.id, name: template.name });
                                }}
                              >
                                <Trash2 aria-hidden="true" className="size-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type="button"
                  size="sm"
                  variant={visual ? "outline" : "ghost"}
                  disabled={!value}
                  onClick={() => {
                    setSaveTemplateName("");
                    setSaveTemplateScopes(templateScope ? [templateScope] : ["all"]);
                    setSaveTemplateOpen(true);
                  }}
                >
                  Save template
                </Button>
              </div>
            )}
            {visual && (
              <>
                {toolbarAfterTemplates}
                {linkTools}
                {toolbarEnd}
              </>
            )}
          </>
        )}
      </div>
      {linkOpen && !preview && (
        <div className="space-y-2 rounded-md border p-2">
          <input
            aria-label="Find trade by symbol, date or account"
            placeholder="Search symbol, date or account"
            className={fieldClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-40 overflow-y-auto">
            {tradesLoading && (
              <p role="status" className="text-xs text-muted-foreground">
                Loading trades…
              </p>
            )}
            {tradeError && (
              <p role="alert" className="text-xs text-destructive">
                {tradeError}
              </p>
            )}
            {!tradesLoading &&
              !tradeError &&
              trades?.trades.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="block w-full rounded p-1 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    if (visual) visualRef.current?.appendMarkdown?.(tradeMarkdownLink(t));
                    else onChange(value + `\n${tradeMarkdownLink(t)}\n`);
                    setLinkOpen(false);
                    setPreview(true);
                  }}
                >
                  {tradeLinkLabel(t)}
                </button>
              ))}
            {!tradesLoading && !tradeError && trades?.trades.length === 0 && (
              <p className="text-xs text-muted-foreground">No matching trades.</p>
            )}
            {!tradesLoading && !tradeError && trades?.hasMore && (
              <p className="text-xs text-muted-foreground">
                Showing the latest 50 matches. Search by date or account to find older trades.
              </p>
            )}
          </div>
        </div>
      )}
      {visual ? (
        <div
          className={
            templateScope && templateScope !== "notebook"
              ? "visual-editor-field rounded-md border border-input"
              : undefined
          }
        >
          <VisualNoteEditor
            id={id}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            editorRef={attachVisualEditor}
          />
        </div>
      ) : preview ? (
        <div
          className={`${compact ? "min-h-32" : "min-h-40"} rounded-md border p-3 ${!value.trim() ? "cursor-text" : ""}`}
          onClick={() => {
            setPreview(false);
            requestAnimationFrame(() => {
              ref.current?.focus();
              ref.current?.setSelectionRange(value.length, value.length);
            });
          }}
          onKeyDown={(event) => {
            if (value.trim() || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            setPreview(false);
            requestAnimationFrame(() => {
              ref.current?.focus();
              ref.current?.setSelectionRange(value.length, value.length);
            });
          }}
          tabIndex={value.trim() ? undefined : 0}
          role={value.trim() ? undefined : "button"}
          aria-label={value.trim() ? undefined : "Edit empty text field"}
        >
          <Markdown>{value || "Nothing written yet."}</Markdown>
        </div>
      ) : (
        <textarea
          id={id}
          ref={ref}
          aria-label="Review notes"
          className={`${fieldClass} ${compact ? "min-h-32" : "min-h-48"} resize-y font-mono text-[13px]`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (closeOnBlur) setPreview(true);
          }}
          placeholder={placeholder}
        />
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog open={editTemplateOpen} onOpenChange={setEditTemplateOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit template</DialogTitle>
            <DialogDescription>
              Edit the template name, content and where it is available.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-2 text-sm">
              <span>Template name</span>
              <input
                className={fieldClass}
                value={editingTemplateName}
                maxLength={100}
                onChange={(e) => setEditingTemplateName(e.target.value)}
              />
            </label>
            <div className="space-y-2">
              <span className="text-sm">Content</span>
              <RichEditor
                visual={visual}
                value={editingTemplateContent}
                onChange={setEditingTemplateContent}
                mode="edit"
                showModeToggle={false}
                showTemplateTools={false}
              />
            </div>
            <div className="space-y-2">
              <span className="text-sm">Available in</span>
              <TemplateScopePicker
                value={editingTemplateScopes}
                onChange={setEditingTemplateScopes}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditTemplateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  !editingTemplateName.trim() ||
                  !editingTemplateContent.trim() ||
                  editingTemplateScopes.length === 0 ||
                  !editingTemplateId
                }
                onClick={async () => {
                  if (
                    !editingTemplateId ||
                    !editingTemplateName.trim() ||
                    !editingTemplateContent.trim() ||
                    editingTemplateScopes.length === 0
                  )
                    return;
                  try {
                    await postJson(
                      "/api/workspace/templates",
                      {
                        id: editingTemplateId,
                        name: editingTemplateName.trim(),
                        content: editingTemplateContent,
                        scopes: editingTemplateScopes,
                      },
                      "PATCH",
                    );
                    setEditTemplateOpen(false);
                    setEditingTemplateId(null);
                    refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteTemplate !== null}
        onOpenChange={(open) => !open && setDeleteTemplate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>
              This will permanently delete “{deleteTemplate?.name}”.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteTemplate(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (!deleteTemplate) return;
                try {
                  await postJson("/api/workspace/templates", { id: deleteTemplate.id }, "DELETE");
                  setDeleteTemplate(null);
                  refresh();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {saveTemplateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-template-title"
        >
          <div className="w-full max-w-sm rounded-lg border bg-background p-4 shadow-lg">
            <h2 id="save-template-title" className="text-sm font-semibold">
              Save template
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Give this template a name.</p>
            <input
              autoFocus
              aria-label="Template name"
              className={`${fieldClass} mt-3`}
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSaveTemplateOpen(false);
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit?.() ?? undefined;
                }
              }}
              placeholder="Template name"
            />
            <div className="mt-4 space-y-2">
              <span className="text-xs font-medium">Available in</span>
              <TemplateScopePicker value={saveTemplateScopes} onChange={setSaveTemplateScopes} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSaveTemplateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!saveTemplateName.trim() || saveTemplateScopes.length === 0}
                onClick={async () => {
                  const name = saveTemplateName.trim();
                  if (!name) return;
                  try {
                    await postJson("/api/workspace/templates", {
                      name,
                      content: value,
                      scopes: saveTemplateScopes,
                    });
                    setSaveTemplateOpen(false);
                    setSaveTemplateName("");
                    refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
