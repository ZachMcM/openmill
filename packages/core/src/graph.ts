export type DependencyGraph = ReadonlyMap<string, readonly string[]>;

export type GraphCheck = { ok: true } | { ok: false; error: string };

export function ancestors(graph: DependencyGraph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(graph.get(id) ?? [])];

  while (stack.length > 0) {
    const next = stack.pop() as string;

    if (!seen.has(next)) {
      seen.add(next);
      stack.push(...(graph.get(next) ?? []));
    }
  }

  return seen;
}

export function findCycle(graph: DependencyGraph): string[] | undefined {
  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();

  function visit(id: string): string[] | undefined {
    if (onPath.has(id)) {
      return [...path.slice(path.indexOf(id)), id];
    }

    if (done.has(id)) {
      return undefined;
    }

    path.push(id);
    onPath.add(id);

    for (const dep of graph.get(id) ?? []) {
      const cycle = visit(dep);

      if (cycle) {
        return cycle;
      }
    }

    path.pop();
    onPath.delete(id);
    done.add(id);

    return undefined;
  }

  for (const id of graph.keys()) {
    const cycle = visit(id);

    if (cycle) {
      return cycle;
    }
  }

  return undefined;
}

export function stackParent(graph: DependencyGraph, id: string): string | null | undefined {
  const deps = graph.get(id) ?? [];

  if (deps.length === 0) {
    return null;
  }

  return deps.find((candidate) => {
    const below = ancestors(graph, candidate);

    return deps.every((dep) => dep === candidate || below.has(dep));
  });
}

export function checkGraph(graph: DependencyGraph, ids: Iterable<string>): GraphCheck {
  for (const [id, deps] of graph) {
    const missing = deps.find((dep) => !graph.has(dep));

    if (missing !== undefined) {
      return { ok: false, error: `${id} depends on unknown job ${missing}` };
    }
  }

  const cycle = findCycle(graph);

  if (cycle) {
    return { ok: false, error: `dependency cycle: ${cycle.join(" -> ")}` };
  }

  for (const id of ids) {
    if (stackParent(graph, id) === undefined) {
      const deps = (graph.get(id) ?? []).join(", ");

      return {
        ok: false,
        error: `${id} depends on ${deps}, which don't form one ancestor chain, so there is no single branch to stack on`,
      };
    }
  }

  return { ok: true };
}
