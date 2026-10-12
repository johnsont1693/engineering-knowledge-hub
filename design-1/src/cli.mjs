#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;

export class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (command === "--help" || command === "-h") {
    return { command: "help", options: { help: true } };
  }
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new CliError(`Unexpected argument: ${token}`);
    }
    const separator = token.indexOf("=");
    const key = token.slice(2, separator === -1 ? undefined : separator);
    const value = separator === -1 ? tokens[++index] : token.slice(separator + 1);
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`Missing value for --${key}`);
    }
    if (key === "access-group" || key === "repository-id" || key === "include-path") {
      options[key] ??= [];
      options[key].push(value);
    } else if (Object.hasOwn(options, key)) {
      throw new CliError(`Option --${key} may only be supplied once`);
    } else {
      options[key] = value;
    }
  }
  return { command, options };
}

function required(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new CliError(`Required option missing: --${key}`);
  }
  return value;
}

function requiredSingle(options, key) {
  const value = options[key];
  if (Array.isArray(value) && value.length === 1) return value[0];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new CliError(`Required option must be supplied exactly once: --${key}`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(resolve(filePath), "utf8"));
  } catch (error) {
    throw new CliError(`Cannot read JSON file "${filePath}": ${error.message}`);
  }
}

async function writeJson(filePath, value) {
  const destination = resolve(filePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return destination;
}

function validateUserConfig(config, { allowEmpty = false } = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new CliError("Configuration must be a JSON object.");
  }
  if (!Array.isArray(config.repositories)) {
    throw new CliError('Configuration requires a "repositories" array.');
  }
  if (!allowEmpty && config.repositories.length === 0) {
    throw new CliError('Configuration must name at least one repository.');
  }
  const repositories = new Map();
  for (const repository of config.repositories) {
    if (!repository || typeof repository !== "object") {
      throw new CliError("Each repository entry must be an object.");
    }
    for (const key of ["id", "displayName", "checkout", "commit", "accessGroup"]) {
      if (typeof repository[key] !== "string" || repository[key].trim() === "") {
        throw new CliError(`Each repository requires a non-empty "${key}".`);
      }
    }
    if (!ID_PATTERN.test(repository.id)) {
      throw new CliError(`Invalid repository id "${repository.id}".`);
    }
    if (!SHA_PATTERN.test(repository.commit)) {
      throw new CliError(`Repository "${repository.id}" must pin a full lowercase 40-character commit SHA.`);
    }
    if (repositories.has(repository.id)) {
      throw new CliError(`Duplicate repository id "${repository.id}".`);
    }
    if (
      repository.includePaths !== undefined &&
      (!Array.isArray(repository.includePaths) ||
        repository.includePaths.length === 0 ||
        repository.includePaths.some((pattern) => typeof pattern !== "string" || pattern.trim() === ""))
    ) {
      throw new CliError(`Repository "${repository.id}" includePaths must be a non-empty array of path globs.`);
    }
    repositories.set(repository.id, repository);
  }

  if (config.applications !== undefined && !Array.isArray(config.applications)) {
    throw new CliError('"applications" must be an array when supplied.');
  }
  const applicationIds = new Set();
  for (const application of config.applications ?? []) {
    if (!application || typeof application !== "object") {
      throw new CliError("Each application entry must be an object.");
    }
    for (const key of ["id", "name", "status"]) {
      if (typeof application[key] !== "string" || application[key].trim() === "") {
        throw new CliError(`Each application requires a non-empty "${key}".`);
      }
    }
    if (!ID_PATTERN.test(application.id) || applicationIds.has(application.id)) {
      throw new CliError(`Invalid or duplicate application id "${application.id}".`);
    }
    if (!["draft", "approved"].includes(application.status)) {
      throw new CliError(`Application "${application.id}" status must be draft or approved.`);
    }
    if (!Array.isArray(application.repositoryIds) || application.repositoryIds.length === 0) {
      throw new CliError(`Application "${application.id}" must list repositoryIds.`);
    }
    if (application.repositoryIds.some((repositoryId) => typeof repositoryId !== "string")) {
      throw new CliError(`Application "${application.id}" repositoryIds must be strings.`);
    }
    if (new Set(application.repositoryIds).size !== application.repositoryIds.length) {
      throw new CliError(`Application "${application.id}" contains duplicate repositoryIds.`);
    }
    for (const repositoryId of application.repositoryIds) {
      if (!repositories.has(repositoryId)) {
        throw new CliError(`Application "${application.id}" refers to unknown repository "${repositoryId}".`);
      }
    }
    if (
      application.reviewedBy !== undefined &&
      application.reviewedBy !== null &&
      typeof application.reviewedBy !== "string"
    ) {
      throw new CliError(`Application "${application.id}" reviewedBy must be a string or null.`);
    }
    if (
      application.reviewedAt !== undefined &&
      application.reviewedAt !== null &&
      (typeof application.reviewedAt !== "string" || Number.isNaN(Date.parse(application.reviewedAt)))
    ) {
      throw new CliError(`Application "${application.id}" reviewedAt must be a date-time string or null.`);
    }
    applicationIds.add(application.id);
  }
  return config;
}

