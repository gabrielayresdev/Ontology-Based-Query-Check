/**
 * Camada de acesso ao LLM. A interface `Llm` abstrai as duas operações do fluxo
 * — `generateSparql` (pergunta em NL -> SPARQL) e `repairSparql` (reescreve a
 * query a partir das violações do OBQC) — permitindo trocar o provedor e injetar
 * mocks nos testes. `OpenAiLlm` a implementa via API da OpenAI, com prompts
 * espelhando os do paper.
 */
import OpenAI from "openai";

export interface Llm {
  generateSparql(question: string, ontology: string): Promise<string>;
  repairSparql(
    query: string,
    issues: string[],
    ontology: string,
  ): Promise<string>;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/```(?:sparql)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

export class OpenAiLlm implements Llm {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(model = process.env.OPENAI_MODEL ?? "gpt-4.1-nano") {
    this.client = new OpenAI();
    this.model = model;
  }

  private async complete(system: string, user: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return stripCodeFence(res.choices[0]?.message?.content ?? "");
  }

  generateSparql(question: string, ontology: string): Promise<string> {
    const user =
      `Given the OWL model described in the following TTL file:\n${ontology}\n` +
      `Write a SPARQL query that answers the question.\n` +
      `Do not explain the query. Return just the query,\n` +
      `so it can be run verbatim from your response.\n` +
      `Here's the question: ${question}`;
    return this.complete("You write SPARQL queries.", user);
  }

  repairSparql(
    query: string,
    issues: string[],
    _ontology: string,
  ): Promise<string> {
    const user =
      `We have a query ${query} with some issues outlined here ${issues.join("; ")}\n` +
      `Please re-write it. Do not explain the query. Return just the query,\n` +
      `so it can be run verbatim from your response.`;
    return this.complete("You fix SPARQL queries.", user);
  }
}
