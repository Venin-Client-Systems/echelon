import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../lib/logger.js';
import type { ProjectBoardConfig } from '../types.js';

const execFileAsync = promisify(execFile);

interface FieldOption {
    id: string;
    name: string;
}

interface FieldInfo {
    id: string;
    name: string;
    options?: FieldOption[];
}

interface ProjectMetadata {
    projectId: string;
    fields: Map<string, FieldInfo>;
}

/** Cache project metadata keyed by repo:projectNumber to avoid stale data across repos */
const projectCacheMap = new Map<string, ProjectMetadata>();

function cacheKey(repo: string, projectNumber: number): string {
    return `${repo}:${projectNumber}`;
}

/** Run a GraphQL query via gh CLI using proper variable passing */
async function ghGraphQL(query: string, variables: Record<string, string | number> = {}): Promise<any> {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
        if (typeof value === 'number') {
            args.push('-F', `${key}=${value}`);
        } else {
            args.push('-f', `${key}=${value}`);
        }
    }
    const { stdout } = await execFileAsync('gh', args, { encoding: 'utf-8' });
    return JSON.parse(stdout);
}

/** Fetch project V2 metadata (project ID, field IDs, option IDs) */
async function getProjectMetadata(repo: string, projectNumber: number): Promise<ProjectMetadata | null> {
    const key = cacheKey(repo, projectNumber);
    const cached = projectCacheMap.get(key);
    if (cached)
        return cached;

    const owner = repo.split('/')[0];
    const query = `query($owner: String!, $projectNumber: Int!) {
    organization(login: $owner) {
      projectV2(number: $projectNumber) {
        id
        fields(first: 30) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
            ... on ProjectV2Field {
              id
              name
            }
          }
        }
      }
    }
  }`;

    try {
        const data = await ghGraphQL(query, { owner, projectNumber });
        const project = data.data?.organization?.projectV2;
        if (!project) {
            logger.warn(`Project V2 #${projectNumber} not found for ${owner}`);
            return null;
        }

        const fields = new Map<string, FieldInfo>();
        for (const node of project.fields.nodes) {
            if (node.name) {
                fields.set(node.name, {
                    id: node.id,
                    name: node.name,
                    options: node.options,
                });
            }
        }

        const result: ProjectMetadata = { projectId: project.id, fields };
        projectCacheMap.set(key, result);
        return result;
    } catch (err) {
        logger.warn(`Failed to fetch project board metadata: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}

/** Get the item ID for an issue in a project */
async function getProjectItemId(repo: string, projectNumber: number, issueNumber: number): Promise<string | null> {
    const owner = repo.split('/')[0];
    const repoName = repo.split('/')[1];
    const query = `query($owner: String!, $repoName: String!, $issueNumber: Int!) {
    repository(owner: $owner, name: $repoName) {
      issue(number: $issueNumber) {
        projectItems(first: 10) {
          nodes {
            id
            project { number }
          }
        }
      }
    }
  }`;

    try {
        const data = await ghGraphQL(query, { owner, repoName, issueNumber });
        const items = data.data?.repository?.issue?.projectItems?.nodes ?? [];
        const match = items.find((item: any) => item.project?.number === projectNumber);
        return match?.id ?? null;
    } catch {
        return null;
    }
}

/** Update a single-select field on a project item */
async function updateSingleSelectField(projectId: string, itemId: string, fieldId: string, optionId: string): Promise<void> {
    const mutation = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }`;
    await ghGraphQL(mutation, { projectId, itemId, fieldId, optionId });
}

/** Update a text field on a project item */
async function updateTextField(projectId: string, itemId: string, fieldId: string, value: string): Promise<void> {
    const mutation = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $textValue: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { text: $textValue }
    }) {
      projectV2Item { id }
    }
  }`;
    await ghGraphQL(mutation, { projectId, itemId, fieldId, textValue: value });
}

/** Update the status field for an issue on the project board */
export async function updateIssueStatus(repo: string, config: ProjectBoardConfig, issueNumber: number, status: string): Promise<void> {
    const meta = await getProjectMetadata(repo, config.projectNumber);
    if (!meta)
        return;

    const itemId = await getProjectItemId(repo, config.projectNumber, issueNumber);
    if (!itemId) {
        logger.debug(`Issue #${issueNumber} not on project board`);
        return;
    }

    const fieldName = config.statusField || 'Status';
    const field = meta.fields.get(fieldName);
    if (!field?.options) {
        logger.debug(`Status field "${fieldName}" not found or has no options`);
        return;
    }

    const option = field.options.find(o => o.name.toLowerCase() === status.toLowerCase());
    if (!option) {
        logger.debug(`Status option "${status}" not found in field "${fieldName}"`);
        return;
    }

    await updateSingleSelectField(meta.projectId, itemId, field.id, option.id);
    logger.debug(`Updated issue #${issueNumber} status to "${status}"`);
}

/** Update the branch field for an issue on the project board */
export async function updateIssueBranch(repo: string, config: ProjectBoardConfig, issueNumber: number, branchName: string): Promise<void> {
    const meta = await getProjectMetadata(repo, config.projectNumber);
    if (!meta)
        return;

    const itemId = await getProjectItemId(repo, config.projectNumber, issueNumber);
    if (!itemId)
        return;

    const fieldName = config.branchField || 'Branch';
    const field = meta.fields.get(fieldName);
    if (!field)
        return;

    await updateTextField(meta.projectId, itemId, field.id, branchName);
    logger.debug(`Updated issue #${issueNumber} branch to "${branchName}"`);
}

/** Clear the project metadata cache */
export function clearProjectCache(): void {
    projectCacheMap.clear();
}
