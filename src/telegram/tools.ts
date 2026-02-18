import type Anthropic from '@anthropic-ai/sdk';

/** Tool definitions for the CEO AI via Telegram */
export const ceoTools: Anthropic.Messages.Tool[] = [
  {
    name: 'start_cascade',
    description:
      'Start a new Echelon cascade with a directive. The cascade will flow through the AI org hierarchy (2IC → Eng Lead → Team Lead → Engineers).',
    input_schema: {
      type: 'object' as const,
      properties: {
        directive: {
          type: 'string',
          description:
            'The CEO directive — what should the engineering org build/fix/improve',
        },
      },
      required: ['directive'],
    },
  },
  {
    name: 'cascade_status',
    description:
      'Get the current cascade state — which layers have run, what actions are pending, current cost.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'approve_action',
    description:
      'Approve a pending action. Pass an approval ID, or "all" to approve everything.',
    input_schema: {
      type: 'object' as const,
      properties: {
        approval_id: {
          type: 'string',
          description:
            'The approval ID to approve, or "all" to approve everything',
        },
      },
      required: ['approval_id'],
    },
  },
  {
    name: 'reject_action',
    description: 'Reject a pending action with a reason.',
    input_schema: {
      type: 'object' as const,
      properties: {
        approval_id: {
          type: 'string',
          description: 'The approval ID to reject',
        },
        reason: {
          type: 'string',
          description: 'Why this action is being rejected',
        },
      },
      required: ['approval_id', 'reason'],
    },
  },
  {
    name: 'pause_cascade',
    description: 'Pause the current cascade. Can be resumed later.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'resume_cascade',
    description: 'Resume a paused cascade.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'ask_user',
    description:
      'Ask the vibe coder (human) a question via Telegram. Use when you need clarification or a decision before proceeding.',
    input_schema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the human',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'list_sessions',
    description: 'List past and current Echelon sessions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_cost',
    description: 'Get the current cost breakdown by layer.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];
