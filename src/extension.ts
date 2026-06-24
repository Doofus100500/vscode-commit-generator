import * as childProcess from "child_process";
import * as path from "path";
import * as vscode from "vscode";

type DiffMode = "staged" | "unstaged" | "auto";

const DEFAULT_PROMPT_TEMPLATE = [
  "Сгенерируй сообщение Git-коммита на русском языке для предоставленного diff.",
  "",
  "Правила:",
  "Верни только сообщение коммита.",
  "Не используй Conventional Commits, списки, кавычки, Markdown и пояснения.",
  "Пиши естественно, кратко и понятно по-русски.",
  "Формулируй от имени автора изменения в прошедшем времени: Добавил, Исправил, Удалил, Обновил.",
  "Не используй английский повелительный стиль Git.",
  "Первая строка должна описывать главное изменение и быть не длиннее 72 символов.",
  "Добавляй короткое тело только если без него изменение непонятно.",
  "Не добавляй деталей, которых нет в diff.",
  "",
  "Diff mode: {diffMode}",
  "Diff:",
  "{diff}"
].join("\n");

interface GitApi {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox?: {
    value: string;
  };
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

interface DiffInfo {
  mode: Exclude<DiffMode, "auto">;
  diff: string;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand("commitGenerator.generateCommitMessage", generateCommitMessage)
  );
}

async function generateCommitMessage(): Promise<void> {
  const output = vscode.window.createOutputChannel("Commit Generator");

  try {
    const gitApi = await getGitApi();
    const repo = await pickRepository(gitApi);
    const repoRoot = repo ? repo.rootUri.fsPath : await getWorkspaceGitRoot();
    const config = vscode.workspace.getConfiguration("commitGenerator");

    const diffInfo = await getDiff(repoRoot, config.get<DiffMode>("diffMode", "staged"));
    if (!diffInfo.diff.trim()) {
      vscode.window.showInformationMessage("No changes found for commit message generation.");
      return;
    }

    const maxDiffBytes = config.get<number>("maxDiffBytes", 120000);
    const diffBytes = Buffer.byteLength(diffInfo.diff, "utf8");
    if (diffBytes > maxDiffBytes) {
      throw new Error(
        `Diff is too large (${diffBytes} bytes). Increase commitGenerator.maxDiffBytes or stage fewer files.`
      );
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating commit message with API",
        cancellable: false
      },
      async () => {
        const message = await runApi(diffInfo, config, output);
        await applyCommitMessage(repo, message);
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(message);
    output.show(true);
    vscode.window.showErrorMessage(`Commit Generator: ${message}`);
  }
}

async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension) {
    return undefined;
  }

  const gitExtension = extension.isActive ? extension.exports : await extension.activate();
  return gitExtension.getAPI(1);
}

async function pickRepository(gitApi: GitApi | undefined): Promise<GitRepository | undefined> {
  const repositories = gitApi?.repositories ?? [];
  if (repositories.length === 0) {
    return undefined;
  }

  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (activeFile) {
    const activeRepo = repositories.find((repository) => {
      const root = repository.rootUri.fsPath;
      return activeFile === root || activeFile.startsWith(root + path.sep);
    });
    if (activeRepo) {
      return activeRepo;
    }
  }

  if (repositories.length === 1) {
    return repositories[0];
  }

  const picked = await vscode.window.showQuickPick(
    repositories.map((repository) => ({
      label: path.basename(repository.rootUri.fsPath),
      description: repository.rootUri.fsPath,
      repository
    })),
    { placeHolder: "Select a Git repository" }
  );

  return picked?.repository;
}

async function getWorkspaceGitRoot(): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a Git workspace first.");
  }

  const root = await execFile("git", ["rev-parse", "--show-toplevel"], folder.uri.fsPath);
  return root.trim();
}

async function getDiff(repoRoot: string, mode: DiffMode): Promise<DiffInfo> {
  if (mode === "auto") {
    const staged = await gitDiff(repoRoot, "staged");
    if (staged.trim()) {
      return { mode: "staged", diff: staged };
    }
    return { mode: "unstaged", diff: await gitDiff(repoRoot, "unstaged") };
  }

  const diff = await gitDiff(repoRoot, mode);
  if (diff.trim() || mode === "unstaged") {
    return { mode, diff };
  }

  const choice = await vscode.window.showInformationMessage(
    "No staged changes found. Generate a message from unstaged changes?",
    "Use unstaged",
    "Cancel"
  );

  if (choice !== "Use unstaged") {
    return { mode, diff: "" };
  }

  return { mode: "unstaged", diff: await gitDiff(repoRoot, "unstaged") };
}

