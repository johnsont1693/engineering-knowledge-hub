import test from "node:test";
import assert from "node:assert/strict";
import { createIndexFromConfig, execute, parseArguments } from "../src/cli.mjs";

const sha = "a".repeat(40);

function index() {
  const repo = (id, accessGroup) => ({
    id,
    displayName: id,
    remoteUrl: null,
    commit: sha,
    collectedAt: "2026-10-09T00:00:00.000Z",
    status: "complete",
    accessGroup,
    fileCount: 0,
  });
  return {
    schemaVersion: "1.0",
    generatedAt: "2026-10-09T00:00:00.000Z",
    repositories: [repo("team-a", "group-a"), repo("team-b", "group-b")],
    applications: [],
    facts: [],
    chunks: [],
    warnings: [],
  };
}

const validApi = {
  readIndex() {
    return index();
  },
  validateIndex(value) {
    assert.ok(value.repositories);
    return value;
  },
  searchIndex(value, args) {
    assert.deepEqual(value.repositories.map(({ id }) => id), ["team-a"]);
    assert.deepEqual(args.repositoryIds, ["team-a"]);
    assert.equal(args.query, "literal words");
    assert.equal(Object.hasOwn(args, "maxResults"), false);
    return { matches: [], truncated: false };
  },
  compareFact(value, args) {
    assert.deepEqual(value.repositories.map(({ id }) => id), ["team-a"]);
    assert.deepEqual(args, { kind: "language" });
    return { values: [], unknown: ["team-a"], complete: true };
  },
  repositorySummary(value, repositoryId) {
    assert.deepEqual(value.repositories.map(({ id }) => id), ["team-a"]);
    return { repositoryId, facts: [] };
  },
};

test("parses repeated access groups and explicit option values", () => {
  assert.deepEqual(parseArguments(["--help"]), {
    command: "help",
    options: { help: true },
  });
  assert.deepEqual(parseArguments([
    "query", "--question", "router auth", "--access-group", "one",
    "--access-group=two",
    "--include-path", "README.md", "--include-path=src/**/*.py",
  ]), {
    command: "query",
    options: {
      question: "router auth",
      "access-group": ["one", "two"],
      "include-path": ["README.md", "src/**/*.py"],
    },
  });
});

test("ingest delegates source reading only to core and retains human mapping state", async () => {
  const calls = [];
  const config = {
    repositories: [{
      id: "repo-one",
      displayName: "Unit test repository",
      checkout: "C:\\checkouts\\repo-one",
      commit: sha,
      accessGroup: "group-one",
      includePaths: ["README.md", "src/**"],
    }],
    applications: [{
      id: "application-one",
      name: "Human-owned mapping",
      repositoryIds: ["repo-one"],
      status: "draft",
      reviewedBy: null,
      reviewedAt: null,
    }],
  };
  const result = await createIndexFromConfig(config, {
    ingestRepositories(specs, options) {
      calls.push({ specs, options });
      return { repositories: [], applications: [], facts: [], chunks: [], warnings: [] };
    },
  }, { includePaths: ["README.md"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].specs[0].commit, sha);
  assert.deepEqual(calls[0].specs[0].includePaths, ["README.md", "src/**"]);
  assert.deepEqual(calls[0].options, { includePaths: ["README.md"] });
  assert.equal(result.applications[0].status, "draft");
  assert.equal(result.applications[0].reviewedAt, null);
});

test("ingest rejects abbreviated commits before calling core", async () => {
  let called = false;
  await assert.rejects(createIndexFromConfig({
    repositories: [{
      id: "repo-one",
      displayName: "Unit test repository",
      checkout: "C:\\checkouts\\repo-one",
      commit: sha.slice(0, 7),
      accessGroup: "group-one",
    }],
  }, {
    ingestRepositories() {
      called = true;
    },
  }), /full lowercase 40-character commit SHA/);
  assert.equal(called, false);
});

test("query refuses to run without an access group", async () => {
  await assert.rejects(execute([
    "query", "--index", "unused", "--question", "literal words",
  ], validApi), /require at least one --access-group/);
});

test("query filters repositories before calling core and reports core truncation", async () => {
  const result = await execute([
    "query", "--index", "unused", "--question", "literal words",
    "--access-group", "group-a",
  ], validApiWith({ searchIndex: () => ({ matches: [], truncated: true }) }));
  assert.equal(result.completion, "partial");
  assert.equal(result.searchMode, "literal lexical matching only; not semantic understanding");
});

test("compare preserves missing evidence as unknown and scopes core to authorized repos", async () => {
  const result = await execute([
    "compare", "--index", "unused", "--kind", "language", "--access-group", "group-a",
  ], validApi);
  assert.deepEqual(result.result.unknown, ["team-a"]);
});

test("profile rejects a repository outside the selected access group", async () => {
  await assert.rejects(execute([
    "profile", "--index", "unused", "--repository-id", "team-b",
    "--access-group", "group-a",
  ], validApi), /not authorized/);
});

test("profile and validate expose core-backed results", async () => {
  const profile = await execute([
    "profile", "--index", "unused", "--repository-id", "team-a",
    "--access-group", "group-a",
  ], validApi);
  assert.equal(profile.result.repositoryId, "team-a");
  const validation = await execute(["validate", "--index", "unused"], validApi);
  assert.equal(validation.valid, true);
  assert.equal(validation.repositoryCount, 2);
});

test("query marks a bounded response partial instead of clipping citations", async () => {
  const result = await execute([
    "query", "--index", "unused", "--question", "x",
    "--access-group", "group-a", "--max-output-bytes", "512",
  ], validApiWith({ searchIndex: () => ({ matches: [{ citation: "x".repeat(2000) }] }) }));
  assert.equal(result.partial, true);
  assert.equal(result.omittedDueToOutputLimit, true);
  assert.match(result.message, /Rerun without/);
  assert.ok(Buffer.byteLength(JSON.stringify(result, null, 2)) <= 512);
});

function validApiWith(overrides) {
  return { ...validApi, ...overrides };
}
