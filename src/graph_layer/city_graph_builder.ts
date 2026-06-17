import { systemConfig } from "../config";
import { haversineKm } from "../lib/geo";
import { computeEdge } from "./edge_calculator";
import type { ProcessedCity, Graph, Edge } from "../types";

/** Build a weighted graph connecting every pair of cities within radius_km.
 *  Returns both an adjacency index (for routing lookups) and a flat edge list
 *  (for export / SQLite). */
export function buildGraph(cities: ProcessedCity[]): Graph {
  const adj = new Map<string, Map<string, ReturnType<typeof computeEdge>>>();
  const edges: Edge[] = [];
  for (const c of cities) adj.set(c.id, new Map());

  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i];
      const b = cities[j];
      const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (km > systemConfig.radius_km) continue;
      const info = computeEdge(a, b);
      adj.get(a.id)!.set(b.id, info);
      adj.get(b.id)!.set(a.id, info);
      edges.push({ from: a.id, to: b.id, ...info });
    }
  }
  return { adj, edges };
}

/** Provinces that have zero intra-province edges (a connectivity smell test). */
export function isolatedNodes(cities: ProcessedCity[], graph: Graph): string[] {
  return cities.filter((c) => (graph.adj.get(c.id)?.size ?? 0) === 0).map((c) => c.id);
}
