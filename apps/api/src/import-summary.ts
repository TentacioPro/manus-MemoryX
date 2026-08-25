type IdValue = { toHexString?: () => string } | string;
type ImportLike = { _id: IdValue; [key: string]: unknown };
type ImportRowLike = { importId: IdValue; candidate?: { topics?: string[]; source?: { captureMethod?: string } } };
const idOf = (value: IdValue) => typeof value === "string" ? value : value.toHexString?.() ?? "";

export function attachImportMetadata<T extends ImportLike>(imports: T[], rows: ImportRowLike[]) {
  const grouped = new Map<string, ImportRowLike[]>();
  rows.forEach(row => { const key = idOf(row.importId); grouped.set(key, [...(grouped.get(key) ?? []), row]); });
  return imports.map(item => {
    const importRows = grouped.get(idOf(item._id)) ?? [];
    return { ...item, topics: [...new Set(importRows.flatMap(row => row.candidate?.topics ?? []).filter(Boolean))].slice(0, 6), captureMethods: [...new Set(importRows.map(row => row.candidate?.source?.captureMethod).filter((value): value is string => Boolean(value)))].slice(0, 4) };
  });
}
