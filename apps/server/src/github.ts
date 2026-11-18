import { exec } from "./exec.ts";

export interface GitHub {
  findOpenDraft(repo: string, branch: string): Promise<string | undefined>;
  graphql(
    repo: string,
    host: string,
    query: string,
    variables: Record<string, string | number>,
  ): Promise<unknown>;
  graphqlResetAt(repo: string, host: string): Promise<Date>;
}

export const ghCli: GitHub = {
  async findOpenDraft(repo, branch) {
    const stdout = await exec(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "url,isDraft"],
      repo,
    );
    const prs = JSON.parse(stdout) as Array<{ url: string; isDraft: boolean }>;

    return prs.find((pr) => pr.isDraft)?.url;
  },

  async graphql(repo, host, query, variables) {
    const args = ["api", "graphql", "--hostname", host, "-f", `query=${query}`];

    for (const [key, value] of Object.entries(variables)) {
      args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
    }

    try {
      return JSON.parse(await exec("gh", args, repo));
    } catch (error) {
      // The default message repeats the whole query, which buries the reason in the log.
      throw new Error(
        `gh api graphql failed: ${(error as { detail?: string }).detail ?? String(error)}`,
        { cause: error },
      );
    }
  },

  async graphqlResetAt(repo, host) {
    const stdout = await exec(
      "gh",
      ["api", "rate_limit", "--hostname", host, "--jq", ".resources.graphql.reset"],
      repo,
    );

    return new Date(Number(stdout.trim()) * 1000);
  },
};
