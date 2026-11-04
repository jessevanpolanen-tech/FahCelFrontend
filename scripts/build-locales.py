#!/usr/bin/env python3
"""Generate crawlable Dutch/German pages from the five public English sources.

No runtime translator or external service. Run with Python 3 (stdlib only).
TSV columns are exact normalized source copy, Dutch, German. Generated files
are committed so Vercel remains build-step-free. Use --check to detect drift.
"""
import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PAGES = ['index', 'hash-chain', 'cold-chain-excursion-playbook', 'playbook-download', 'book-a-demo']
ORIGIN = 'https://www.fahcel.eu'
LANGUAGES = {'en': 'English', 'nl': 'Nederlands', 'de': 'Deutsch'}
LOCALES = {'en': 'en-GB', 'nl': 'nl-NL', 'de': 'de-DE'}
BLOCK = re.compile(r'<!-- languages:(head|nav) -->.*?<!-- /languages:\1 -->\n?', re.S)
# Script/style bodies and comments are opaque; never translate code as HTML.
TOKEN = re.compile(r'<!--.*?-->|<script\b[^>]*>.*?</script\s*>|<style\b[^>]*>.*?</style\s*>|<(?:[^>\"\']|\"[^\"]*\"|\'[^\']*\')+>|[^<]+', re.S | re.I)
ATTR = re.compile(r'([\w:-]+)\s*=\s*([\"\'])(.*?)\2', re.S)


def norm(text):
    return re.sub(r'\s+', ' ', html.unescape(text)).strip()


def route(page, lang):
    return ('' if lang == 'en' else '/' + lang) + ('/' if page == 'index' and lang == 'en' else '' if page == 'index' else '/' + page)


def load_catalog():
    result = {}
    for path in sorted((ROOT / 'locales').glob('*.tsv')):
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            fields = line.split('\t')
            if len(fields) != 3:
                raise ValueError(f'{path}: expected source, Dutch, German: {line}')
            key, nl, de = fields
            if key in result and result[key] != [nl, de]:
                raise ValueError('Conflicting translation: ' + key)
            result[key] = [nl, de]
    return result


def translated(text, catalog, lang):
    key = norm(text)
    if key not in catalog:
        return text
    value = html.escape(catalog[key][0 if lang == 'nl' else 1], quote=False)
    return re.match(r'^\s*', text)[0] + value + re.search(r'\s*$', text)[0]


def local_link(value, lang):
    parsed = urlsplit(html.unescape(value))
    if parsed.scheme or parsed.netloc or not parsed.path:
        return value
    path = parsed.path.lstrip('/')
    page = {'': 'index', 'index.html': 'index', 'demo': 'book-a-demo', 'playbook': 'cold-chain-excursion-playbook'}.get(path, path.removesuffix('.html'))
    if page in PAGES:
        return route(page, lang) + ('?' + parsed.query if parsed.query else '') + ('#' + parsed.fragment if parsed.fragment else '')
    # Resources and internal collateral stay at the root, not under /nl or /de.
    return '/' + path + ('?' + parsed.query if parsed.query else '') + ('#' + parsed.fragment if parsed.fragment else '')


def switcher(page, lang):
    label = {'en': 'Language', 'nl': 'Taal', 'de': 'Sprache'}[lang]
    links = []
    for code, name in LANGUAGES.items():
        current = ' aria-current="page"' if lang == code else ''
        links.append(f'<a href="{route(page, code)}" lang="{code}" hreflang="{code}" aria-label="{name}"{current}>{code.upper()}</a>')
    return f'<div class="language-switcher" role="navigation" aria-label="{label}">' + ''.join(links) + '</div>'


def add_language_ui(source, page, lang):
    alternates = '\n'.join(f'<link rel="alternate" hreflang="{code}" href="{ORIGIN}{route(page, code)}" />' for code in LANGUAGES)
    head = '<!-- languages:head -->\n' + alternates + f'\n<link rel="alternate" hreflang="x-default" href="{ORIGIN}{route(page, "en")}" />\n<link rel="stylesheet" href="/assets/languages.css" />\n<script src="/assets/languages.js" defer></script>\n<link rel="stylesheet" href="/assets/analytics.css" />\n<script src="/assets/analytics-config.js" defer></script>\n<script src="/assets/analytics.js" defer></script>\n<!-- /languages:head -->\n'
    source = source.replace('</head>', head + '</head>', 1)
    nav = '<!-- languages:nav -->' + switcher(page, lang) + '<!-- /languages:nav -->'
    if page in ['index', 'hash-chain']:
        source = source.replace('</nav>', nav + '</nav>', 1)
    elif page in ['book-a-demo', 'playbook-download']:
        source = re.sub(r'(<div class="logo">.*?</div>)', lambda m: m[0] + '\n' + nav, source, count=1)
    else:
        source = source.replace('<doc-page', '<div class="document-languages">' + nav + '</div>\n<doc-page', 1)
    return source


