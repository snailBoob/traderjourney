import type { ExcursionView } from "@/lib/excursions";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function ExcursionCell({ value }: { value?: ExcursionView }) {
  const text =
    value?.maeR != null && value.mfeR != null
      ? `${value.maeR.toFixed(2)} / ${value.mfeR.toFixed(2)}`
      : "— / —";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="tnum whitespace-nowrap" aria-label={`MAE/MFE: ${text}`}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {value?.reason ?? "MAE/MFE is unavailable."}
      </TooltipContent>
    </Tooltip>
  );
}
