import { describe, it, expect } from "vitest";
import {
  isValidPurl,
  normalizePurlIdentity,
  parsePurl,
  purlEcosystem,
} from "../../src/utils/purl.js";

describe("purl helpers", () => {
  it("parses a standard purl", () => {
    const p = parsePurl("pkg:npm/lodash@4.17.21");
    expect(p?.type).toBe("npm");
    expect(p?.name).toBe("lodash");
    expect(p?.version).toBe("4.17.21");
  });

  it("rejects invalid purls without throwing", () => {
    expect(parsePurl("not-a-purl")).toBeNull();
    expect(parsePurl("")).toBeNull();
    expect(isValidPurl("pkg:npm/lodash@4.17.21")).toBe(true);
    expect(isValidPurl("lodash@4.17.21")).toBe(false);
  });

  it("extracts the ecosystem type fragment", () => {
    expect(purlEcosystem("pkg:npm/lodash@4.17.21")).toBe("npm");
    expect(purlEcosystem("pkg:deb/debian/libssl1.1@1.1.1n")).toBe("deb");
    expect(purlEcosystem("pkg:pypi/flask@2.3.2")).toBe("pypi");
    expect(purlEcosystem("bogus")).toBeNull();
  });

  it("normalizes to version-free identity", () => {
    expect(normalizePurlIdentity("pkg:npm/lodash@4.17.21")).toBe("pkg:npm/lodash");
    expect(normalizePurlIdentity("pkg:npm/lodash")).toBe("pkg:npm/lodash");
    // qualifiers + subpath stripped
    expect(normalizePurlIdentity("pkg:npm/lodash@4.17.21?arch=x64#dist/lodash.js")).toBe("pkg:npm/lodash");
    // scoped name keeps namespace
    expect(normalizePurlIdentity("pkg:npm/%40babel/core@7.0.0")).toBe("pkg:npm/%40babel/core");
    // invalid → null
    expect(normalizePurlIdentity("bogus")).toBeNull();
  });
});
