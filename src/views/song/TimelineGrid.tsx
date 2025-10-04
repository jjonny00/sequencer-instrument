import type { ReactNode } from "react";

export interface TimelineGridRowLike {
  id: string | number;
}

export interface TimelineGridColumnLike {
  id: string | number;
}

export type TimelineGridProps<
  Row extends TimelineGridRowLike,
  Column extends TimelineGridColumnLike
> = {
  rows: Row[];
  columns: Column[];
  renderCell: (row: Row, col: Column) => ReactNode;
  renderRowHeader?: (row: Row) => ReactNode;
  renderColHeader?: (col: Column) => ReactNode;
  onAddRow?: () => void;
  onAddColumn?: () => void;
  renderRow?: (
    row: Row,
    columns: Column[],
    renderCell: (row: Row, col: Column) => ReactNode
  ) => ReactNode;
};

export function TimelineGrid<
  Row extends TimelineGridRowLike,
  Column extends TimelineGridColumnLike
>({
  rows,
  columns,
  renderCell,
  renderRowHeader,
  renderColHeader,
  onAddRow,
  onAddColumn,
  renderRow,
}: TimelineGridProps<Row, Column>) {
  return (
    <div
      className="w-full bg-[color:var(--card-bg,#1a1d25)]"
      style={{
        width: "100%",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        paddingLeft: "var(--hpad)",
        paddingRight: "var(--hpad)",
        boxSizing: "border-box",
      }}
    >
      {(renderColHeader || onAddColumn) && (
        <div className="flex items-center gap-2 mb-2">
          {columns.map((c) => (
            <div key={c.id} className="flex-1 min-w-[120px]">
              {renderColHeader?.(c)}
            </div>
          ))}
          {onAddColumn && <button onClick={onAddColumn}>+ Column</button>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {rows.map((r) =>
          renderRow ? (
            <div key={r.id} className="w-full">
              {renderRow(r, columns, renderCell)}
            </div>
          ) : (
            <div key={r.id} className="flex items-stretch gap-2">
              {renderRowHeader?.(r)}
              {columns.map((c) => (
                <div key={c.id} className="flex-1 min-w-[120px] bg-white/3">
                  {renderCell(r, c)}
                </div>
              ))}
            </div>
          )
        )}
        {onAddRow && <button onClick={onAddRow}>+ Row</button>}
      </div>
    </div>
  );
}
