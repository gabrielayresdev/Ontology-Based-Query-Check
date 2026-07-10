/**
 * Extrai da SPARQL o que o OBQC precisa checar. `parseQuery` traduz a query para
 * a álgebra (via sparqlalgebrajs) e devolve os triplos dos BGPs, as variáveis do
 * SELECT externo e todas as variáveis vinculadas no corpo (BGPs, property paths,
 * BIND/agregações, VALUES e subqueries). Os tipos `Term`/`Triple`/`ParsedQuery`
 * descrevem esse resultado.
 */
import { translate, Util, Algebra } from "sparqlalgebrajs";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export interface Term {
  type: "iri" | "var" | "literal" | "bnode";
  value: string;
}

export interface Triple {
  subject: Term;
  predicate: Term;
  object: Term;
}

export interface ParsedQuery {
  triples: Triple[];
  projectionVars: string[];
  whereVars: string[];
}

function toTerm(t: { termType: string; value: string }): Term {
  switch (t.termType) {
    case "NamedNode":
      return { type: "iri", value: t.value };
    case "Variable":
      return { type: "var", value: t.value };
    case "Literal":
      return { type: "literal", value: t.value };
    default:
      return { type: "bnode", value: t.value };
  }
}

export function parseQuery(query: string): ParsedQuery {
  const algebra = translate(query);

  const triples: Triple[] = [];
  const bound = new Set<string>();
  let projectionVars: string[] | null = null;

  Util.recurseOperation(algebra, {
    project(op: Algebra.Project) {
      if (projectionVars === null) {
        projectionVars = op.variables.map((v) => v.value);
      } else {
        for (const v of op.variables) bound.add(v.value);
      }
      return true;
    },
    bgp(op: Algebra.Bgp) {
      for (const p of op.patterns) {
        triples.push({
          subject: toTerm(p.subject),
          predicate: toTerm(p.predicate),
          object: toTerm(p.object),
        });
      }
      return false;
    },
    path(op: Algebra.Path) {
      for (const t of [op.subject, op.object]) {
        if (t.termType === "Variable") bound.add(t.value);
      }
      return true;
    },
    extend(op: Algebra.Extend) {
      bound.add(op.variable.value);
      return true;
    },
    group(op: Algebra.Group) {
      for (const agg of op.aggregates) bound.add(agg.variable.value);
      return true;
    },
    values(op: Algebra.Values) {
      for (const v of op.variables) bound.add(v.value);
      return true;
    },
  });

  for (const t of triples) {
    for (const term of [t.subject, t.predicate, t.object]) {
      if (term.type === "var") bound.add(term.value);
    }
  }

  return {
    triples,
    projectionVars: projectionVars ?? [],
    whereVars: [...bound],
  };
}
