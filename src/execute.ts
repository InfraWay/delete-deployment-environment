import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/core';

interface ListDeploymentIDs {
  owner: string;
  repo: string;
  environment: string;
}

interface Deployment {
  owner: string;
  repo: string;
  deploymentId: number;
}

interface Context {
  owner: string;
  repo: string;
}

async function listDeploymentIds(
  client: Octokit,
  { owner, repo, environment }: ListDeploymentIDs,
): Promise<number[]> {
  const { data } = await client.request(
    'GET /repos/{owner}/{repo}/deployments',
    {
      owner,
      repo,
      environment,
    },
  );
  const deploymentIds: number[] = data.map((deployment) => deployment.id);
  return deploymentIds;
}

async function setDeploymentInactive(
  client: Octokit,
  { owner, repo, deploymentId }: Deployment,
): Promise<void> {
  await client.request(
    'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses',
    {
      owner,
      repo,
      deployment_id: deploymentId,
      state: 'inactive',
    },
  );
}

async function deleteDeploymentById(
  client: Octokit,
  { owner, repo, deploymentId }: Deployment,
): Promise<void> {
  await client.request(
    'DELETE /repos/{owner}/{repo}/deployments/{deployment_id}',
    {
      owner,
      repo,
      deployment_id: deploymentId,
    },
  );
}

async function deleteTheEnvironment(
  client: Octokit,
  environment: string,
  { owner, repo }: Context,
): Promise<void> {
  let existingEnv = false;
  try {
    const getEnvResult = await client.request(
      'GET /repos/{owner}/{repo}/environments/{environment_name}',
      {
        owner,
        repo,
        environment_name: environment,
      },
    );
    existingEnv = typeof getEnvResult === 'object';
  } catch (err) {
    if (err.status !== 404) {
      core.error('Error deleting environment');
      throw err;
    }
  }

  if (existingEnv) {
    core.info(`deleting environment ${environment}`);
    await client.request(
      'DELETE /repos/{owner}/{repo}/environments/{environment_name}',
      {
        owner,
        repo,
        environment_name: environment,
      },
    );
    core.info(`environment ${environment} deleted`);
  }
}

export async function main(): Promise<void> {
  let deleteDeployment = true;
  let deleteEnvironment = true;
  const token: string = core.getInput('token', { required: true });
  const environment: string = core.getInput('environment', { required: true });
  const onlyRemoveDeployments: string = core.getInput('onlyRemoveDeployments', {
    required: false,
  });
  const onlyDeactivateDeployments: string = core.getInput(
    'onlyDeactivateDeployments',
    {
      required: false,
    },
  );

  const owner: string = core.getInput('owner', { required: false });
  const repo: string = core.getInput('repo', { required: false });
  const { repo: repoDefault, owner: ownerDefault } = github.context.repo;
  const context = {
    owner: owner || ownerDefault,
    repo: repo || repoDefault,
  };

  const client: Octokit = github.getOctokit(token, { previews: ['ant-man'] });

  if (onlyDeactivateDeployments === 'true') {
    deleteDeployment = false;
    deleteEnvironment = false;
  } else if (onlyRemoveDeployments === 'true') {
    deleteEnvironment = false;
  }
  try {
    const deploymentIds = await listDeploymentIds(client, {
      ...context,
      environment,
    });
    core.info(`Found ${deploymentIds.length} deployments`);
    core.info(`deactivating deployments in environment ${environment}`);
    await Promise.all(
      deploymentIds.map((deploymentId) =>
        setDeploymentInactive(client, { ...context, deploymentId }),
      ),
    );

    if (deleteDeployment) {
      core.info(`deleting deployments in environment ${environment}`);
      await Promise.all(
        deploymentIds.map((deploymentId) =>
          deleteDeploymentById(client, { ...context, deploymentId }),
        ),
      );
    }

    if (deleteEnvironment) {
      await deleteTheEnvironment(client, environment, context);
    }
    core.info('done');
  } catch (error) {
    core.setFailed(error.message);
  }
}
