export type ArchiveQuery = Record<string, string | undefined>;

export function buildArchiveFilter(query: ArchiveQuery) {
  const filter: Record<string, unknown> = {};
  if (query.state) filter.workflowState = query.state;
  if (query.platform) filter.platform = query.platform;
  if (query.source) filter.sourceKinds = query.source;
  if (query.tag) filter.tags = query.tag;
  if (query.topic) filter.topics = query.topic;
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if ((from && !Number.isNaN(from.valueOf())) || (to && !Number.isNaN(to.valueOf()))) filter.originalTimestamp = { ...(from && !Number.isNaN(from.valueOf()) ? { $gte: from } : {}), ...(to && !Number.isNaN(to.valueOf()) ? { $lte: to } : {}) };
  const search = query.search?.trim();
  if (search) filter.$text = { $search: search };
  return { filter, search };
}
