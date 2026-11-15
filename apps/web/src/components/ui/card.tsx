import * as React from "react";
import { cn } from "@/lib/utils";
import { CardTitleDragHandleContext } from "../card-drag-context";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "card-sheen min-w-0 rounded-xl border border-border/70 bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("min-w-0 flex flex-col space-y-1 p-4 pb-2", className)}
      {...props}
    />
  );
}

function CardTitle({ className, children, ...props }: React.ComponentProps<"div">) {
  const dragHandle = React.useContext(CardTitleDragHandleContext);
  const parts = React.Children.toArray(children);
  const content =
    dragHandle && parts.length > 0 ? [parts[0], dragHandle, ...parts.slice(1)] : parts;
  return (
    <div
      className={cn(
        "min-w-0 flex items-center gap-1.5 break-words text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {content}
    </div>
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0 p-4 pt-2", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardContent };
