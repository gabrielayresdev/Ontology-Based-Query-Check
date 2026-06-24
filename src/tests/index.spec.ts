import { describe, expect, test } from "vitest";
import { Ontology } from "../ontology.js";
import { runChecks } from "../checks.js";

const PREFIX = "PREFIX org: <http://www.w3.org/ns/org#>\n";
const onto = Ontology.fromFile("src/ontologies/org.ttl");

describe("OBQC sobre a W3C Org Ontology", () => {
  test("query consistente não gera violação", async () => {
    const q =
      PREFIX +
      `SELECT ?super WHERE {
         ?o a org:Organization .
         ?o org:subOrganizationOf ?super .
       }`;
    expect(await runChecks(q, onto)).toHaveLength(0);
  });

  test("detecta violação de domínio", async () => {
    // hasUnit tem domínio FormalOrganization; sujeito é OrganizationalUnit.
    const q =
      PREFIX +
      `SELECT ?u WHERE {
         ?x a org:OrganizationalUnit .
         ?x org:hasUnit ?u .
       }`;
    const v = await runChecks(q, onto);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("domain");
    expect(v[0]!.message).toContain("FormalOrganization");
  });

  test("detecta violação de escopo (range)", async () => {
    // hasUnit tem range OrganizationalUnit; objeto é Organization (superclasse).
    const q =
      PREFIX +
      `SELECT ?o WHERE {
         ?o org:hasUnit ?u .
         ?u a org:Organization .
       }`;
    const v = await runChecks(q, onto);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("range");
    expect(v[0]!.message).toContain("OrganizationalUnit");
  });

  test("detecta variável do SELECT não vinculada no WHERE", async () => {
    const q =
      PREFIX +
      `SELECT ?org ?faltante WHERE {
         ?org a org:Organization .
       }`;
    const v = await runChecks(q, onto);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("undeclared-variable");
    expect(v[0]!.message).toContain("faltante");
  });
});
