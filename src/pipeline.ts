/**
 * Orquestra o fluxo completo do OBQC. `runPipeline` gera a SPARQL a partir da
 * pergunta, roda o OBQC (`runChecks`) e, havendo violações, pede reparo ao LLM,
 * repetindo até passar ou atingir o limite de reparos (então retorna "unknown").
 * `PipelineResult`/`Attempt` descrevem o resultado e o histórico de tentativas.
 */
import { Ontology } from "./ontology.js";
import { runChecks, Violation } from "./checks.js";
import { Llm } from "./llm.js";

export interface Attempt {
  query: string;
  violations: Violation[];
}

export interface PipelineResult {
  status: "ok" | "unknown";
  finalQuery: string;
  attempts: Attempt[];
}

export async function runPipeline(
  question: string,
  ontology: Ontology,
  llm: Llm,
  maxRepairs = 3,
  schemaText?: string,
): Promise<PipelineResult> {
  const schema = schemaText ?? ontology.describeForPrompt();
  const attempts: Attempt[] = [];

  let query = await llm.generateSparql(question, schema);

  for (let repair = 0; ; repair++) {
    const violations = await runChecks(query, ontology);
    attempts.push({ query, violations });

    if (violations.length === 0) {
      return { status: "ok", finalQuery: query, attempts };
    }
    if (repair >= maxRepairs) {
      return { status: "unknown", finalQuery: query, attempts };
    }

    query = await llm.repairSparql(
      query,
      violations.map((v) => v.message),
      schema,
    );
  }
}
