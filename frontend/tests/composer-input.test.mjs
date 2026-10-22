import assert from 'node:assert/strict';
import test from 'node:test';
import { fileReference, referencePath, slashSuggestions } from '../src/session/composer-input.ts';

test('slash menu contains Pim actions and native commands, with no interception of ordinary text', () => {
  const commands = [{ name: 'skill:review', description: 'Review code', source: 'skill' }];
  assert.deepEqual(
    slashSuggestions('/', commands).map((item) => item.name),
    ['compact', 'new', 'skill:review'],
  );
  assert.equal(slashSuggestions('/rev', commands)[0].name, 'skill:review');
  assert.deepEqual(slashSuggestions('/compact instructions', commands), []);
  assert.deepEqual(slashSuggestions('Discuss /compact', commands), []);
});

test('file completion only replaces the reference at the caret and preserves trailing text', () => {
  const text = 'Review @src/com and explain';
  assert.deepEqual(fileReference(text, 15), { start: 7, end: 15, query: 'src/com' });
  assert.equal(fileReference('email@example.org', 17), null);
  assert.deepEqual(fileReference('@"my folder/rea', 15), {
    start: 0,
    end: 15,
    query: 'my folder/rea',
  });
  assert.equal(referencePath('src/hello.ts'), '@src/hello.ts');
  assert.equal(referencePath('a file.txt'), '@"a file.txt"');
});
