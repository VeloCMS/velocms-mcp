import { describe, expect, it } from "vitest";
import { formatMissingEnvMessage, resolveEnvConfig } from "../src/env.js";

describe("resolveEnvConfig", () => {
  it("resolves both vars when present", () => {
    const result = resolveEnvConfig({
      VELOCMS_SITE_URL: "https://myblog.velocms.org",
      VELOCMS_API_KEY: "velo_abc",
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({
        siteUrl: "https://myblog.velocms.org",
        apiKey: "velo_abc",
      });
    }
  });

  it("fails fast (ok:false) when VELOCMS_SITE_URL is missing", () => {
    const result = resolveEnvConfig({ VELOCMS_API_KEY: "velo_abc" } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["VELOCMS_SITE_URL"]);
  });

  it("fails fast (ok:false) when VELOCMS_API_KEY is missing", () => {
    const result = resolveEnvConfig({
      VELOCMS_SITE_URL: "https://x.velocms.org",
    } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["VELOCMS_API_KEY"]);
  });

  it("fails fast (ok:false) listing both when neither is set", () => {
    const result = resolveEnvConfig({} as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["VELOCMS_SITE_URL", "VELOCMS_API_KEY"]);
    }
  });

  it("treats an empty-string value the same as unset", () => {
    const result = resolveEnvConfig({
      VELOCMS_SITE_URL: "",
      VELOCMS_API_KEY: "",
    } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["VELOCMS_SITE_URL", "VELOCMS_API_KEY"]);
    }
  });
});

describe("formatMissingEnvMessage", () => {
  it("names every missing variable and never leaks a key-shaped value", () => {
    const msg = formatMissingEnvMessage(["VELOCMS_SITE_URL", "VELOCMS_API_KEY"]);
    expect(msg).toContain("VELOCMS_SITE_URL");
    expect(msg).toContain("VELOCMS_API_KEY");
    expect(msg).not.toMatch(/velo_/);
  });
});
