import type { MarkedToken } from 'marked';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type TextMatch, textMatches } from '../../../../src/client/text-search';
import { colors } from '../../theme/colors';
import { builtInTokens, linkUrl, markdownTokens } from './content';
import { HighlightedText } from './highlighted-text';
import { inlineTokenText, markdownProjection } from './search';

const SearchContext = createContext<{
  offsets: Map<MarkedToken, number>;
  matches: TextMatch[];
  active?: TextMatch;
} | null>(null);

function MarkedText({ token, text }: { token: MarkedToken; text: string }) {
  const search = useContext(SearchContext);
  const offset = search?.offsets.get(token);
  return search && offset !== undefined ? (
    <HighlightedText text={text} matches={search.matches} active={search.active} offset={offset} />
  ) : (
    text
  );
}

export function CodeBlock({
  text,
  language,
  children,
}: {
  text: string;
  language?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.codeBlock}>
      {language ? <Text style={styles.language}>{language}</Text> : null}
      <ScrollView
        horizontal
        nestedScrollEnabled
        scrollsToTop={false}
        contentContainerStyle={styles.codeContent}
      >
        <Text selectable style={styles.code}>
          {children ?? text}
        </Text>
      </ScrollView>
    </View>
  );
}

function Inline({ tokens }: { tokens: MarkedToken[] }) {
  return tokens.map((token, index) => {
    const key = String(index);
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
        return (
          <Text
            key={key}
            style={
              token.type === 'strong'
                ? styles.bold
                : token.type === 'em'
                  ? styles.italic
                  : styles.deleted
            }
          >
            <Inline tokens={builtInTokens(token.tokens)} />
          </Text>
        );
      case 'codespan':
        return (
          <Text key={key} style={styles.inlineCode}>
            <MarkedText token={token} text={token.text} />
          </Text>
        );
      case 'link': {
        const url = linkUrl(token.href);
        return (
          <Text
            key={key}
            accessibilityRole={url ? 'link' : undefined}
            style={styles.link}
            onPress={
              url
                ? () => {
                    void Linking.openURL(url).catch(() => {});
                  }
                : undefined
            }
          >
            <Inline tokens={builtInTokens(token.tokens)} />
          </Text>
        );
      }
      case 'br':
        return <MarkedText key={key} token={token} text={'\n'} />;
      case 'image':
        return (
          <Text key={key} style={styles.muted}>
            <MarkedText token={token} text={inlineTokenText(token)} />
          </Text>
        );
      case 'text':
        return token.tokens ? (
          <Inline key={key} tokens={builtInTokens(token.tokens)} />
        ) : (
          <MarkedText key={key} token={token} text={token.text} />
        );
      default:
        return <MarkedText key={key} token={token} text={inlineTokenText(token)} />;
    }
  });
}

function Blocks({ tokens }: { tokens: MarkedToken[] }) {
  return tokens.map((token, index) => {
    const key = String(index);
    switch (token.type) {
      case 'space':
      case 'def':
        return null;
      case 'code':
        return (
          <CodeBlock key={key} text={token.text} language={token.lang}>
            <MarkedText token={token} text={token.text} />
          </CodeBlock>
        );
      case 'heading':
        return (
          <Text
            key={key}
            selectable
            style={[styles.body, styles.heading, { fontSize: token.depth <= 2 ? 21 : 18 }]}
          >
            <Inline tokens={builtInTokens(token.tokens)} />
          </Text>
        );
      case 'blockquote':
        return (
          <View key={key} style={styles.quote}>
            <Blocks tokens={builtInTokens(token.tokens)} />
          </View>
        );
      case 'list':
        return (
          <View key={key} style={styles.list}>
            {token.items.map((item, itemIndex) => (
              <View key={String(itemIndex)} style={styles.listItem}>
                <Text style={[styles.body, styles.bullet]}>
                  {item.task
                    ? item.checked
                      ? '☑'
                      : '☐'
                    : token.ordered
                      ? `${Number(token.start) + itemIndex}.`
                      : '•'}
                </Text>
                <View style={styles.listBody}>
                  <Blocks tokens={builtInTokens(item.tokens)} />
                </View>
              </View>
            ))}
          </View>
        );
      case 'hr':
        return <View key={key} style={styles.rule} />;
      case 'table':
        return (
          <ScrollView
            key={key}
            horizontal
            nestedScrollEnabled
            scrollsToTop={false}
            style={styles.table}
          >
            <View>
              {[token.header, ...token.rows].map((row, rowIndex) => (
                <View key={String(rowIndex)} style={styles.tableRow}>
                  {row.map((cell, cellIndex) => (
                    <Text
                      key={String(cellIndex)}
                      selectable
                      style={[styles.body, styles.cell, rowIndex === 0 && styles.bold]}
                    >
                      <Inline tokens={builtInTokens(cell.tokens)} />
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      case 'paragraph':
      case 'text':
        return (
          <Text key={key} selectable style={styles.body}>
            {token.tokens ? (
              <Inline tokens={builtInTokens(token.tokens)} />
            ) : (
              <MarkedText token={token} text={token.text} />
            )}
          </Text>
        );
      default:
        return (
          <Text key={key} selectable style={styles.body}>
            <MarkedText token={token} text={token.raw} />
          </Text>
        );
    }
  });
}

export function Markdown({
  text,
  query = '',
  active,
}: {
  text: string;
  query?: string;
  active?: TextMatch;
}) {
  const tokens = useMemo(() => markdownTokens(text), [text]);
  const projection = useMemo(() => (query ? markdownProjection(tokens) : null), [tokens, query]);
  const search = useMemo(
    () =>
      projection
        ? {
            offsets: projection.offsets,
            matches: textMatches(projection.text, query),
            active,
          }
        : null,
    [projection, query, active],
  );
  return (
    <SearchContext.Provider value={search}>
      <View style={styles.blocks}>
        <Blocks tokens={tokens} />
      </View>
    </SearchContext.Provider>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 12 },
  body: { color: colors.text, fontSize: 16, lineHeight: 25, flexShrink: 1 },
  heading: { fontWeight: '700', marginTop: 6, lineHeight: 29 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  deleted: { textDecorationLine: 'line-through' },
  muted: { color: colors.muted },
  link: { color: colors.running, textDecorationLine: 'underline' },
  inlineCode: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    backgroundColor: colors.panel,
  },
  codeBlock: {
    backgroundColor: colors.panel,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  language: { color: colors.muted, fontSize: 11, paddingHorizontal: 12, paddingTop: 10 },
  codeContent: { padding: 12 },
  code: {
    color: colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 21,
  },
  quote: { borderLeftWidth: 2, borderColor: colors.accent, paddingLeft: 14, gap: 10 },
  list: { gap: 8 },
  listItem: { flexDirection: 'row', gap: 8 },
  bullet: { minWidth: 22 },
  listBody: { flex: 1, gap: 8 },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  tableRow: { flexDirection: 'row' },
  cell: {
    width: 180,
    padding: 10,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
});
