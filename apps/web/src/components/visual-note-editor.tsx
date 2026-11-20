"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  imagePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  toolbarPlugin,
  markdownShortcutPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  InsertTable,
  realmPlugin,
  rootEditor$,
  createRootEditorSubscription$,
  linkDialogState$,
  addExportVisitor$,
} from "@mdxeditor/editor";
import {
  $getSelection,
  $getRoot,
  $createParagraphNode,
  $isRangeSelection,
  $isLineBreakNode,
  HISTORY_PUSH_TAG,
  UNDO_COMMAND,
  REDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import "@mdxeditor/editor/style.css";
import type { RichEditorHandle } from "./rich-editor";

const selectionBridge = realmPlugin<{
  id?: string;
  setEditor: (editor: LexicalEditor | null) => void;
}>({
  init(realm, params) {
    // Soft newlines are collapsed into paragraphs by MDXEditor's exporter.
    // Explicit Markdown breaks preserve every Enter through save/reopen.
    realm.pub(addExportVisitor$, {
      priority: 1,
      testLexicalNode: $isLineBreakNode,
      visitLexicalNode: ({ mdastParent, actions }) => {
        actions.appendToParent(mdastParent, { type: "break" });
      },
    });
    realm.sub(rootEditor$, (editor) => params?.setEditor(editor));
    realm.pub(createRootEditorSubscription$, (editor) => {
      const unregisterRoot = editor.registerRootListener((root) => {
        if (!root) return;
        if (params?.id) root.id = params.id;
        root.setAttribute("aria-label", "Review notes");
      });
      const doc = editor.getRootElement()?.ownerDocument ?? document;
      const dismissLinkDialog = (event: PointerEvent) => {
        if (realm.getValue(linkDialogState$).type === "inactive") return;
        if (
          event.target instanceof Element &&
          event.target.closest('[class*="linkDialogPopoverContent"]')
        )
          return;
        realm.pub(linkDialogState$, { type: "inactive" });
      };
      doc.addEventListener("pointerdown", dismissLinkDialog, true);
      return () => {
        unregisterRoot();
        doc.removeEventListener("pointerdown", dismissLinkDialog, true);
      };
    });
  },
});

export default function VisualNoteEditor({
  id,
  placeholder,
  value,
  onChange,
  editorRef,
}: {
  id?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  editorRef?: Ref<RichEditorHandle>;
}) {
  const editor = useRef<MDXEditorMethods>(null);
  const lexical = useRef<LexicalEditor | null>(null);
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(null);
  const attachOverlayContainer = useCallback((element: HTMLDivElement | null) => {
    // Escape scrollable editor panels, but keep overlays inside a modal's focus scope.
    setOverlayContainer(element?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, []);
  const [error, setError] = useState("");
  const current = useRef(value);
  // Link detection can normalize Markdown after mount. Only user edits may autosave it.
  const interacted = useRef(false);
  useImperativeHandle(editorRef, () => ({
    appendPlainText: (text) => {
      interacted.current = true;
      lexical.current?.update(
        () => {
          const root = $getRoot();
          if (root.getTextContent().length) root.append($createParagraphNode());
          root.selectEnd().insertRawText(text);
        },
        { discrete: true, tag: HISTORY_PUSH_TAG },
      );
    },
    focus: (position) =>
      editor.current?.focus(undefined, {
        defaultSelection: position === "end" ? "rootEnd" : "rootStart",
      }),
    undo: () => {
      lexical.current?.dispatchCommand(UNDO_COMMAND, undefined);
    },
    redo: () => {
      lexical.current?.dispatchCommand(REDO_COMMAND, undefined);
    },
    appendMarkdown: (markdown) => {
      if (error || !lexical.current) return;
      interacted.current = true;
      lexical.current.update(
        () => {
          const root = $getRoot();
          if (root.getTextContent().length) root.append($createParagraphNode());
          root.selectEnd();
          editor.current?.insertMarkdown(markdown);
        },
        { discrete: true, tag: HISTORY_PUSH_TAG },
      );
    },
  }));
  useEffect(() => {
    if (value !== current.current) {
      current.current = value;
      editor.current?.setMarkdown(value);
    }
  }, [value]);
  return (
    <div
      ref={attachOverlayContainer}
      onDragOverCapture={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "none";
        }
      }}
      onDropCapture={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDownCapture={(event) => {
        interacted.current = true;
        const target = lexical.current;
        if (
          event.key !== "Enter" ||
          event.nativeEvent.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          error ||
          event.target !== target?.getRootElement()
        )
          return;
        const plainParagraph = target.getEditorState().read(() => {
          const selection = $getSelection();
          return (
            $isRangeSelection(selection) &&
            selection.anchor.getNode().getTopLevelElement()?.getType() === "paragraph"
          );
        });
        if (plainParagraph) {
          event.preventDefault();
          event.stopPropagation();
          target.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) selection.insertLineBreak();
          });
        }
      }}
      onPasteCapture={() => {
        interacted.current = true;
      }}
      onCutCapture={() => {
        interacted.current = true;
      }}
      onInputCapture={() => {
        interacted.current = true;
      }}
      onPointerDownCapture={(event) => {
        if (
          (event.target as Element).closest(
            'button, [role="radio"], [role="checkbox"], [role="option"], [data-editor-block-type="image"]',
          )
        )
          interacted.current = true;
      }}
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          This note could not be loaded completely. The original text has not been changed. {error}
        </p>
      )}
      <MDXEditor
        ref={editor}
        overlayContainer={overlayContainer ?? undefined}
        markdown={value}
        placeholder={placeholder}
        className="notebook-visual-editor"
        contentEditableClassName="journal-markdown notebook-document"
        onError={({ error }) => setError(error)}
        readOnly={Boolean(error)}
        onChange={(markdown, initial) => {
          if (initial || error || !interacted.current) return;
          current.current = markdown;
          onChange(markdown);
        }}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          imagePlugin(),
          selectionBridge({
            id,
            setEditor: (editor) => {
              lexical.current = editor;
            },
          }),
          codeBlockPlugin(),
          codeMirrorPlugin({
            codeBlockLanguages: { "": "Plain text", js: "JavaScript", python: "Python" },
          }),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <BlockTypeSelect />
                <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
                <ListsToggle options={["bullet", "number", "check"]} />
                <CreateLink />
                <InsertTable />
              </>
            ),
          }),
        ]}
      />
    </div>
  );
}
