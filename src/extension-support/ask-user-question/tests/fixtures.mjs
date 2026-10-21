export function prompt(toolCallId = 'ask-1') {
  return {
    toolCallId,
    questions: [
      {
        question: 'Which database?',
        header: 'Database',
        multiSelect: false,
        options: [
          { label: 'SQLite', description: 'Local storage', hasPreview: true },
          { label: 'Postgres', description: 'Remote storage', hasPreview: false },
        ],
      },
      {
        question: 'Which features?',
        header: 'Features',
        multiSelect: true,
        options: [
          { label: 'Search', description: 'Find records', hasPreview: false },
          { label: 'Export', description: 'Download records', hasPreview: false },
        ],
      },
    ],
  };
}

export function answer(toolCallId = 'ask-1') {
  return {
    toolCallId,
    answers: [
      { questionIndex: 0, optionIndexes: [0] },
      { questionIndex: 1, optionIndexes: [0, 1], text: 'Also import', notes: 'Required' },
    ],
    globalNote: 'Keep it simple',
  };
}
