// Only a successful run of this workflow for an identical repository tree can
// replace main validation. Missing/expired artifacts fall back to full validation.
module.exports = async ({ github, context, tree }) => {
  const repo = context.repo;
  const name = `validated-worker-${tree}`;
  const { data } = await github.rest.actions.listArtifactsForRepo({
    ...repo, name, per_page: 100,
  });
  const { data: workflow } = await github.rest.actions.getWorkflow({
    ...repo, workflow_id: "deploy.yml",
  });
  for (const artifact of data.artifacts) {
    if (artifact.expired || artifact.name !== name) continue;
    const { data: run } = await github.rest.actions.getWorkflowRun({
      ...repo, run_id: artifact.workflow_run.id,
    });
    if (run.event !== "pull_request" || run.status !== "completed" ||
        run.conclusion !== "success" || run.workflow_id !== workflow.id ||
        run.head_repository?.full_name !== `${repo.owner}/${repo.repo}`) continue;
    const { data: commit } = await github.rest.git.getCommit({
      ...repo, commit_sha: run.head_sha,
    });
    if (commit.tree.sha === tree) return String(run.id);
  }
  return "";
};
