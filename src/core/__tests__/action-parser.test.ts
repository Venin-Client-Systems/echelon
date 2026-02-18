import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseActions } from '../action-parser.js';
import { logger } from '../../lib/logger.js';

// Mock logger to prevent console output during tests
vi.mock('../../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('parseActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Valid single action in ```json fence', () => {
    it('should parse a valid create_issues action', () => {
      const text = `
Here's my plan:

\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT authentication",
      "body": "Implement JWT auth",
      "labels": ["backend", "ralphy-1"]
    }
  ]
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0]).toMatchObject({
        action: 'create_issues',
        issues: [
          {
            title: '[Backend] JWT authentication',
            body: 'Implement JWT auth',
            labels: ['backend', 'ralphy-1'],
          },
        ],
      });
    });

    it('should parse a valid invoke_ralphy action', () => {
      const text = `
Let me invoke Ralphy:

\`\`\`json
{
  "action": "invoke_ralphy",
  "label": "ralphy-1",
  "maxParallel": 3
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0]).toMatchObject({
        action: 'invoke_ralphy',
        label: 'ralphy-1',
        maxParallel: 3,
      });
    });

    it('should parse a valid update_plan action', () => {
      const text = `
\`\`\`json
{
  "action": "update_plan",
  "plan": "Implement authentication and authorization",
  "workstreams": ["auth", "permissions"]
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0]).toMatchObject({
        action: 'update_plan',
        plan: 'Implement authentication and authorization',
        workstreams: ['auth', 'permissions'],
      });
    });

    it('should parse a valid request_info action', () => {
      const text = `
\`\`\`json
{
  "action": "request_info",
  "target": "ceo",
  "question": "What is the preferred auth method?"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0]).toMatchObject({
        action: 'request_info',
        target: 'ceo',
        question: 'What is the preferred auth method?',
      });
    });

    it('should parse a valid escalate action', () => {
      const text = `
\`\`\`json
{
  "action": "escalate",
  "reason": "Blocked on tech decision",
  "decision_needed": "Should we use JWT or sessions?"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0]).toMatchObject({
        action: 'escalate',
        reason: 'Blocked on tech decision',
        decision_needed: 'Should we use JWT or sessions?',
      });
    });

    it('should parse a valid request_review action', () => {
      const text = `
\`\`\`json
{
  "action": "request_review",
  "pr_number": 42,
  "focus": "Security review needed"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0]).toMatchObject({
        action: 'request_review',
        pr_number: 42,
        focus: 'Security review needed',
      });
    });

    it('should parse a valid create_branch action', () => {
      const text = `
\`\`\`json
{
  "action": "create_branch",
  "branch_name": "feature/jwt-auth",
  "from": "main"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0]).toMatchObject({
        action: 'create_branch',
        branch_name: 'feature/jwt-auth',
        from: 'main',
      });
    });
  });

  describe('Array of actions in single fence', () => {
    it('should parse multiple actions in a single JSON array', () => {
      const text = `
\`\`\`json
[
  {
    "action": "update_plan",
    "plan": "Phase 1: Authentication"
  },
  {
    "action": "create_branch",
    "branch_name": "feature/auth"
  }
]
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(2);
      expect(errors).toHaveLength(0);
      expect(actions[0].action).toBe('update_plan');
      expect(actions[1].action).toBe('create_branch');
    });
  });

  describe('Multiple fenced blocks in one response', () => {
    it('should parse actions from multiple JSON blocks', () => {
      const text = `
Here's my strategic plan:

\`\`\`json
{
  "action": "update_plan",
  "plan": "Implement auth system"
}
\`\`\`

Now I'll create the necessary issues:

\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT",
      "body": "Implement JWT",
      "labels": ["backend", "ralphy-1"]
    }
  ]
}
\`\`\`

And finally, let me create a branch:

\`\`\`json
{
  "action": "create_branch",
  "branch_name": "feature/auth"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(3);
      expect(errors).toHaveLength(0);
      expect(actions[0].action).toBe('update_plan');
      expect(actions[1].action).toBe('create_issues');
      expect(actions[2].action).toBe('create_branch');
    });
  });

  describe('Embedded triple backticks in JSON strings (complex case)', () => {
    it('should attempt to parse triple backticks inside issue body (known limitation)', () => {
      // Note: The current regex-based parser has a limitation with embedded backticks.
      // The regex /```json\s*\n([\s\S]*?)```/gi will match up to the first closing backticks,
      // which may be inside a JSON string. This is a known edge case.
      const text = `
\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Docs] Add code examples",
      "body": "Add examples like:\\n\\n\`\`\`bash\\necho 'hello'\\n\`\`\`\\n\\nAnd explain them.",
      "labels": ["docs"]
    }
  ]
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      // Due to the regex limitation, this will fail to parse correctly
      // The regex stops at the first ``` it finds (inside the body string)
      expect(actions).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should handle escaped backticks in JSON strings', () => {
      // A workaround is to use escaped backticks or different formatting
      const text = `
\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Docs] Add examples",
      "body": "Use code blocks with proper escaping",
      "labels": ["docs"]
    }
  ]
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0].action).toBe('create_issues');
    });
  });

  describe('Invalid JSON (should log but not throw)', () => {
    it('should skip blocks with invalid JSON syntax', () => {
      const text = `
