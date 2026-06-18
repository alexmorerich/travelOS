import { systemConfig } from "../config";
import { haversineKm } from "../lib/geo";
import { computeEdge } from "./edge_calculator";
import type { ProcessedCity, Graph, Edge } from "../types";

/** Build a weighted graph: each city links to its k-nearest neighbours within
 *  radius_km. The k-NN cap keeps the graph small/fast at thousands of nodes
 *  (the anchor "flight" in routing is global, so reachability isn't lost).
 *  Returns an adjacency index (routing) and a deduped flat edge list (export). */
export function buildGraph(cities: ProcessedCity[]): Graph {
  const adj = new Map<string, Map<string, ReturnType<typeof computeEdge>>>();
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const K = systemConfig.max_neighbors;

  for (const a of cities) {
    const near: { b: ProcessedCity; km: number }[] = [];
    for (const b of cities) {
      if (b.id === a.id) continue;
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (km <= systemConfig.radius_km) near.push({ b, km });
    }
    near.sort((x, y) => x.km - y.km);

    const inner = new Map<string, ReturnType<typeof computeEdge>>();
    for (const { b } of near.slice(0, K)) {
      const info = computeEdge(a, b);
      inner.set(b.id, info);
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: a.id, to: b.id, ...info });
      }
    }
    adj.set(a.id, inner);
  }
  return { adj, edges };
}

/** Provinces that have zero intra-province edges (a connectivity smell test). */
export function isolatedNodes(cities: ProcessedCity[], graph: Graph): string[] {
  return cities.filter((c) => (graph.adj.get(c.id)?.size ?? 0) === 0).map((c) => c.id);
}
