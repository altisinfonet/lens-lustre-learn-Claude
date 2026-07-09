/**
 * AdminTable — Phase 4 slice (additive). Thin wrapper around shadcn <Table>
 * with admin-density defaults (compact rows, sticky header, token borders).
 * No behavior. Existing pages NOT migrated yet.
 */
// @phase: phase-4-slice-ui
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface AdminTableColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  className?: string;
  headClassName?: string;
}

interface AdminTableProps<T> {
  columns: AdminTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: React.ReactNode;
  className?: string;
}

export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  empty = "No records.",
  className,
}: AdminTableProps<T>) {
  return (
    <div className={cn("rounded-md border border-border bg-card overflow-hidden", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            {columns.map((c) => (
              <TableHead
                key={c.key}
                className={cn("h-9 text-xs font-medium text-muted-foreground", c.headClassName)}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-16 text-center text-xs text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow key={rowKey(row, i)} className="hover:bg-muted/30">
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn("py-2 text-xs", c.className)}>
                    {c.cell(row, i)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default AdminTable;
