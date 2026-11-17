import { describe, expect, it } from "vitest";
import { parseDesignDoc } from "./design-doc.ts";
import { splitFrontmatter } from "./frontmatter.ts";

describe("splitFrontmatter", () => {
  it("separates YAML data from the body", () => {
    expect(splitFrontmatter("---\nid: a\n---\n# Title\n")).toEqual({
      data: { id: "a" },
      body: "# Title\n",
    });
  });

  it("treats a file without frontmatter as all body", () => {
    expect(splitFrontmatter("# Title\n")).toEqual({ data: {}, body: "# Title\n" });
  });

  it("rejects frontmatter that isn't a mapping", () => {
    expect(() => splitFrontmatter("---\n- a\n---\n")).toThrow("mapping");
  });
});

describe("parseDesignDoc", () => {
  it("reads id, depends_on, and project", () => {
    expect(
      parseDesignDoc("---\nid: add-login\ndepends_on: ./auth.md\nproject: ../proj\n---\nbody"),
    ).toEqual({
      kind: "doc",
      meta: { id: "add-login", dependsOn: ["./auth.md"], project: "../proj" },
    });
  });

  it("accepts a list of dependencies", () => {
    const result = parseDesignDoc("---\nid: a\ndepends_on: [./b.md, ./c.md]\n---\n");

    expect(result).toMatchObject({ meta: { dependsOn: ["./b.md", "./c.md"] } });
  });

  it("reports docs without an id", () => {
    expect(parseDesignDoc("# Just notes\n")).toEqual({ kind: "no-id" });
  });

  it.each([
    ["an id with spaces", "---\nid: has space\n---\n"],
    ["a numeric id", "---\nid: 12\n---\n"],
    ["an id ending in .lock", "---\nid: x.lock\n---\n"],
    ["a non-string dependency", "---\nid: a\ndepends_on: [1]\n---\n"],
    ["an empty project", "---\nid: a\nproject: ''\n---\n"],
    ["broken YAML", "---\nid: [a\n---\n"],
  ])("rejects %s", (_name, content) => {
    expect(parseDesignDoc(content).kind).toBe("invalid");
  });
});
