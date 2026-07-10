/**
 * Carrega e prepara o benchmark Q&A do data.world. `loadInquiries` extrai as
 * perguntas com sua SPARQL-gabarito e quadrante; `prepareForLocalExecution`
 * adapta uma query para rodar no store local (prefixos + remoção de SERVICE);
 * `sameResults` compara resultados no espírito da Execution Accuracy do Spider.
 */
import fs from "fs";
import { Parser, Store, DataFactory, Quad_Subject } from "n3";
import { translate, toSparql, Util, Algebra } from "sparqlalgebrajs";
import { Row } from "./data.js";

const { namedNode } = DataFactory;

const QANDA = "http://models.data.world/benchmarks/QandA#";
const DWT = "https://templates.data.world/";
const DCT = "http://purl.org/dc/terms/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export type Quadrant = "LQLS" | "LQHS" | "HQLS" | "HQHS";

export interface Inquiry {
  id: string;
  question: string;
  goldSparql: string;
  quadrant: Quadrant | "?";
}

export function loadInquiries(investigationPath: string): Inquiry[] {
  const store = new Store();
  store.addQuads(
    new Parser().parse(fs.readFileSync(investigationPath, "utf-8")),
  );

  const str = (s: Quad_Subject, p: string) =>
    store.getQuads(s, namedNode(p), null, null)[0]?.object.value;

  const inquiries: Inquiry[] = [];
  for (const q of store.getQuads(
    null,
    namedNode(RDF_TYPE),
    namedNode(QANDA + "Inquiry"),
    null,
  )) {
    const inquiry = q.subject;
    const question = str(inquiry, QANDA + "prompt");
    if (!question) continue;

    for (const e of store.getQuads(
      inquiry,
      namedNode(QANDA + "expects"),
      null,
      null,
    )) {
      const target = e.object as Quad_Subject;
      const isSparql =
        store.countQuads(
          target,
          namedNode(RDF_TYPE),
          namedNode(DWT + "SparqlQuery"),
          null,
        ) > 0;
      if (!isSparql) continue;

      const goldSparql = str(target, QANDA + "queryText");
      if (!goldSparql) continue;
      const title = str(target, DCT + "title") ?? "";
      const quadrant =
        (title.match(/^(LQLS|LQHS|HQLS|HQHS)/)?.[1] as Quadrant) ?? "?";
      inquiries.push({
        id: inquiry.value.replace(DWT, ""),
        question,
        goldSparql,
        quadrant,
      });
      break;
    }
  }
  return inquiries.sort((a, b) => a.id.localeCompare(b.id));
}

const DEFAULT_PREFIXES: Record<string, string> = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  owl: "http://www.w3.org/2002/07/owl#",
};

export function prepareForLocalExecution(query: string): string {
  let q = query;
  for (const [prefix, ns] of Object.entries(DEFAULT_PREFIXES)) {
    if (!new RegExp(`PREFIX\\s+${prefix}:`, "i").test(q)) {
      q = `PREFIX ${prefix}: <${ns}>\n` + q;
    }
  }
  const algebra = translate(q);
  const stripped = Util.mapOperation(algebra, {
    service(op: Algebra.Service) {
      return { result: op.input, recurse: true };
    },
  });
  return toSparql(stripped);
}

export function sameResults(a: Row[], b: Row[]): boolean {
  return canonical(a) === canonical(b);
}

function canonical(rows: Row[]): string {
  const canonRow = (r: Row) =>
    JSON.stringify(
      Object.values(r)
        .map((v) => (/^-?\d+(\.\d+)?$/.test(v) ? String(Number(v)) : v))
        .sort(),
    );
  return rows.map(canonRow).sort().join("\n");
}
