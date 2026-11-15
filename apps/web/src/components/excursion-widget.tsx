import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { HelpHint } from "./ui/tooltip";
import { EXCURSION_METHOD, type ExcursionSummary } from "@/lib/excursions";

export function ExcursionWidget({ value }: { value: ExcursionSummary }) {
  const format = (number: number | null) => (number == null ? "—" : `${number.toFixed(2)}R`);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          MAE/MFE{" "}
          <HelpHint heading="MAE/MFE">
            <span className="whitespace-pre-line">{EXCURSION_METHOD}</span>
          </HelpHint>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-6">
          <div>
            <dt className="text-sm text-muted-foreground">Average MAE</dt>
            <dd className="tnum mt-1 text-2xl font-semibold">{format(value.maeR)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Average MFE</dt>
            <dd className="tnum mt-1 text-2xl font-semibold">{format(value.mfeR)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Average realized R</dt>
            <dd className="tnum mt-1 text-2xl font-semibold">{format(value.realizedR)}</dd>
            <p className="mt-1 text-sm text-muted-foreground">Before costs</p>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">MAE · winners</dt>
            <dd className="tnum mt-1 text-2xl font-semibold">{format(value.winnerMaeR)}</dd>
            <p className="mt-1 text-sm text-muted-foreground">Average · {value.winners} trades</p>
          </div>
        </dl>
        <p className="mt-auto text-sm text-muted-foreground">
          Calculated for {value.covered} of {value.total} closed trades
        </p>
        {value.covered === 0 && (
          <p className="text-sm text-muted-foreground">
            Requires an original SL and complete price history.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