class Content(HTMLParser):
    """Collect translated visible copy for language-matched structured data."""
    def __init__(self):
        super().__init__()
        self.title = ''
        self.description = ''
        self.active = None
        self.parts = []
        self.questions = []
        self.answers = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and a.get('name') == 'description':
            self.description = a.get('content', '')
        kind = 'title' if tag == 'title' else 'questions' if tag == 'summary' or a.get('class') == 'q' else 'answers' if a.get('class') in ['ans', 'a'] or (tag == 'p' and self.questions and len(self.answers) < len(self.questions)) else None
        if self.active:
            if tag not in ['br', 'img', 'input', 'meta', 'link', 'path']:
                self.depth += 1
        elif kind:
            self.active, self.parts, self.depth = kind, [], 1

    def handle_endtag(self, tag):
        if not self.active or tag in ['br', 'img', 'input', 'meta', 'link', 'path']:
            return
        self.depth -= 1
        if self.depth == 0:
            text = norm(''.join(self.parts))
            if self.active == 'title':
                self.title = text
            else:
                getattr(self, self.active).append(text)
            self.active = None

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def localized(source, page, lang, catalog, script_catalog):
    # Translate complete headings where word order differs across languages.
    source = source.replace('The Cold-Chain <em>Excursion</em> Playbook',
        'Het draaiboek voor <em>koelketenafwijkingen</em>' if lang == 'nl' else 'Der Leitfaden für <em>Kühlkettenabweichungen</em>')
    source = source.replace('Book a <em>demo</em> call', 'Boek een <em>demogesprek</em>' if lang == 'nl' else 'Buche einen <em>Demotermin</em>')
    if page == 'cold-chain-excursion-playbook':
        # Translations expand beyond the fixed English print boxes. Use the
        # component's existing flowing mode so no translated content is clipped.
        source = source.replace('<doc-page size="letter">', '<doc-page size="letter" margin="0" class="translated-playbook">')
        source = source.replace('class="page', 'class="locale-page').replace('.page{', '.locale-page{')
    # Preserve option values sent to the existing backend, independent of labels.
    source = re.sub(r'<option>([^<]+)</option>', lambda m: '<option value="' + html.escape(html.unescape(m[1]), quote=True) + '">' + m[1] + '</option>', source)
    script_pattern = re.compile('|'.join(re.escape(key) for key in sorted(script_catalog, key=len, reverse=True)))
    index = 0 if lang == 'nl' else 1
    output = []
    for match in TOKEN.finditer(source):
        token = match[0]
        lower = token.lower()
        if lower.startswith('<!--') or lower.startswith('<style'):
            output.append(token)
        elif lower.startswith('<script'):
            if 'application/ld+json' in token.split('>', 1)[0]:
                continue  # Rebuilt below from translated visible copy.
            token = script_pattern.sub(lambda m: script_catalog[m[0]][index], token)
            token = re.sub(r'\bsrc=([\"\'])([^\"\']+)\1', lambda m: 'src=' + m[1] + local_link(m[2], lang) + m[1], token, count=1)
            output.append(token)
        elif token.startswith('<'):
            def attr(m):
                key, quote, value = m.groups()
                if key in ['href', 'src']:
                    if 'rel="canonical"' in token:
                        value = ORIGIN + route(page, lang)
                    else:
                        value = local_link(value, lang)
                elif key == 'lang':
                    value = lang
                elif key in ['alt', 'title', 'placeholder', 'aria-label'] or (key == 'content' and any(s in token for s in ['description', 'og:title', 'twitter:title', 'og:image:alt'])):
                    value = html.escape(html.unescape(translated(value, catalog, lang)), quote=True)
                elif key == 'content' and 'og:locale' in token:
                    value = LOCALES[lang].replace('-', '_')
                elif key == 'content' and 'og:url' in token:
                    value = ORIGIN + route(page, lang)
                return key + '=' + quote + value + quote
            output.append(ATTR.sub(attr, token))
        else:
            output.append(translated(token, catalog, lang))
    source = ''.join(output)
    content = Content()
    content.feed(source)
    graph = [{
        '@type': 'WebPage', '@id': ORIGIN + route(page, lang) + '#page',
        'url': ORIGIN + route(page, lang), 'name': content.title,
        'description': content.description, 'inLanguage': LOCALES[lang],
        'isPartOf': {'@id': ORIGIN + '/#website'},
        'publisher': {'@type': 'Organization', 'name': 'FahCel', 'url': ORIGIN + '/'}
    }]
    if content.questions:
        assert len(content.questions) == len(content.answers), page
        graph.append({'@type': 'FAQPage', 'inLanguage': LOCALES[lang], 'mainEntity': [
            {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}}
            for q, a in zip(content.questions, content.answers)
        ]})
    structured = json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False, indent=2).replace('</', '<\\/')
    source = source.replace('</head>', '<script type="application/ld+json">\n' + structured + '\n</script>\n</head>', 1)
    return add_language_ui(source, page, lang)


def build(check=False):
    catalog = load_catalog()
    script_catalog = json.loads((ROOT / 'locales/scripts.json').read_text())
    outputs = {}
    for page in PAGES:
        source = BLOCK.sub('', (ROOT / (page + '.html')).read_text())
        # Remove only the generated document wrapper before reinsertion.
        source = source.replace('<div class="document-languages"></div>\n', '')
        outputs[ROOT / (page + '.html')] = add_language_ui(source, page, 'en')
        for lang in ['nl', 'de']:
            outputs[ROOT / lang / (page + '.html')] = localized(source, page, lang, catalog, script_catalog)
    changed = []
    for path, text in outputs.items():
        if not path.exists() or path.read_text() != text:
            changed.append(str(path.relative_to(ROOT)))
            if not check:
                path.parent.mkdir(exist_ok=True)
                path.write_text(text)
    if check and changed:
        raise SystemExit('Stale locale output: ' + ', '.join(changed))
    print(('Checked' if check else 'Generated') + ' 15 public language pages.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    build(parser.parse_args().check)
