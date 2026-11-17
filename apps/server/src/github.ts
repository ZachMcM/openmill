import { exec } from "./exec.ts";

export interface GitHub {
  isOpenDraft(repo: string, url: string): Promise<boolean>;
  findOpenDraft(repo: string, branch: string): Promise<string | undefined>;
}

export const ghCli: GitHub = {
  async isOpenDraft(repo, url) {
    const stdout = await exec("gh", ["pr", "view", url, "--json", "isDraft,state"], repo);
    const pr = JSON.parse(stdout) as { isDraft: boolean; state: string };

    return pr.isDraft && pr.state === "OPEN";
  },

  async findOpenDraft(repo, branch) {
    const stdout = await exec(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "url,isDraft"],
      repo,
    );
    const prs = JSON.parse(stdout) as Array<{ url: string; isDraft: boolean }>;

    return prs.find((pr) => pr.isDraft)?.url;
  },
};
