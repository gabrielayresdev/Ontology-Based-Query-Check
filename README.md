# OBQC — Ontology-Based Query Check

Protótipo do **OBQC** (*Ontology-Based Query Check*) do artigo
*"Increasing the LLM Accuracy for Question Answering: Ontologies to the Rescue!"*
([arXiv:2405.11706](https://arxiv.org/abs/2405.11706)), desenvolvido como trabalho
final da disciplina de Web Semântica (UFRJ/DCC).

O fluxo completo é reproduzido em uma CLI:

> pergunta em linguagem natural → **Text-to-SPARQL** (OpenAI) → **OBQC** (checagem
> ontológica) → **LLM Repair** (loop, máx. 3 reparos, senão `unknown`) → execução
> da SPARQL final contra o A-Box.

A avaliação usa o benchmark *ACME Insurance* do próprio artigo, materializado
localmente a partir dos CSVs e do mapeamento R2RML (`src/benchmark/`).

## Requisitos

- **Node.js ≥ 22** — o projeto usa o módulo nativo `node:sqlite` para materializar
  o A-Box. (Desenvolvido/testado no Node 24.)
- **pnpm** (recomendado; qualquer gerenciador compatível funciona).
- Uma **chave da API da OpenAI** (só é necessária para rodar o pipeline com LLM;
  não é preciso para `--sanity` nem para os testes).

## Instalação

```bash
pnpm install
```

## Configuração

Copie o exemplo de ambiente e preencha a sua chave:

```bash
cp .env-example .env
```

`.env`:

```
OPENAI_API_KEY=sk-...      # obrigatório para rodar com LLM
OPENAI_MODEL=gpt-4.1-nano  # opcional; default: gpt-4.1-nano
```

O arquivo `.env` é carregado automaticamente pelo runner (`process.loadEnvFile()`).

## Execução

### Benchmark com LLM (fluxo OBQC completo)

Roda as 44 perguntas do benchmark pelo pipeline completo, imprime as métricas
agregadas (comparadas com a Table 1 do artigo) e salva o detalhe em
`bench-results.json`:

```bash
pnpm bench
```

Flags disponíveis (passe-as **direto**, sem `--` antes — o pnpm as consome):

| Flag | Descrição |
|---|---|
| `--sanity`   | Valida os gabaritos **sem chamar a LLM** (não precisa de chave). |
| `--limit N`  | Roda apenas as N primeiras perguntas. |
| `--model X`  | Usa o modelo OpenAI `X` nesta execução. |
| `--out FILE` | Caminho do JSON de saída (default: `bench-results.json`). |

Exemplos:

```bash
pnpm bench --sanity           # checagem seca dos 44 gabaritos, sem custo de API
pnpm bench --limit 5          # roda só as 5 primeiras perguntas
pnpm bench --model gpt-4o     # usa outro modelo
```

### Testes

Suíte com a LLM mockada (não consome API):

```bash
pnpm test          # roda uma vez
pnpm test:watch    # modo watch
```

## Estrutura do projeto

```
src/
├── bench.ts        # runner do benchmark (CLI, métricas, JSON de saída)
├── benchmark.ts    # carga das 44 perguntas, prep. para execução local, métrica EA
├── pipeline.ts     # orquestra NL → SPARQL → OBQC → repair → resultado
├── ontology.ts     # T-Box (Comunica), subClassOf* e descrição p/ o prompt
├── parser.ts       # parsing da SPARQL via sparqlalgebrajs
├── checks.ts       # as 3 checagens OBQC (domínio, range/escopo, variáveis)
├── llm.ts          # cliente OpenAI (interface Llm injetável) + prompts do artigo
├── data.ts         # execução de SPARQL via Comunica (+ fn:date_diff)
├── r2rml.ts        # materialização do A-Box: CSV → SQLite → triplos RDF
├── benchmark/      # ontologia de seguros, mapping R2RML e CSVs do ACME Insurance
└── tests/          # testes (Vitest) com LLM mockada
```

## Notas de reprodução

O benchmark segue o artigo, com alguns desvios documentados:

- O A-Box é **materializado** localmente (CSV → SQLite → RDF), e não virtualizado
  como no artigo original.
- O modelo default é `gpt-4.1-nano` (não GPT-4), configurável via `OPENAI_MODEL`
  ou `--model`.
- Dois templates com grafia inconsistente no `mapping.r2rml` original foram
  corrigidos para a materialização funcionar.