async function loadApi(injectedApi) {
  if (injectedApi) return injectedApi;
  return import("../../core/index.mjs");
}

function authorizedIndex(index, groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new CliError("Read commands require at least one --access-group; access is filtered before core calls.");
  }
  const allowed = new Set(
    (index.repositories ?? [])
      .filter((repository) => groups.includes(repository.accessGroup))
      .map((repository) => repository.id),
  );
  if (allowed.size === 0) {
    throw new CliError("No repositories are authorized for the supplied access group(s).", 3);
  }
  const visibleApplications = (index.applications ?? []).filter((application) =>
    application.repositoryIds.every((repositoryId) => allowed.has(repositoryId)),
  );
  return {
    ...index,
    repositories: index.repositories.filter((repository) => allowed.has(repository.id)),
    applications: visibleApplications,
    facts: (index.facts ?? []).filter((fact) => allowed.has(fact.repositoryId)),
    chunks: (index.chunks ?? []).filter((chunk) => allowed.has(chunk.repositoryId)),
  };
}

function completionStatus(result) {
  if (!result || typeof result !== "object") return "unreported";
  if (
    result.partial === true ||
    result.truncated === true ||
    result.complete === false ||
    result.status === "partial" ||
    result.coverage?.partial === true ||
    result.coverage?.truncated === true ||
    result.coverage?.complete === false ||
    result.coverage?.status === "partial"
  ) {
    return "partial";
  }
  if (
    result.complete === true ||
    result.truncated === false ||
    result.status === "complete" ||
    result.coverage?.complete === true ||
    result.coverage?.status === "complete"
  ) {
    return "complete";
  }
  return "unreported";
}

function validateOutputLimit(options) {
  if (options["max-output-bytes"] === undefined) return undefined;
  const limit = Number(options["max-output-bytes"]);
  if (!Number.isSafeInteger(limit) || limit < 512) {
    throw new CliError("--max-output-bytes must be an integer of at least 512.");
  }
  return limit;
}

export async function createIndexFromConfig(config, api, ingestionOptions = {}) {
  const validated = validateUserConfig(config);
  const specs = validated.repositories.map(({ id, displayName, checkout, commit, accessGroup, includePaths }) => ({
    id,
    displayName,
    checkout,
    commit,
    accessGroup,
    ...(includePaths !== undefined ? { includePaths } : {}),
  }));
  const index = await api.ingestRepositories(specs, ingestionOptions);
  index.applications = (validated.applications ?? []).map((application) => ({
    id: application.id,
    name: application.name,
    repositoryIds: application.repositoryIds,
    status: application.status,
    ...(application.reviewedBy !== undefined ? { reviewedBy: application.reviewedBy } : {}),
    ...(application.reviewedAt !== undefined ? { reviewedAt: application.reviewedAt } : {}),
  }));
  return index;
}

function boundResult(result, limit) {
  if (limit === undefined) return result;
  const json = JSON.stringify(result, null, 2);
  const actualBytes = Buffer.byteLength(json, "utf8");
  if (actualBytes <= limit) return result;
  return {
    command: result.command,
    completeness: "partial",
    partial: true,
    omittedDueToOutputLimit: true,
    requiredBytes: actualBytes,
    limitBytes: limit,
    message: "Full results and citations were omitted rather than silently truncated. Rerun without --max-output-bytes.",
  };
}

