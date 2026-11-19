import type { PushGate } from "./types.ts";

export const GATE_CLOSED_REASON =
  "Pushing and posting on the PR are held for human review. Commit your changes, stop, and say the changes are ready for review.";

export const DRAFT_GATE_REASON =
  "openmill keeps PRs in draft and never merges them. Leave the PR as a draft and stop.";

const SEPARATORS = new Set([";", "&", "|", "\n", "(", ")", "`"]);

const WRAPPERS = new Set(["env", "command", "exec", "sudo", "nohup", "time"]);

const GIT_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

const GH_FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);

function splitCommands(script: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  let quote: string | undefined;

  const endWord = () => {
    if (word !== undefined) {
      words.push(word);
      word = undefined;
    }
  };
  const endCommand = () => {
    endWord();

    if (words.length > 0) {
      commands.push(words);
    }

    words = [];
  };

  for (let index = 0; index < script.length; index += 1) {
    const char = script[index] as string;

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === "\\" && quote === '"') {
        index += 1;
        word += script[index] ?? "";
      } else {
        word += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      word ??= "";
    } else if (char === "\\") {
      index += 1;
      word = (word ?? "") + (script[index] ?? "");
    } else if (SEPARATORS.has(char)) {
      endCommand();
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word = (word ?? "") + char;
    }
  }

  endCommand();

  return commands;
}

function program(words: string[]): { name: string; args: string[] } | undefined {
  let index = 0;

  while (
    index < words.length &&
    (/^\w+=/.test(words[index] as string) || WRAPPERS.has(words[index] as string))
  ) {
    index += 1;
  }

  const name = words[index]?.split("/").at(-1);

  return name ? { name, args: words.slice(index + 1) } : undefined;
}

function gitSubcommand(args: string[]): { name: string; args: string[] } | undefined {
  let index = 0;

  while (args[index]?.startsWith("-")) {
    index += GIT_OPTIONS_WITH_VALUE.has(args[index] as string) ? 2 : 1;
  }

  const name = args[index];

  return name ? { name, args: args.slice(index + 1) } : undefined;
}

function ghApiWrites(args: string[]): boolean {
  if (args.find((arg) => !arg.startsWith("-")) === "graphql") {
    return args.some((arg) => /\bmutation\b/.test(arg) || arg === "--input");
  }

  let method: string | undefined;

  for (const [index, arg] of args.entries()) {
    if (arg === "-X" || arg === "--method") {
      method = args[index + 1];
    } else if (arg.startsWith("--method=")) {
      method = arg.slice("--method=".length);
    } else if (arg.startsWith("-X") && arg.length > 2) {
      method = arg.slice(2);
    }
  }

  if (method) {
    return method.toUpperCase() !== "GET";
  }

  return args.some((arg) => GH_FIELD_FLAGS.has(arg.split("=")[0] as string));
}

function withoutRepo(args: string[]): string[] {
  return args.filter(
    (arg, index) => !/^(-R|--repo)(=|$)/.test(arg) && !/^(-R|--repo)$/.test(args[index - 1] ?? ""),
  );
}

function postsToPr(name: string, args: string[]): boolean {
  if (name === "git") {
    return gitSubcommand(args)?.name === "push";
  }

  if (name !== "gh") {
    return false;
  }

  const rest = withoutRepo(args);
  const [group, action] = rest;

  return (
    (group === "pr" && (action === "comment" || action === "review")) ||
    (group === "api" && ghApiWrites(rest.slice(1)))
  );
}

function ownBranch(refspec: string, branch: string): boolean {
  const target = refspec.slice(refspec.indexOf(":") + 1);

  return target === "HEAD" || target.replace(/^refs\/heads\//, "") === branch;
}

function forcePushDenial(args: string[], branch: string): string | undefined {
  const options = args.filter((arg) => arg.startsWith("-"));
  const [, ...refspecs] = args.filter((arg) => !arg.startsWith("-"));
  const lease = options.some((option) => /^--force-with-lease(=|$)/.test(option));
  const otherForce =
    refspecs.some((refspec) => refspec.startsWith("+") || refspec.startsWith(":")) ||
    options.some(
      (option) =>
        option === "--force" ||
        option === "--mirror" ||
        option === "--delete" ||
        /^-[a-zA-Z]*[fd]/.test(option),
    );

  if (!otherForce && (!lease || refspecs.every((refspec) => ownBranch(refspec, branch)))) {
    return undefined;
  }

  return `The only force-push allowed is \`git push --force-with-lease origin ${branch}\`.`;
}

export function draftGateDenial(script: string): string | undefined {
  for (const words of splitCommands(script)) {
    const found = program(words);
    const [group, action] = found?.name === "gh" ? withoutRepo(found.args) : [];

    if (group === "pr" && (action === "ready" || action === "merge")) {
      return DRAFT_GATE_REASON;
    }
  }

  return undefined;
}

export function pushGateDenial(script: string, gate: PushGate): string | undefined {
  for (const words of splitCommands(script)) {
    const found = program(words);

    if (!found) {
      continue;
    }

    if (!gate.open && postsToPr(found.name, found.args)) {
      return GATE_CLOSED_REASON;
    }

    const git = found.name === "git" ? gitSubcommand(found.args) : undefined;
    const denial = git?.name === "push" ? forcePushDenial(git.args, gate.branch) : undefined;

    if (denial) {
      return denial;
    }
  }

  return undefined;
}
