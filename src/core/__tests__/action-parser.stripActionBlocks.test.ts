import { describe, it, expect } from 'vitest';
import { stripActionBlocks } from '../action-parser.js';

describe('stripActionBlocks', () => {
  describe('Narrative text preservation', () => {
    it('should preserve narrative text when no action blocks present', () => {
      const text = 'This is just plain text with no action blocks.';
      const result = stripActionBlocks(text);

      expect(result).toBe(text);
    });

    it('should preserve narrative text and remove action blocks', () => {
      const text = `
Here's my analysis of the requirements.

\`\`\`json
{
  "action": "update_plan",
  "plan": "Strategic plan"
}
\`\`\`

The plan looks good and addresses all concerns.
`;

      const result = stripActionBlocks(text);

      expect(result).toContain("Here's my analysis");
      expect(result).toContain('The plan looks good');
      expect(result).not.toContain('```json');
      expect(result).not.toContain('"action"');
      expect(result).not.toContain('update_plan');
    });

    it('should preserve multiple paragraphs of narrative text', () => {
      const text = `
Paragraph one with important context.

Paragraph two with more details.

\`\`\`json
{
  "action": "create_branch",
  "branch_name": "test"
}
\`\`\`

Paragraph three with conclusions.

Paragraph four with next steps.
`;

      const result = stripActionBlocks(text);

      expect(result).toContain('Paragraph one');
      expect(result).toContain('Paragraph two');
      expect(result).toContain('Paragraph three');
      expect(result).toContain('Paragraph four');
      expect(result).not.toContain('create_branch');
    });
  });

  describe('Action blocks removed cleanly', () => {
    it('should remove a single action block completely', () => {
      const text = `
Before action.

\`\`\`json
{
  "action": "update_plan",
  "plan": "This should be removed"
}
\`\`\`

After action.
`;

      const result = stripActionBlocks(text);

      expect(result).not.toContain('```json');
      expect(result).not.toContain('```');
      expect(result).not.toContain('update_plan');
      expect(result).not.toContain('This should be removed');
      expect(result).toContain('Before action');
      expect(result).toContain('After action');
    });

    it('should remove action block at the start of text', () => {
      const text = `\`\`\`json
{
  "action": "create_issues",
  "issues": []
}
\`\`\`

Text after the action.`;

      const result = stripActionBlocks(text);

      expect(result).toBe('Text after the action.');
      expect(result).not.toContain('create_issues');
    });

    it('should remove action block at the end of text', () => {
      const text = `Text before the action.

\`\`\`json
{
  "action": "invoke_ralphy",
  "label": "ralphy-1"
}
\`\`\``;

      const result = stripActionBlocks(text);

      expect(result).toBe('Text before the action.');
      expect(result).not.toContain('invoke_ralphy');
    });

    it('should remove action block when it is the only content', () => {
      const text = `\`\`\`json
{
  "action": "update_plan",
  "plan": "Solo action"
}
\`\`\``;

      const result = stripActionBlocks(text);

      expect(result).toBe('');
    });
  });

  describe('Multiple blocks handled correctly', () => {
    it('should remove multiple action blocks while preserving narrative', () => {
      const text = `
Introduction paragraph.

\`\`\`json
{
  "action": "update_plan",
  "plan": "First action"
}
\`\`\`

Middle paragraph with analysis.

\`\`\`json
{
  "action": "create_issues",
  "issues": []
}
\`\`\`

Conclusion paragraph.

\`\`\`json
{
  "action": "invoke_ralphy",
  "label": "ralphy-1"
}
\`\`\`

Final thoughts.
`;

      const result = stripActionBlocks(text);

      expect(result).toContain('Introduction paragraph');
      expect(result).toContain('Middle paragraph');
      expect(result).toContain('Conclusion paragraph');
      expect(result).toContain('Final thoughts');
      expect(result).not.toContain('update_plan');
      expect(result).not.toContain('create_issues');
      expect(result).not.toContain('invoke_ralphy');
      expect(result).not.toContain('```json');
    });

    it('should remove consecutive action blocks', () => {
      const text = `
Text before.

\`\`\`json
{
  "action": "update_plan",
  "plan": "First"
}
\`\`\`

\`\`\`json
{
  "action": "create_branch",
  "branch_name": "test"
}
\`\`\`

Text after.
`;

      const result = stripActionBlocks(text);

      expect(result).toContain('Text before');
      expect(result).toContain('Text after');
      expect(result).not.toContain('update_plan');
      expect(result).not.toContain('create_branch');
    });
  });

  describe('Whitespace normalization', () => {
    it('should collapse excessive newlines to maximum two', () => {
      const text = `
Paragraph one.




Paragraph two.
`;

      const result = stripActionBlocks(text);

      expect(result).not.toContain('\n\n\n\n');
      expect(result).not.toContain('\n\n\n');
      // Should have at most double newlines
      expect(result.split('\n\n\n').length).toBe(1);
    });

    it('should normalize whitespace when removing action blocks', () => {
      const text = `
Text before.


\`\`\`json
{
  "action": "update_plan",
  "plan": "Plan"
}
\`\`\`


Text after.
`;

      const result = stripActionBlocks(text);

      expect(result).toContain('Text before');
      expect(result).toContain('Text after');
      // Should not have excessive newlines
      expect(result.split('\n\n\n').length).toBe(1);
    });

    it('should trim leading and trailing whitespace', () => {
      const text = `


\`\`\`json
{
  "action": "update_plan",
  "plan": "Plan"
}
\`\`\`


`;

      const result = stripActionBlocks(text);

      expect(result).toBe('');
    });
  });

  describe('Edge cases and special characters', () => {
    it('should handle empty input', () => {
      const result = stripActionBlocks('');
      expect(result).toBe('');
    });

    it('should handle input with only whitespace', () => {
      const result = stripActionBlocks('   \n\n   \n   ');
      expect(result).toBe('');
    });

    it('should preserve markdown formatting', () => {
      const text = `
# Heading

## Subheading

- List item 1
- List item 2

\`\`\`json
{
  "action": "update_plan",
  "plan": "Plan"
}
\`\`\`

**Bold text** and *italic text*.
`;

      const result = stripActionBlocks(text);

      expect(result).toContain('# Heading');
      expect(result).toContain('## Subheading');
      expect(result).toContain('- List item 1');
      expect(result).toContain('**Bold text**');
      expect(result).toContain('*italic text*');
      expect(result).not.toContain('update_plan');
    });

    it('should preserve code blocks that are not JSON actions', () => {
      const text = `
Here's a bash example:

\`\`\`bash
echo "hello world"
\`\`\`

\`\`\`json
{
  "action": "update_plan",
  "plan": "Plan"
}
\`\`\`

And here's a Python example:

\`\`\`python
print("hello")
\`\`\`
`;

      const result = stripActionBlocks(text);

      expect(result).toContain('```bash');
      expect(result).toContain('echo "hello world"');
      expect(result).toContain('```python');
      expect(result).toContain('print("hello")');
      expect(result).not.toContain('update_plan');
    });

    it('should handle action blocks with embedded backticks in strings', () => {
      const text = `
Narrative text.

\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "Test",
      "body": "Example: \`\`\`bash\\necho 'test'\\n\`\`\`",
      "labels": []
    }
  ]
}
\`\`\`

More narrative.
`;

      const result = stripActionBlocks(text);

      expect(result).toContain('Narrative text');
      expect(result).toContain('More narrative');
      expect(result).not.toContain('create_issues');
    });
  });

  describe('Real-world agent response scenarios', () => {
    it('should extract narrative from complex agent response', () => {
      const text = `
Based on your directive, I've analyzed the system and created a comprehensive plan.

## Analysis

The current architecture has three main areas that need attention:
1. Authentication layer
2. API endpoints
3. Frontend components

\`\`\`json
{
  "action": "update_plan",
  "plan": "Modernize auth, refactor API, update UI",
  "workstreams": ["auth", "api", "frontend"]
}
\`\`\`

I'll create GitHub issues for each workstream to enable parallel execution.

\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "[Backend] Modernize authentication",
      "body": "## Overview\\nUpgrade to JWT tokens\\n\\n## Tasks\\n- Implement JWT\\n- Add refresh tokens\\n- Update tests",
      "labels": ["backend", "ralphy-1"]
    },
    {
      "title": "[Frontend] Update login UI",
      "body": "Modernize login component",
      "labels": ["frontend", "ralphy-2"]
    }
  ]
}
\`\`\`

Once these issues are created, we can invoke Ralphy to start parallel execution across domains.

\`\`\`json
{
  "action": "invoke_ralphy",
  "label": "ralphy-1",
  "maxParallel": 3
}
\`\`\`

Let me know if you'd like me to proceed with this approach!
`;

      const result = stripActionBlocks(text);

      // Should preserve all narrative
      expect(result).toContain('Based on your directive');
      expect(result).toContain('## Analysis');
      expect(result).toContain('The current architecture');
      expect(result).toContain('1. Authentication layer');
      expect(result).toContain('2. API endpoints');
      expect(result).toContain('3. Frontend components');
      expect(result).toContain("I'll create GitHub issues");
      expect(result).toContain('Once these issues are created');
      expect(result).toContain("Let me know if you'd like");

      // Should remove all action blocks
      expect(result).not.toContain('update_plan');
      expect(result).not.toContain('create_issues');
      expect(result).not.toContain('invoke_ralphy');
      expect(result).not.toContain('```json');
    });

    it('should handle response with only actions and minimal narrative', () => {
      const text = `
Creating issues:

\`\`\`json
{
  "action": "create_issues",
  "issues": [
    {
      "title": "Test 1",
      "body": "Body 1",
      "labels": ["test"]
    }
  ]
}
\`\`\`

Done.
`;

      const result = stripActionBlocks(text);

      expect(result).toContain('Creating issues:');
      expect(result).toContain('Done.');
      expect(result).not.toContain('create_issues');
    });
  });
});
