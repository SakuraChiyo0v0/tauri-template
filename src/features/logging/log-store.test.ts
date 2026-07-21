import { beforeEach, describe, expect, it } from "vitest";
import {
  appendLogEntry,
  clearLogEntries,
  filterLogEntries,
  getLogSnapshot,
  serializeLogEntries,
} from "./log-store";

describe("log store", () => {
  beforeEach(() => clearLogEntries());

  it("stores newest entries first and caps the session buffer", () => {
    for (let index = 0; index < 1_005; index += 1) {
      appendLogEntry({ level: "debug", source: "test", message: `entry-${index}` });
    }

    expect(getLogSnapshot()).toHaveLength(1_000);
    expect(getLogSnapshot()[0].message).toBe("entry-1004");
    expect(getLogSnapshot()[999].message).toBe("entry-5");
  });

  it("filters by level and case-insensitive source or message text", () => {
    appendLogEntry({ level: "info", source: "frontend", message: "Application ready" });
    appendLogEntry({ level: "error", source: "runtime", message: "Database unavailable" });

    expect(filterLogEntries(getLogSnapshot(), "error", "DATA")).toHaveLength(1);
    expect(filterLogEntries(getLogSnapshot(), "all", "FRONT")[0].message).toBe("Application ready");
  });

  it("serializes the selected entries as JSON and readable text", () => {
    appendLogEntry({
      level: "warn",
      source: "runtime",
      message: "Retrying connection",
      timestamp: "2026-07-21T10:20:30.000Z",
    });
    const entries = getLogSnapshot();

    expect(JSON.parse(serializeLogEntries(entries, "json"))).toMatchObject([
      { level: "warn", source: "runtime", message: "Retrying connection" },
    ]);
    expect(serializeLogEntries(entries, "text")).toBe(
      "[2026-07-21T10:20:30.000Z] [WARN] [runtime] Retrying connection",
    );
  });
});
