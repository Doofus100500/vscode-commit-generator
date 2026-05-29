# Commit Generator

Local VS Code extension for generating Russian Git commit messages through a configurable API.

The extension sends the selected Git diff to an OpenAI-compatible chat completions endpoint. The API URL and key are configured in VS Code settings.

## Usage

```bash
npm install
npm run compile
```

1. Open this folder in VS Code: `commit-generator`.
2. Press `F5` to start an Extension Development Host.
3. In the Extension Development Host, open a Git repository.
4. Configure `commitGenerator.apiUrl`, `commitGenerator.apiKey`, and optionally `commitGenerator.model`.
5. Stage your changes.
6. Run `Commit Generator: Generate Commit Message` from the Command Palette or Source Control title bar.

The generated message is inserted into the Git Source Control commit input.

Messages are generated in Russian without Conventional Commits or another fixed commit-message template.

## API Contract

The default request body is compatible with chat completions APIs:

```json
{
  "model": "optional-model",
  "messages": [
    {
      "role": "system",
      "content": "..."
    },
    {
      "role": "user",
      "content": "..."
    }
  ],
  "temperature": 0.2
}
```

The extension reads the commit message from one of these response shapes:

- `choices[0].message.content`
- `choices[0].text`
- `choices[0].content`
- `message`
- `content`
- `result`
- `text`
- `commitMessage`

## Build

Compile the extension:

```bash
npm run compile
```

Build an installable VSIX package:

```bash
npm run package
```

Install the generated package locally:

```bash
code --install-extension commit-generator-0.0.1.vsix
```

## Settings

- `commitGenerator.apiUrl`: full URL of the API endpoint.
- `commitGenerator.apiKey`: API key sent to the API.
- `commitGenerator.apiKeyHeader`: HTTP header used for the API key. Default: `Authorization`.
- `commitGenerator.apiKeyPrefix`: API key value prefix. Default: `Bearer`. Use an empty value to send the raw key.
- `commitGenerator.model`: optional model name sent in the request body.
- `commitGenerator.temperature`: sampling temperature sent in the request body. Default: `0.2`.
- `commitGenerator.extraBody`: optional JSON object merged into the request body.
- `commitGenerator.diffMode`: `staged`, `unstaged`, or `auto`. Default: `staged`.
- `commitGenerator.maxDiffBytes`: maximum diff size sent to the API.
- `commitGenerator.timeoutMs`: maximum API request time.

Store `commitGenerator.apiKey` in user settings unless the workspace settings file is intentionally private.

Example:

```json
{
  "commitGenerator.apiUrl": "https://api.example.com/v1/chat/completions",
  "commitGenerator.apiKey": "YOUR_API_KEY",
  "commitGenerator.model": "model-name"
}
```
