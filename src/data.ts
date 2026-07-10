/**
 * Execução de consultas SELECT contra o A-Box em memória. `executeQuery` roda a
 * query no Store via Comunica (SPARQL completo) e devolve as linhas como objetos
 * simples (variável -> valor). Inclui a implementação local da função de extensão
 * fn:date_diff usada por um dos gabaritos do benchmark.
 */
import { Store, DataFactory } from "n3";
import { QueryEngine } from "@comunica/query-sparql";
import type * as RDF from "@rdfjs/types";

const { literal, namedNode } = DataFactory;
const engine = new QueryEngine();

const MS_PER_UNIT: Record<string, number> = {
  day: 86_400_000,
  hour: 3_600_000,
  minute: 60_000,
  second: 1_000,
};

const extensionFunctions = {
  "http://data.world/function/functions#date_diff": async (
    args: RDF.Term[],
  ): Promise<RDF.Term> => {
    const [from, to, unit] = args;
    const ms =
      new Date(to?.value ?? "").getTime() -
      new Date(from?.value ?? "").getTime();
    const per = MS_PER_UNIT[unit?.value ?? "day"] ?? MS_PER_UNIT.day!;
    return literal(
      String(Math.round(ms / per)),
      namedNode("http://www.w3.org/2001/XMLSchema#integer"),
    );
  },
};

export type Row = Record<string, string>;

export async function executeQuery(
  query: string,
  store: Store,
): Promise<Row[]> {
  const stream = await engine.queryBindings(query, {
    sources: [store],
    extensionFunctions,
  });
  const bindings = await stream.toArray();
  return bindings.map((b) => {
    const row: Row = {};
    for (const [variable, term] of b) {
      row[variable.value] = term.value;
    }
    return row;
  });
}
