/**
 * Materialização do A-Box a partir dos CSVs e do mapping R2RML. `materialize`
 * carrega os CSVs num SQLite em memória, lê os TriplesMaps do arquivo .r2rml e
 * expande os templates de sujeito/predicado/objeto, produzindo o grafo (Store)
 * que o data.world virtualizava no benchmark. Inclui um parser de CSV (RFC 4180)
 * e a normalização de templates que corrige grafias divergentes do mapping.
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { Parser, Store, DataFactory, Quad_Object } from "n3";

const { namedNode, literal, quad } = DataFactory;

const RR = "http://www.w3.org/ns/r2rml#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD = "http://www.w3.org/2001/XMLSchema#";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

function loadCsvsIntoSqlite(db: DatabaseSync, csvDir: string): void {
  for (const file of fs.readdirSync(csvDir)) {
    if (!file.endsWith(".csv")) continue;
    const table = path.basename(file, ".csv").toLowerCase();
    const rows = parseCsv(fs.readFileSync(path.join(csvDir, file), "utf-8"));
    const header = rows[0];
    if (!header) continue;

    const seen = new Set<string>();
    const cols = header.map((h) => {
      let name = h.trim();
      while (seen.has(name.toLowerCase())) name += "_2";
      seen.add(name.toLowerCase());
      return name;
    });

    db.exec(
      `CREATE TABLE "${table}" (${cols.map((c) => `"${c}" TEXT`).join(", ")})`,
    );
    const insert = db.prepare(
      `INSERT INTO "${table}" VALUES (${cols.map(() => "?").join(", ")})`,
    );
    for (const r of rows.slice(1)) {
      const padded = cols.map((_, i) => r[i] ?? "");
      insert.run(...padded);
    }
  }
}

interface PredicateObjectMap {
  predicate: string;
  objectTemplate?: string;
  objectColumn?: string;
}

interface TriplesMap {
  subjectTemplate: string;
  classes: string[];
  tableName?: string;
  sqlQuery?: string;
  poms: PredicateObjectMap[];
}

function parseMapping(mappingPath: string): TriplesMap[] {
  const store = new Store();
  store.addQuads(new Parser().parse(fs.readFileSync(mappingPath, "utf-8")));

  const one = (s: Quad_Object, p: string) =>
    store.getQuads(s, namedNode(RR + p), null, null)[0]?.object;

  const maps: TriplesMap[] = [];
  for (const q of store.getQuads(
    null,
    RDF_TYPE,
    namedNode(RR + "TriplesMap"),
    null,
  )) {
    const tm = q.subject;
    const subjectMap = one(tm, "subjectMap");
    const logicalTable = one(tm, "logicalTable");
    if (!subjectMap || !logicalTable) continue;

    const rawSubjectTemplate = one(subjectMap, "template")?.value;
    if (!rawSubjectTemplate) continue;
    const subjectTemplate = normalizeTemplate(rawSubjectTemplate);

    const classes = store
      .getQuads(subjectMap, namedNode(RR + "class"), null, null)
      .map((c) => c.object.value);

    const poms: PredicateObjectMap[] = [];
    for (const pomQ of store.getQuads(
      tm,
      namedNode(RR + "predicateObjectMap"),
      null,
      null,
    )) {
      const pom = pomQ.object;
      const predicate = one(pom, "predicate")?.value;
      const objectMap = one(pom, "objectMap");
      if (!predicate || !objectMap) continue;
      const objectTemplate = one(objectMap, "template")?.value;
      poms.push({
        predicate,
        objectTemplate: objectTemplate && normalizeTemplate(objectTemplate),
        objectColumn: one(objectMap, "column")?.value,
      });
    }

    maps.push({
      subjectTemplate,
      classes,
      tableName: one(logicalTable, "tableName")?.value,
      sqlQuery: one(logicalTable, "sqlQuery")?.value,
      poms,
    });
  }
  return maps;
}

const TEMPLATE_FIXES: [string, string][] = [
  ["Policy-Holder-", "PolicyHolder-"],
  ["Underwriting-Assessment-", "UnderwritingAssessment-"],
];

function normalizeTemplate(template: string): string {
  let t = template;
  for (const [from, to] of TEMPLATE_FIXES) t = t.replace(from, to);
  return t;
}

function expandTemplate(
  template: string,
  row: Record<string, string>,
): string | null {
  let missing = false;
  const result = template.replace(/\{([^}]+)\}/g, (_, col: string) => {
    const v = row[col.toLowerCase().trim()];
    if (v === undefined || v === "") {
      missing = true;
      return "";
    }
    return v;
  });
  return missing ? null : result;
}

function toLiteral(value: string) {
  if (/^-?\d+$/.test(value)) return literal(value, namedNode(XSD + "integer"));
  if (/^-?\d*\.\d+$/.test(value))
    return literal(value, namedNode(XSD + "decimal"));
  return literal(value);
}

export function materialize(mappingPath: string, csvDir: string): Store {
  const db = new DatabaseSync(":memory:");
  loadCsvsIntoSqlite(db, csvDir);

  const store = new Store();
  for (const map of parseMapping(mappingPath)) {
    const sql =
      map.sqlQuery ??
      `SELECT * FROM "${map.tableName!.split(".").pop()!.toLowerCase()}"`;
    const rows = db.prepare(sql).all() as Record<string, unknown>[];

    for (const raw of rows) {
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        row[k.toLowerCase()] = v === null ? "" : String(v);
      }

      const subjectIri = expandTemplate(map.subjectTemplate, row);
      if (subjectIri === null) continue;
      const subject = namedNode(subjectIri);

      for (const cls of map.classes) {
        store.addQuad(quad(subject, namedNode(RDF_TYPE), namedNode(cls)));
      }
      for (const pom of map.poms) {
        if (pom.objectTemplate) {
          const objIri = expandTemplate(pom.objectTemplate, row);
          if (objIri !== null) {
            store.addQuad(
              quad(subject, namedNode(pom.predicate), namedNode(objIri)),
            );
          }
        } else if (pom.objectColumn) {
          const v = row[pom.objectColumn.toLowerCase()];
          if (v !== undefined && v !== "") {
            store.addQuad(
              quad(subject, namedNode(pom.predicate), toLiteral(v)),
            );
          }
        }
      }
    }
  }
  return store;
}
