import type { ReactNode } from "react";
import { Construction } from "lucide-react";

/**
 * Placeholder used by every Phase 0 screen. Renders the screen title so nav
 * is verifiable, plus a note about which build phase will flesh it out.
 */
export function PlaceholderPage({
  title,
  description,
  phase,
  children,
}: {
  title: string;
  description?: string;
  phase?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {children ?? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Construction className="size-6" />
          </div>
          <p className="text-sm font-medium">Screen scaffolded</p>
          <p className="max-w-md text-sm text-muted-foreground">
            This is a Phase 0 placeholder. {phase ? `Built out in ${phase}.` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