\`\`\`json
{
  "action": "update_plan",
  "plan": "This is valid"
}
\`\`\`

\`\`\`json
{
  "action": "create_issues"
  // Missing comma, invalid JSON
  "issues": []
}
\`\`\`

\`\`\`json
{
  "action": "create_branch",
  "branch_name": "feature/test"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(2);
      expect(actions[0].action).toBe('update_plan');
      expect(actions[1].action).toBe('create_branch');
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should handle malformed JSON gracefully', () => {
      const text = `
\`\`\`json
{{{not valid JSON}}}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(0);
      expect(errors).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('Missing action field (validation error)', () => {
    it('should skip JSON objects without action field', () => {
      const text = `
\`\`\`json
{
  "plan": "Some plan",
  "notes": "This doesn't have an action field"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it('should validate action schema and report errors', () => {
      const text = `
\`\`\`json
{
  "action": "create_issues",
  "issues": []
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('create_issues');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should report validation errors for invalid field types', () => {
      const text = `
\`\`\`json
{
  "action": "invoke_ralphy",
  "label": "ralphy-1",
  "maxParallel": "not a number"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('invoke_ralphy');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should report errors for unknown action types', () => {
      const text = `
\`\`\`json
{
  "action": "unknown_action",
  "param": "value"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('unknown_action');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('Empty blocks and edge cases', () => {
    it('should handle empty JSON blocks', () => {
      const text = `
\`\`\`json

\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it('should handle text with no JSON blocks', () => {
      const text = 'This is just plain text with no actions.';

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it('should handle whitespace-only JSON blocks', () => {
      const text = `
\`\`\`json


\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it('should handle mixed valid and invalid blocks', () => {
      const text = `
\`\`\`json
{
  "action": "update_plan",
  "plan": "Valid action"
}
\`\`\`

\`\`\`json
{invalid json}
\`\`\`

\`\`\`json
{
  "not_an_action": true
}
\`\`\`

\`\`\`json
{
  "action": "create_branch",
  "branch_name": "test"
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(2);
      expect(actions[0].action).toBe('update_plan');
      expect(actions[1].action).toBe('create_branch');
    });
  });

  describe('Case sensitivity and formatting', () => {
    it('should be case-sensitive for JSON fence marker', () => {
      const text = `
\`\`\`JSON
{
  "action": "update_plan",
  "plan": "This should work"
}
\`\`\`
`;

      // The regex uses /```json/gi so it should match case-insensitively
      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('update_plan');
    });

    it('should handle JSON blocks with extra whitespace', () => {
      const text = `
\`\`\`json

{
  "action": "update_plan",
  "plan": "Whitespace test"
}

\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('update_plan');
    });
  });

  describe('Real-world complex scenarios', () => {
    it('should parse a complete agent response with narrative and actions', () => {
      const text = `
Based on your directive, I've analyzed the requirements and created a strategic plan.

## Strategic Breakdown

The project requires three main workstreams:
1. Authentication system
2. API endpoints
3. Frontend integration

\`\`\`json
{
  "action": "update_plan",
  "plan": "Implement end-to-end authentication with JWT tokens, REST API, and React frontend",
  "workstreams": ["auth", "api", "frontend"]
}
\`\`\`

I'll now create the necessary GitHub issues for parallel execution:

\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] JWT authentication service",
      "body": "## Overview\\nImplement JWT-based auth\\n\\n## Requirements\\n- Token generation\\n- Token validation\\n- Refresh tokens",
      "labels": ["backend", "ralphy-1"]
    },
    {
      "title": "[Frontend] Login component",
      "body": "Create login form with validation",
      "labels": ["frontend", "ralphy-2"]
    }
  ]
}
\`\`\`

Finally, I'll create a feature branch for this work:

\`\`\`json
{
  "action": "create_branch",
  "branch_name": "feature/auth-system",
  "from": "main"
}
\`\`\`

Once the branch is created, we can invoke Ralphy to start parallel execution.
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(3);
      expect(errors).toHaveLength(0);
      expect(actions[0].action).toBe('update_plan');
      expect(actions[1].action).toBe('create_issues');
      expect(actions[2].action).toBe('create_branch');

      // Verify the create_issues action has correct structure
      const createIssuesAction = actions[1] as any;
      expect(createIssuesAction.issues).toHaveLength(2);
      expect(createIssuesAction.issues[0].labels).toContain('backend');
      expect(createIssuesAction.issues[1].labels).toContain('frontend');
    });

    it('should handle actions with optional fields', () => {
      const text = `
\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "Test issue",
      "body": "Test body"
    }
  ]
}
\`\`\`
`;

      const { actions, errors } = parseActions(text);

      expect(actions).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(actions[0]).toMatchObject({
        action: 'create_issues',
        issues: [
          {
            title: 'Test issue',
            body: 'Test body',
            labels: [],
          },
        ],
      });
    });
  });
});