export async function execute(argv, injectedApi) {
  const { command, options } = parseArguments(argv);
  if (options.help || command === "help" || !command) {
    return { help: helpText };
  }
  const api = await loadApi(injectedApi);

  if (command === "onboard") {
    const configPath = required(options, "config");
    let config;
    try {
      config = await readJson(configPath);
    } catch (error) {
      if (!error.message.includes("ENOENT")) throw error;
      config = { repositories: [] };
    }
    validateUserConfig(config, { allowEmpty: true });
    const repository = {
      id: required(options, "id"),
      displayName: required(options, "display-name"),
      checkout: required(options, "checkout"),
      commit: required(options, "commit"),
      accessGroup: requiredSingle(options, "access-group"),
      ...(options["include-path"] !== undefined ? { includePaths: options["include-path"] } : {}),
    };
    const next = validateUserConfig({
      ...config,
      repositories: [...config.repositories, repository],
    });
    const destination = await writeJson(configPath, next);
    return { command, configPath: destination, repositoryId: repository.id, result: "configuration updated" };
  }

  if (command === "ingest") {
    const config = await readJson(required(options, "config"));
    const index = await createIndexFromConfig(config, api);
    const destination = await writeJson(required(options, "output"), index);
    return {
      command,
      output: destination,
      status: "written locally; no network, publish, or pull request performed",
      repositoryCount: index.repositories?.length ?? 0,
      factCount: index.facts?.length ?? 0,
      chunkCount: index.chunks?.length ?? 0,
      warnings: index.warnings ?? [],
    };
  }

  if (command === "validate") {
    const index = api.readIndex
      ? await api.readIndex(required(options, "index"))
      : await readJson(required(options, "index"));
    await api.validateIndex(index);
    return {
      command,
      valid: true,
      repositoryCount: index.repositories.length,
      factCount: index.facts.length,
      chunkCount: index.chunks.length,
      warningCount: index.warnings.length,
    };
  }

  if (command === "query" || command === "compare" || command === "profile") {
    const index = api.readIndex
      ? await api.readIndex(required(options, "index"))
      : await readJson(required(options, "index"));
    await api.validateIndex(index);
    const visible = authorizedIndex(index, options["access-group"]);

    if (command === "query") {
      const query = required(options, "question");
      let repositoryIds = visible.repositories.map((repository) => repository.id);
      if (options["repository-id"]) {
        const requested = new Set(options["repository-id"]);
        const unauthorized = [...requested].filter((repositoryId) =>
          !repositoryIds.includes(repositoryId),
        );
        if (unauthorized.length) {
          throw new CliError(`Repository id(s) are not authorized: ${unauthorized.join(", ")}.`, 3);
        }
        repositoryIds = repositoryIds.filter((repositoryId) => requested.has(repositoryId));
      }
      const result = await api.searchIndex(visible, {
        query,
        repositoryIds,
      });
      return boundResult({
        command,
        searchMode: "literal lexical matching only; not semantic understanding",
        completion: completionStatus(result),
        result,
      }, validateOutputLimit(options));
    }

    if (command === "compare") {
      const kind = required(options, "kind");
      const args = { kind };
      if (options.name !== undefined) args.name = options.name;
      const result = await api.compareFact(visible, args);
      return boundResult({
        command,
        comparison: "deterministic extracted facts; absent evidence is unknown",
        result,
      }, validateOutputLimit(options));
    }

    const repositoryId = requiredSingle(options, "repository-id");
    if (!visible.repositories.some((repository) => repository.id === repositoryId)) {
      throw new CliError(`Repository id "${repositoryId}" is not authorized.`, 3);
    }
    const result = await api.repositorySummary(visible, repositoryId);
    return boundResult({ command, result }, validateOutputLimit(options));
  }

  throw new CliError(`Unknown command "${command}".`);
}

const helpText = `Commit-pinned engineering knowledge CLI (Node.js 24)

Commands:
  onboard --config FILE --id ID --display-name NAME --checkout PATH --commit SHA --access-group GROUP
          [--include-path REPO-RELATIVE-GLOB ...]
  ingest  --config FILE --output FILE
  query   --index FILE --question TEXT --access-group GROUP [--access-group GROUP ...]
          [--repository-id ID ...] [--max-output-bytes N]
  compare --index FILE --kind KIND [--name NAME] --access-group GROUP [--max-output-bytes N]
  profile --index FILE --repository-id ID --access-group GROUP [--max-output-bytes N]
  validate --index FILE

Ingest requires full, lowercase 40-character commit SHAs in the human-maintained
configuration. It reads only through the shared core API and writes the requested
local index. It never fetches, runs repository code, publishes, or opens a PR.
Query returns core lexical matches and citations; it does not synthesize answers.
Access-group filtering is a local policy filter, not identity authentication.
`;

async function main(argv) {
  try {
    const result = await execute(argv);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
