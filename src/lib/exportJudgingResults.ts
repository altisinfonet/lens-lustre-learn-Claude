interface ExportEntry {
  title: string;
  photographer_name: string | null;
  status: string;
  my_score: number | null;
  avg_score: number | null;
  vote_count: number;
  placement: string | null;
  tags: string[];
}

interface ExportRound {
  name: string;
}

export const exportJudgingCSV = (
  entries: ExportEntry[],
  round: ExportRound | null,
  competitionTitle: string
) => {
  const headers = [
    "Rank",
    "Title",
    "Photographer",
    "Status",
    "My Score",
    "Avg Score",
    "Public Votes",
    "Placement",
    "Tags",
  ];

  // Sort by avg score desc, then votes desc
  const sorted = [...entries].sort(
    (a, b) => (b.avg_score || 0) - (a.avg_score || 0) || b.vote_count - a.vote_count
  );

  const rows = sorted.map((entry, i) => [
    i + 1,
    `"${(entry.title || "").replace(/"/g, '""')}"`,
    `"${(entry.photographer_name || "Unknown").replace(/"/g, '""')}"`,
    entry.status,
    entry.my_score ?? "",
    entry.avg_score?.toFixed(1) ?? "",
    entry.vote_count,
    entry.placement || "",
    `"${entry.tags.join(", ")}"`,
  ]);

  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const roundLabel = round?.name || "All";
  const filename = `${competitionTitle}_${roundLabel}_results_${new Date().toISOString().slice(0, 10)}.csv`;
  link.href = url;
  link.download = filename.replace(/[^a-zA-Z0-9_\-.]/g, "_");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
