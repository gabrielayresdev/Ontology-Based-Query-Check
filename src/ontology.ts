/**
 * Encapsula a T-Box (ontologia OWL/RDFS) carregada em memória e expõe as
 * consultas que o OBQC precisa. `Ontology.fromFile` carrega um Turtle do disco;
 * os métodos dão domínio/range de uma propriedade (`domainsOf`, `rangesOf`),
 * teste de subclasse transitiva (`isSubClassOf`), existência de propriedade
 * (`hasProperty`), detecção de datatype (`isDatatype`) e um resumo compacto do
 * esquema para o prompt do LLM (`describeForPrompt`).
 */
import fs from "fs";
import { Parser, Store, DataFactory } from "n3";
import { QueryEngine } from "@comunica/query-sparql";

const { namedNode } = DataFactory;

const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

const PREFIXES: Record<string, string> = {
  org: "http://www.w3.org/ns/org#",
  foaf: "http://xmlns.com/foaf/0.1/",
  skos: "http://www.w3.org/2004/02/skos/core#",
  dct: "http://purl.org/dc/terms/",
  vcard: "http://www.w3.org/2006/vcard/ns#",
  time: "http://www.w3.org/2006/time#",
  prov: "http://www.w3.org/ns/prov#",
  gr: "http://purl.org/goodrelations/v1#",
  rdfs: RDFS,
  rdf: RDF,
  owl: "http://www.w3.org/2002/07/owl#",
};

function toPrefixed(iri: string): string {
  for (const [p, ns] of Object.entries(PREFIXES)) {
    if (iri.startsWith(ns)) return `${p}:${iri.slice(ns.length)}`;
  }
  return `<${iri}>`;
}

export class Ontology {
  readonly store: Store;
  private readonly engine = new QueryEngine();

  private constructor(store: Store) {
    this.store = store;
  }

  static fromFile(path: string): Ontology {
    const ttl = fs.readFileSync(path, "utf-8");
    const store = new Store();
    store.addQuads(new Parser().parse(ttl));
    return new Ontology(store);
  }

  domainsOf(property: string): string[] {
    return this.store
      .getQuads(namedNode(property), namedNode(RDFS + "domain"), null, null)
      .filter((q) => q.object.termType === "NamedNode")
      .map((q) => q.object.value);
  }

  rangesOf(property: string): string[] {
    return this.store
      .getQuads(namedNode(property), namedNode(RDFS + "range"), null, null)
      .filter((q) => q.object.termType === "NamedNode")
      .map((q) => q.object.value);
  }

  hasProperty(property: string): boolean {
    return (
      this.store.getQuads(namedNode(property), null, null, null).length > 0
    );
  }

  isDatatype(iri: string): boolean {
    return (
      iri.startsWith(XSD) ||
      iri === RDF + "langString" ||
      iri === RDFS + "Literal"
    );
  }

  async isSubClassOf(sub: string, sup: string): Promise<boolean> {
    if (sub === sup) return true;
    return this.engine.queryBoolean(
      `ASK { <${sub}> <${RDFS}subClassOf>* <${sup}> }`,
      { sources: [this.store] },
    );
  }

  describeForPrompt(): string {
    const subclass: string[] = [];
    for (const q of this.store.getQuads(
      null,
      namedNode(RDFS + "subClassOf"),
      null,
      null,
    )) {
      if (
        q.subject.termType === "NamedNode" &&
        q.object.termType === "NamedNode"
      ) {
        subclass.push(
          `- ${toPrefixed(q.subject.value)} subClassOf ${toPrefixed(q.object.value)}`,
        );
      }
    }

    const properties = new Set<string>();
    for (const q of this.store.getQuads(
      null,
      namedNode(RDFS + "domain"),
      null,
      null,
    )) {
      properties.add(q.subject.value);
    }
    for (const q of this.store.getQuads(
      null,
      namedNode(RDFS + "range"),
      null,
      null,
    )) {
      properties.add(q.subject.value);
    }
    const propLines = [...properties].sort().map((p) => {
      const doms = this.domainsOf(p).map(toPrefixed).join(", ") || "—";
      const rans = this.rangesOf(p).map(toPrefixed).join(", ") || "—";
      return `- ${toPrefixed(p)} (domínio: ${doms}; range: ${rans})`;
    });

    const prefixDecls = Object.entries(PREFIXES)
      .map(([p, ns]) => `PREFIX ${p}: <${ns}>`)
      .join("\n");

    return [
      "# Prefixos (use-os na consulta)",
      prefixDecls,
      "",
      "# Classes (hierarquia)",
      ...subclass,
      "",
      "# Propriedades (domínio -> range)",
      ...propLines,
    ].join("\n");
  }
}
