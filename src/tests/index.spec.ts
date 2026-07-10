import { describe, expect, test } from "vitest";
import { Ontology } from "../ontology.js";
import { runChecks } from "../checks.js";
import { Llm } from "../llm.js";
import { runPipeline } from "../pipeline.js";
import { executeQuery } from "../data.js";
import { materialize } from "../r2rml.js";
import { loadInquiries, prepareForLocalExecution, sameResults } from "../benchmark.js";

const PREFIX = "PREFIX in: <http://data.world/schema/insurance/>\n";
const onto = Ontology.fromFile("src/benchmark/insurance.ttl");
const data = materialize("src/benchmark/mapping.r2rml", "src/benchmark/data");

/** LLM falso: devolve, em ordem, as consultas pré-programadas. */
class ScriptedLlm implements Llm {
  private i = 0;
  constructor(private readonly queries: string[]) {}
  private next(): Promise<string> {
    return Promise.resolve(this.queries[this.i++] ?? "");
  }
  generateSparql(): Promise<string> {
    return this.next();
  }
  repairSparql(): Promise<string> {
    return this.next();
  }
}

describe("OBQC sobre a ontologia de seguros do benchmark", () => {
  test("query consistente não gera violação", async () => {
    const q =
      PREFIX +
      `SELECT ?agent WHERE {
         ?p a in:Policy .
         ?p in:soldByAgent ?agent .
       }`;
    expect(await runChecks(q, onto)).toHaveLength(0);
  });

  test("detecta violação de domínio (exemplo-guia do paper)", async () => {
    // soldByAgent tem domínio Policy; a query declara o sujeito como Agent.
    const q =
      PREFIX +
      `SELECT ?policy WHERE {
         ?agent in:soldByAgent ?policy .
         ?agent a in:Agent .
       }`;
    const v = await runChecks(q, onto);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("domain");
    expect(v[0]!.message).toContain("Policy");
  });

  test("detecta violação de escopo (range)", async () => {
    // soldByAgent tem range Agent; a query declara o objeto como Claim.
    const q =
      PREFIX +
      `SELECT ?x WHERE {
         ?p in:soldByAgent ?x .
         ?x a in:Claim .
       }`;
    const v = await runChecks(q, onto);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("range");
    expect(v[0]!.message).toContain("Agent");
  });

  test("detecta variável do SELECT não vinculada no WHERE", async () => {
    const q =
      PREFIX +
      `SELECT ?p ?faltante WHERE {
         ?p a in:Policy .
       }`;
    const v = await runChecks(q, onto);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("undeclared-variable");
    expect(v[0]!.message).toContain("faltante");
  });

  test("agregações não são acusadas como variável não declarada", async () => {
    const q =
      PREFIX +
      `SELECT (COUNT(?policy) AS ?NoOfPolicy)
       WHERE { ?policy a in:Policy . }`;
    expect(await runChecks(q, onto)).toHaveLength(0);
  });

  test("SPARQL inválida vira violação de sintaxe (entra no loop de reparo)", async () => {
    const v = await runChecks("SELECT WHERE {", onto);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("syntax");
  });
});

describe("Pipeline (generate -> OBQC -> repair)", () => {
  const bad =
    PREFIX +
    `SELECT ?p ?faltante WHERE { ?p a in:Policy . }`;
  const good =
    PREFIX +
    `SELECT ?p WHERE { ?p a in:Policy . }`;

  test("repara uma consulta com violação e termina em ok", async () => {
    const llm = new ScriptedLlm([bad, good]);
    const result = await runPipeline("qualquer pergunta", onto, llm);
    expect(result.status).toBe("ok");
    expect(result.attempts).toHaveLength(2); // geração + 1 reparo
    expect(result.attempts[0]!.violations).toHaveLength(1);
    expect(result.attempts[1]!.violations).toHaveLength(0);
  });

  test("retorna 'unknown' se as violações persistem além do limite", async () => {
    const llm = new ScriptedLlm([bad, bad, bad, bad]); // nunca conserta
    const result = await runPipeline("qualquer pergunta", onto, llm, 3);
    expect(result.status).toBe("unknown");
    expect(result.attempts).toHaveLength(4); // geração + 3 reparos
  });
});

describe("Benchmark cwd (ACME Insurance)", () => {
  test("carrega as 44 perguntas com gabarito SPARQL e quadrante", () => {
    const inquiries = loadInquiries("src/benchmark/acme-benchmark.ttl");
    expect(inquiries).toHaveLength(44);
    expect(inquiries.every((i) => i.quadrant !== "?")).toBe(true);
  });

  test("materializa o A-Box a partir dos CSVs + R2RML", () => {
    expect(data.size).toBeGreaterThan(200);
  });

  test("executa uma query contra o A-Box materializado", async () => {
    const rows = await executeQuery(
      PREFIX + `SELECT (COUNT(?p) AS ?n) WHERE { ?p a in:Policy . }`,
      data,
    );
    expect(rows[0]!.n).toBe("2");
  });

  test("todas as queries-gabarito executam localmente com resultado", async () => {
    for (const inq of loadInquiries("src/benchmark/acme-benchmark.ttl")) {
      const rows = await executeQuery(prepareForLocalExecution(inq.goldSparql), data);
      expect(rows.length, inq.question).toBeGreaterThan(0);
    }
  });

  test("OBQC não gera falso positivo em nenhuma query-gabarito", async () => {
    for (const inq of loadInquiries("src/benchmark/acme-benchmark.ttl")) {
      const v = await runChecks(prepareForLocalExecution(inq.goldSparql), onto);
      expect(v, inq.question).toHaveLength(0);
    }
  });

  test("sameResults ignora ordem de linhas, nomes e ordem de colunas", () => {
    const a = [
      { x: "1", y: "Ana" },
      { x: "2", y: "Bia" },
    ];
    const b = [
      { nome: "Bia", id: "2.0" },
      { nome: "Ana", id: "1" },
    ];
    expect(sameResults(a, b)).toBe(true);
    expect(sameResults(a, b.slice(0, 1))).toBe(false);
  });
});
