/**
 * Núcleo do OBQC: `runChecks` valida uma SPARQL contra a ontologia e devolve
 * as violações (com mensagem em linguagem natural para o reparo do LLM).
 * Aplica as regras de domínio, range/escopo, variáveis não declaradas no SELECT
 * e sintaxe. Compara sempre os tipos que a própria query declara (rdf:type),
 * nunca os dados reais.
 */
import { Ontology } from "./ontology.js";
import { parseQuery, RDF_TYPE, Term } from "./parser.js";

export type Rule = "domain" | "range" | "undeclared-variable" | "syntax";

export interface Violation {
  rule: Rule;
  message: string;
}

function keyOf(t: Term): string {
  return t.type === "var" ? "var:" + t.value : t.value;
}

function show(t: Term): string {
  return t.type === "var" ? "?" + t.value : shortIri(t.value);
}

function shortIri(iri: string): string {
  const m = iri.match(/[#/]([^#/]+)\/?$/);
  return m?.[1] ?? iri;
}

export async function runChecks(
  query: string,
  onto: Ontology,
): Promise<Violation[]> {
  let parsed;
  try {
    parsed = parseQuery(query);
  } catch (err) {
    return [
      {
        rule: "syntax",
        message: `A consulta não é SPARQL válida: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  const { triples, projectionVars, whereVars } = parsed;
  const violations: Violation[] = [];

  const declaredTypes = new Map<string, Term[]>();
  for (const t of triples) {
    const isTypeTriple =
      t.predicate.type === "iri" &&
      t.predicate.value === RDF_TYPE &&
      t.object.type === "iri";
    if (!isTypeTriple) continue;
    const k = keyOf(t.subject);
    const existing = declaredTypes.get(k);
    if (existing) existing.push(t.object);
    else declaredTypes.set(k, [t.object]);
  }

  for (const t of triples) {
    if (t.predicate.type !== "iri" || t.predicate.value === RDF_TYPE) continue;
    const p = t.predicate.value;

    const subjectTypes = declaredTypes.get(keyOf(t.subject)) ?? [];
    for (const dom of onto.domainsOf(p)) {
      for (const ct of subjectTypes) {
        if (!(await onto.isSubClassOf(ct.value, dom))) {
          violations.push({
            rule: "domain",
            message: `A propriedade ${shortIri(p)} tem domínio ${shortIri(dom)}, mas seu sujeito ${show(
              t.subject,
            )} é um ${shortIri(ct.value)}, que não é subclasse de ${shortIri(dom)}.`,
          });
        }
      }
    }

    const objectTypes = declaredTypes.get(keyOf(t.object)) ?? [];
    for (const ran of onto.rangesOf(p)) {
      if (onto.isDatatype(ran)) continue;
      for (const ct of objectTypes) {
        if (!(await onto.isSubClassOf(ct.value, ran))) {
          violations.push({
            rule: "range",
            message: `A propriedade ${shortIri(p)} tem range ${shortIri(ran)}, mas seu objeto ${show(
              t.object,
            )} é um ${shortIri(ct.value)}, que não é subclasse de ${shortIri(ran)}.`,
          });
        }
      }
    }
  }

  for (const v of projectionVars) {
    if (!whereVars.includes(v)) {
      violations.push({
        rule: "undeclared-variable",
        message: `A variável ?${v} aparece no SELECT mas não está vinculada no WHERE.`,
      });
    }
  }

  return violations;
}
