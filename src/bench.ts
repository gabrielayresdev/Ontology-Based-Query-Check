/**
 * Runner do benchmark (entrada de linha de comando). Materializa o A-Box, roda
 * cada pergunta pelo pipeline OBQC (ou valida os gabaritos com --sanity),
 * classifica cada resultado (EA na primeira tentativa, EA após reparos, unknown
 * ou impreciso), imprime as métricas agregadas por quadrante e salva o detalhe
 * em JSON. Flags: --sanity, --limit, --model, --out.
 */
import argv from "minimist";
import fs from "fs";

try {
  process.loadEnvFile();
} catch {}

import { Ontology } from "./ontology.js";
import { runChecks } from "./checks.js";
import { executeQuery, Row } from "./data.js";
import { OpenAiLlm } from "./llm.js";
import { runPipeline } from "./pipeline.js";
import { materialize } from "./r2rml.js";
import {
  loadInquiries,
  prepareForLocalExecution,
  sameResults,
  Inquiry,
} from "./benchmark.js";

const DIR = "src/benchmark";

type Outcome = "ea-first-time" | "ea-with-repairs" | "unknown" | "inaccurate";

interface BenchResult {
  id: string;
  quadrant: string;
  question: string;
  outcome: Outcome;
  attempts: number;
  finalQuery: string;
  error?: string;
}

function pct(n: number, total: number): string {
  return total === 0 ? "—" : ((100 * n) / total).toFixed(2) + "%";
}

function printMetrics(results: BenchResult[]): void {
  const groups = new Map<string, BenchResult[]>([["Todas", results]]);
  for (const r of results) {
    if (!groups.has(r.quadrant)) groups.set(r.quadrant, []);
    groups.get(r.quadrant)!.push(r);
  }

  console.log(
    "\n| Grupo | EA First Time | EA with Repairs | Unknown | Acc+Unknown | Error Rate |",
  );
  console.log("|---|---|---|---|---|---|");
  for (const [name, rs] of groups) {
    const first = rs.filter((r) => r.outcome === "ea-first-time").length;
    const repaired = rs.filter((r) => r.outcome === "ea-with-repairs").length;
    const unknown = rs.filter((r) => r.outcome === "unknown").length;
    const acc = first + repaired;
    console.log(
      `| ${name} (n=${rs.length}) | ${pct(first, rs.length)} | ${pct(acc, rs.length)} | ` +
        `${pct(unknown, rs.length)} | ${pct(acc + unknown, rs.length)} | ` +
        `${pct(rs.length - acc - unknown, rs.length)} |`,
    );
  }
  console.log(
    "\nPaper (Table 1, All Questions): First Time 42.88% | with Repairs 72.55% | " +
      "Unknown 8% | Acc+Unknown 80.56% | Error 19.44%",
  );
}

async function main(): Promise<void> {
  const args = argv(process.argv.slice(2));
  const ontology = Ontology.fromFile(`${DIR}/insurance.ttl`);
  const rawTtl = fs.readFileSync(`${DIR}/insurance.ttl`, "utf-8");
  const inquiries = loadInquiries(`${DIR}/acme-benchmark.ttl`);
  const data = materialize(`${DIR}/mapping.r2rml`, `${DIR}/data`);
  console.log(
    `Benchmark: ${inquiries.length} perguntas | A-Box materializado: ${data.size} triplos`,
  );

  const goldRows = new Map<string, Row[]>();
  for (const inq of inquiries) {
    goldRows.set(
      inq.id,
      await executeQuery(prepareForLocalExecution(inq.goldSparql), data),
    );
  }

  if (args.sanity) {
    let eaOk = 0;
    let goldViolations = 0;
    for (const inq of inquiries) {
      const rows = goldRows.get(inq.id)!;
      if (rows.length > 0 && sameResults(rows, rows)) eaOk++;
      const v = await runChecks(
        prepareForLocalExecution(inq.goldSparql),
        ontology,
      );
      if (v.length > 0) {
        goldViolations++;
        console.log(
          `  OBQC no gabarito [${inq.quadrant}] ${inq.question.slice(0, 60)}...`,
        );
        v.forEach((x) => console.log(`      [${x.rule}] ${x.message}`));
      }
    }
    console.log(
      `\nSanity: ${eaOk}/${inquiries.length} gabaritos executam com resultado e EA reflexiva OK.`,
    );
    console.log(
      `OBQC no gabarito: ${goldViolations} queries-ouro com violação (esperado: 0).`,
    );
    return;
  }

  const limit: number = args.limit ?? inquiries.length;
  const llm = new OpenAiLlm(args.model);
  const results: BenchResult[] = [];

  for (const inq of inquiries.slice(0, limit) as Inquiry[]) {
    process.stdout.write(
      `[${results.length + 1}/${limit}] ${inq.quadrant} ${inq.question.slice(0, 60)}... `,
    );
    let outcome: Outcome;
    let attempts = 0;
    let finalQuery = "";
    let error: string | undefined;

    try {
      const res = await runPipeline(inq.question, ontology, llm, 3, rawTtl);
      attempts = res.attempts.length;
      finalQuery = res.finalQuery;

      if (res.status === "unknown") {
        outcome = "unknown";
      } else {
        let rows: Row[] = [];
        try {
          rows = await executeQuery(
            prepareForLocalExecution(res.finalQuery),
            data,
          );
        } catch (e) {
          error = String(e).split("\n")[0];
        }
        const accurate =
          error === undefined && sameResults(rows, goldRows.get(inq.id)!);
        const firstTime = res.attempts[0]!.violations.length === 0;
        outcome = accurate
          ? firstTime
            ? "ea-first-time"
            : "ea-with-repairs"
          : "inaccurate";
      }
    } catch (e) {
      outcome = "inaccurate";
      error = String(e).split("\n")[0];
    }

    console.log(outcome + (error ? ` (${error})` : ""));
    results.push({
      id: inq.id,
      quadrant: inq.quadrant,
      question: inq.question,
      outcome,
      attempts,
      finalQuery,
      error,
    });
  }

  printMetrics(results);
  const out = args.out ?? "bench-results.json";
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nDetalhes salvos em ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
