import { describe, it, expect } from "vitest";
import { TrueNASClient } from "../client.js";
import { buildRegistry } from "../tools/index.js";

/**
 * End-to-end response-filter coverage through the action pipeline.
 *
 * filters.test.ts exercises filterSensitiveFields() in isolation, but every
 * handler JSON.stringifies its payload into content[].text BEFORE the registry
 * filters it — so the unit tests never caught that the registry-level filter
 * couldn't see into the stringified text (secrets shipped in cleartext). These
 * drive real handlers through registry.execute with a stub client returning
 * sensitive data and assert the secrets are redacted in the emitted content.
 */
function makeStubRegistry(returnValue: unknown) {
  const client = new TrueNASClient({ baseUrl: "http://stub", apiKey: "stub", verifySsl: true });
  // Replace the WebSocket round-trip with a canned sensitive payload.
  (client as unknown as { call: TrueNASClient["call"] }).call =
    (async () => returnValue) as TrueNASClient["call"];
  return buildRegistry(client);
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

describe("Response filtering through the action pipeline", () => {
  it("redacts top-level and nested secrets in an action response", async () => {
    const registry = makeStubRegistry([
      {
        id: 9,
        name: "charmworkspaces",
        password: "top-level-secret",
        devices: [
          { attributes: { dtype: "DISPLAY", type: "SPICE", password: "nested-spice-secret" } },
        ],
      },
    ]);

    const text = textOf(await registry.execute("vm", "vm_list", {}));

    expect(text).not.toContain("top-level-secret");
    expect(text).not.toContain("nested-spice-secret");
    expect(text).toContain("[REDACTED]");
    // Non-sensitive fields are preserved.
    expect(text).toContain("charmworkspaces");
    expect(text).toContain("DISPLAY");
  });

  it("leaves a benign payload unchanged (no over-redaction)", async () => {
    const registry = makeStubRegistry([{ id: 9, name: "charmworkspaces", vcpus: 4 }]);
    const text = textOf(await registry.execute("vm", "vm_list", {}));

    expect(text).not.toContain("[REDACTED]");
    expect(text).toContain("charmworkspaces");
    expect(text).toContain('"vcpus": 4');
  });

  it("preserves the 2-space indentation handlers emit", async () => {
    const registry = makeStubRegistry({ a: 1, b: { c: 2 } });
    const text = textOf(await registry.execute("vm", "vm_list", {}));

    // Re-serialized with the same formatting → nested keys stay indented.
    expect(text).toContain('\n  "a": 1');
  });
});
