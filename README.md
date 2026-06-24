# Commit Generator

VS Code extension for generating Russian Git commit messages through a configurable chat-completions-compatible API.

## Build from source

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run package
```

The command creates a `commit-generator-*.vsix` file in the project directory.

## Install the VSIX file

Install the generated package from the command line:

```bash
code --install-extension commit-generator-*.vsix
```

Or install it from VS Code:

1. Open the Extensions view.
2. Open the `...` menu.
3. Select `Install from VSIX...`.
4. Choose the generated `commit-generator-*.vsix` file.

After installation, configure the extension in VS Code settings:

- `commitGenerator.apiUrl`
- `commitGenerator.apiKey`
- `commitGenerator.model` if your API requires a model name
- `commitGenerator.promptTemplate` if you want to change the prompt sent to the model
