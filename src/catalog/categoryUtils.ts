import type { Category, CategoryOption } from './types.ts';

export function buildCategoryOptions(categories: readonly Category[]): CategoryOption[] {
  const byId = new Map<string, Category>();
  for (const cat of categories) {
    byId.set(cat.categoryId, cat);
  }

  const options: CategoryOption[] = categories.map((cat) => {
    const segments: string[] = [cat.name];
    const visited = new Set<string>([cat.categoryId]);
    let currentParentId = cat.parentId;

    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId);
      const parent = byId.get(currentParentId);
      if (!parent) {
        break;
      }
      segments.unshift(parent.name);
      currentParentId = parent.parentId;
    }

    return {
      categoryId: cat.categoryId,
      name: cat.name,
      parentId: cat.parentId,
      label: segments.join(' \u2192 '),
      depth: segments.length - 1,
    };
  });

  return options.sort(
    (a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) ||
      a.categoryId.localeCompare(b.categoryId),
  );
}
