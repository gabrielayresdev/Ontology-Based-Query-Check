import argv from "minimist";
import fs from "fs";
import { Ontology } from "./ontology.js";
import { runChecks } from "./checks.js";

const DEFAULT_ONTOLOGY = "src/ontologies/org.ttl";

async function main() {
  const args = argv(process.argv.slice(2));

  const query: string | undefined = args.query;
  const ontologyPath = DEFAULT_ONTOLOGY;

  if (!query) {
    console.error("Uso: pnpm dev --query '<SPARQL>'");
    process.exit(1);
  }

  const ontology = Ontology.fromFile(ontologyPath);
  const violations = await runChecks(query, ontology);

  if (violations.length === 0) {
    console.log(
      "✓ Nenhuma violação encontrada — a query é consistente com a ontologia.",
    );
    return;
  }

  console.log(`✗ ${violations.length} problema(s) encontrado(s):\n`);
  for (const v of violations) {
    console.log(`  [${v.rule}] ${v.message}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