function gitDiff(repoRoot: string, mode: Exclude<DiffMode, "auto">): Promise<string> {
  const args = mode === "staged" ? ["diff", "--cached", "--"] : ["diff", "--"];
  return execFile("git", args, repoRoot);
}

async function runApi(
  diffInfo: DiffInfo,
  config: vscode.WorkspaceConfiguration,
  output: vscode.OutputChannel
): Promise<string> {
  const apiUrl = config.get<string>("apiUrl", "").trim();
  const apiKey = config.get<string>("apiKey", "").trim();
  const apiKeyHeader = config.get<string>("apiKeyHeader", "Authorization").trim();
  const apiKeyPrefix = config.get<string>("apiKeyPrefix", "Bearer").trim();
  const timeoutMs = config.get<number>("timeoutMs", 120000);
  const model = config.get<string>("model", "").trim();
  const temperature = config.get<number>("temperature", 0.2);
  const extraBody = parseExtraBody(config.get<string>("extraBody", ""));
  const promptTemplate = config.get<string>("promptTemplate", DEFAULT_PROMPT_TEMPLATE);

  if (!apiUrl) {
    throw new Error("Set commitGenerator.apiUrl before generating a commit message.");
  }

  if (!apiKey) {
    throw new Error("Set commitGenerator.apiKey before generating a commit message.");
  }

  if (!apiKeyHeader) {
    throw new Error("Set commitGenerator.apiKeyHeader before generating a commit message.");
  }

  const prompt = buildPrompt(diffInfo, promptTemplate);
  const requestBody: Record<string, unknown> = {
    messages: [
      {
        role: "system",
        content:
          "Ты помогаешь писать краткие сообщения Git-коммитов на русском языке. Возвращай только сообщение коммита."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature
  };

  if (model) {
    requestBody.model = model;
  }

  Object.assign(requestBody, extraBody);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    [apiKeyHeader]: apiKeyPrefix ? `${apiKeyPrefix} ${apiKey}` : apiKey
  };

  output.appendLine(`POST ${apiUrl}`);
  if (model) {
    output.appendLine(`Model: ${model}`);
  }

  const responseJson = await postJson(apiUrl, headers, requestBody, timeoutMs);
  return sanitizeCommitMessage(extractCommitMessage(responseJson));
}

function buildPrompt(diffInfo: DiffInfo, promptTemplate: string): string {
  const template = promptTemplate.trim() || DEFAULT_PROMPT_TEMPLATE;
  return template.replaceAll("{diffMode}", diffInfo.mode).replaceAll("{diff}", diffInfo.diff);
}

function sanitizeCommitMessage(message: string): string {
  let cleaned = message.trim();
  cleaned = cleaned.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "").trim();
  cleaned = cleaned.replace(/^commit message:\s*/i, "").trim();

  if (
    (cleaned.startsWith("\"") && cleaned.endsWith("\"")) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  if (!cleaned) {
    throw new Error("API returned an empty commit message.");
  }

  return cleaned;
}

function parseExtraBody(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`commitGenerator.extraBody must be valid JSON: ${message}`);
  }

  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new Error("commitGenerator.extraBody must be a JSON object.");
  }

  return parsed;
}

async function postJson(
  apiUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`API timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API returned HTTP ${response.status}: ${text.trim()}`);
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function extractCommitMessage(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }

  if (!isRecord(response)) {
    throw new Error("API returned an unsupported response format.");
  }

  const choices = response.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0];
    if (isRecord(firstChoice)) {
      const message = firstChoice.message;
      if (isRecord(message) && typeof message.content === "string") {
        return message.content;
      }
      if (typeof firstChoice.text === "string") {
        return firstChoice.text;
      }
      if (typeof firstChoice.content === "string") {
        return firstChoice.content;
      }
    }
  }

  for (const key of ["message", "content", "result", "text", "commitMessage"]) {
    const value = response[key];
    if (typeof value === "string") {
      return value;
    }
  }

  throw new Error("API response did not contain a commit message.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function applyCommitMessage(repo: GitRepository | undefined, message: string): Promise<void> {
  if (repo?.inputBox) {
    repo.inputBox.value = message;
    vscode.window.showInformationMessage("Commit message inserted into Source Control.");
    return;
  }

  await vscode.env.clipboard.writeText(message);
  vscode.window.showInformationMessage("Commit message copied to clipboard.");
}

function execFile(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

export function deactivate(): void {}
