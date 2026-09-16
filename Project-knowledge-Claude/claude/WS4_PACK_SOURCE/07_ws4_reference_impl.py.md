#!/usr/bin/env python3
"""
WS4 reference implementation — dependency closure, canonical manifest, classification.

Revision 5: the regex import scanner is REPLACED by a token-level lexer.
FAIL-CLOSED CONTRACT: any construct the lexer cannot prove it understood makes the file
UNPARSEABLE, which makes the function UNKNOWN. UNKNOWN is never folded into MATCH.

EXECUTION PROVENANCE: FIXTURE-TESTED (08_selftest.sh) + RC-SPECIFIER-REGRESSION (09_rc_regression.sh).
NOT smoke-tested: no provider-backed run has occurred.

Subcommands
  extract   --file F                              -> specifiers, one per line; exit 3 if UNPARSEABLE
  closure   --root R --entry E [--import-map M]   -> normalized paths, sorted; exit 3 on any problem
  manifest  --root R --files-from F               -> "<sha256>  <bytes>  <path>" sorted
  classify  --rc A --prod B                       -> verdict + detail
"""
import argparse, hashlib, json, os, sys

# ---------------------------------------------------------------- lexer ------
class _Partial(Exception):
    """Internal: carries the tokens accumulated before a lexer failure."""
    def __init__(self, toks, err, offset):
        super().__init__(str(err))
        self.toks, self.err, self.offset = toks, err, offset

class Unparseable(Exception):
    def __init__(self, reason, line):
        super().__init__("%s (line %d)" % (reason, line))
        self.reason, self.line = reason, line

PUNCT3 = ('...', '**=', '===', '!==', '<<=', '>>=', '>>>')
PUNCT2 = ('=>','==','!=','<=','>=','&&','||','??','?.','++','--','+=','-=','*=','/=','%=','&=','|=','^=','**','<<','>>')
KEYWORDS_BEFORE_REGEX = {
    'return','typeof','instanceof','in','of','new','delete','void','throw','case','do','else',
    'yield','await','import','export','default','extends'
}
VALUE_END_KEYWORDS = {'this','super','true','false','null','undefined'}

def tokenize(src, partial=False):
    """Return list of (kind, value, line). kind in: name num str tmpl regex punct.
       Raises Unparseable for anything it cannot prove it understood.
       partial=True: instead of raising, return (toks, err, offset) at the first failure."""
    toks, i, n, line = [], 0, len(src), 1
    def bail(reason, ln, off):
        if partial:
            raise _Partial(toks, Unparseable(reason, ln), off)
        raise Unparseable(reason, ln)
    paren_stack = []            # what keyword introduced each '(' — for regex disambiguation
    def prev_significant():
        return toks[-1] if toks else None

    def regex_allowed():
        p = prev_significant()
        if p is None:
            return True
        k, v = p[0], p[1]
        if k in ('num', 'str', 'tmpl', 'regex'):
            return False
        if k == 'name':
            if v in KEYWORDS_BEFORE_REGEX:
                return True
            if v in VALUE_END_KEYWORDS:
                return False
            return False                     # identifier -> division
        if k == 'punct':
            if v == ')':
                # a ')' that closed an if/while/for head allows a regex; otherwise division
                return p[2] == 'ctrl-close'
            if v in (']',):
                return False
            if v == '}':
                return True                  # block end -> regex allowed (conservative, common)
            return True
        return True

    while i < n:
        c = src[i]
        if c == '\n':
            line += 1; i += 1; continue
        if c in ' \t\r\f\v':
            i += 1; continue
        # comments
        if src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            if j < 0:
                bail('unterminated block comment', line, i)
            line += src.count('\n', i, j)
            i = j + 2
            continue
        # strings
        if c in '"\'':
            q, j, buf = c, i + 1, []
            while True:
                if j >= n:
                    bail('unterminated string literal', line, i)
                ch = src[j]
                if ch == '\\':
                    if j + 1 >= n:
                        bail('bad escape at EOF', line, i)
                    buf.append(src[j + 1]); j += 2; continue
                if ch == '\n':
                    bail('newline in single-line string', line, i)
                if ch == q:
                    j += 1; break
                buf.append(ch); j += 1
            toks.append(('str', ''.join(buf), line)); i = j; continue
        # template literal
        if c == '`':
            j, depth, start_line = i + 1, 0, line
            inner = []
            while True:
                if j >= n:
                    bail('unterminated template literal', start_line, i)
                ch = src[j]
                if ch == '\\':
                    j += 2; continue
                if ch == '\n':
                    line += 1; j += 1; continue
                if ch == '$' and j + 1 < n and src[j + 1] == '{':
                    depth += 1; j += 2
                    seg_start = j
                    # scan to the matching close brace, tracking nesting only
                    d = 1
                    while j < n and d:
                        if src[j] == '{': d += 1
                        elif src[j] == '}': d -= 1
                        elif src[j] == '\n': line += 1
                        j += 1
                    if d:
                        bail('unterminated ${} in template', start_line, i)
                    inner.append(src[seg_start:j - 1])
                    continue
                if ch == '`':
                    j += 1; break
                j += 1
            # FAIL CLOSED: an import inside a template interpolation is not analysable here
            for seg in inner:
                if 'import' in seg or 'require' in seg:
                    bail('import/require inside template interpolation', start_line, i)
            toks.append(('tmpl', None, start_line)); i = j; continue
        # regex or division
        if c == '/':
            if regex_allowed():
                j, in_class = i + 1, False
                while True:
                    if j >= n:
                        bail('unterminated regex literal', line, i)
                    ch = src[j]
                    if ch == '\\': j += 2; continue
                    if ch == '\n': bail('newline in regex literal', line, i)
                    if ch == '[': in_class = True
                    elif ch == ']': in_class = False
                    elif ch == '/' and not in_class:
                        j += 1; break
                    j += 1
                while j < n and (src[j].isalpha()):
                    j += 1
                toks.append(('regex', None, line)); i = j; continue
            # fall through as punctuation
        # numbers
        if c.isdigit() or (c == '.' and i + 1 < n and src[i + 1].isdigit()):
            j = i
            while j < n and (src[j].isalnum() or src[j] in '._'):
                j += 1
            toks.append(('num', src[i:j], line)); i = j; continue
        # identifiers / keywords
        if c.isalpha() or c in '_$':
            j = i
            while j < n and (src[j].isalnum() or src[j] in '_$'):
                j += 1
            toks.append(('name', src[i:j], line)); i = j; continue
        # punctuation
        for group in (PUNCT3, PUNCT2):
            hit = next((p for p in group if src.startswith(p, i)), None)
            if hit:
                toks.append(('punct', hit, line)); i += len(hit); break
        else:
            if c == '(':
                p = prev_significant()
                kind = 'ctrl' if (p and p[0] == 'name' and p[1] in ('if', 'while', 'for', 'with', 'switch')) else 'call'
                paren_stack.append(kind)
                toks.append(('punct', '(', line))
            elif c == ')':
                kind = paren_stack.pop() if paren_stack else 'call'
                toks.append(('punct', ')', line, 'ctrl-close' if kind == 'ctrl' else 'call-close'))
            else:
                toks.append(('punct', c, line))
            i += 1
    return toks

# ------------------------------------------------------- statement scan ------
def _scan(toks):
    """Statement scan over an already-tokenized stream."""
    out, i, n = [], 0, len(toks)
    def t(k):  # safe get
        return toks[k] if 0 <= k < n else ('eof', None, -1)

    while i < n:
        kind, val, ln = toks[i][0], toks[i][1], toks[i][2]
        if kind == 'name' and val in ('import', 'export'):
            nxt = t(i + 1)
            # import.meta / import . anything  -> not a module specifier
            if val == 'import' and nxt[0] == 'punct' and nxt[1] == '.':
                i += 1; continue
            # dynamic import( ... )
            if val == 'import' and nxt[0] == 'punct' and nxt[1] == '(':
                arg = t(i + 2)
                close = t(i + 3)
                if arg[0] == 'str' and close[0] == 'punct' and close[1] == ')':
                    out.append(arg[1]); i += 4; continue
                raise Unparseable('dynamic import() with a non-literal specifier', ln)
            # import "side-effect"
            if val == 'import' and nxt[0] == 'str':
                out.append(nxt[1]); i += 2; continue
            # TS: import x = require("...")
            if val == 'import' and nxt[0] == 'name' and t(i + 2)[1] == '=' and t(i + 3)[1] == 'require':
                arg = t(i + 5)
                if t(i + 4)[1] == '(' and arg[0] == 'str' and t(i + 6)[1] == ')':
                    out.append(arg[1]); i += 7; continue
                raise Unparseable('import= with a non-literal require', ln)
            # Everything else: `import ... from "S"` or `export ... from "S"` (re-export),
            # or a plain declaration such as `export const x = 1` / `export type T = ...`.
            #
            # REVISION 6 FIX. The previous version broke out of the scan whenever the token
            # after the keyword was a declaration keyword, `type` included. That is correct for
            # `export type T = ...` but WRONG for `import type { T } from "./x.ts"` and for
            # `export type { T } from "./x.ts"`, both of which are type-only *module* forms that
            # DO carry a specifier. It made every type-only import UNPARSEABLE.
            # The boundary is now decided by whether a module-position `from` is actually found,
            # not by guessing from the following keyword.
            is_import = (val == 'import')
            j, depth, found = i + 1, 0, None
            LIMIT = 4000                     # multiline specifier lists are fine; runaway is not
            while j < n and j - i < LIMIT:
                k2, v2 = toks[j][0], toks[j][1]
                if k2 == 'punct' and v2 in '{[(':
                    depth += 1
                elif k2 == 'punct' and v2 in '}])':
                    depth = max(0, depth - 1)
                elif depth == 0 and k2 == 'punct' and v2 == ';':
                    break
                elif depth == 0 and k2 == 'name' and v2 in ('import', 'export') and j > i + 1:
                    break                    # a new statement began (no semicolon in between)
                elif depth == 0 and k2 == 'name' and v2 == 'from':
                    # `obj.from` is a property access, not the module keyword
                    if toks[j - 1][0] == 'punct' and toks[j - 1][1] == '.':
                        j += 1; continue
                    nx = t(j + 1)
                    if nx[0] == 'str':
                        found = nx[1]; j += 2; break
                    if is_import:
                        raise Unparseable("`from` not followed by a string literal", toks[j][2])
                    # in an export declaration a stray `from` is not a re-export; keep scanning
                j += 1
            if found is not None:
                out.append(found); i = j; continue
            if is_import:
                # an `import` we could not resolve to a specifier is never safe to ignore
                raise Unparseable('import statement without a resolvable specifier', ln)
            i += 1; continue
        i += 1
    seen, uniq = set(), []
    for sp in out:
        if sp not in seen:
            seen.add(sp); uniq.append(sp)
    return sorted(uniq)


# Failures that indicate VALID syntax this lexer does not model (JSX), as opposed to a source
# that is malformed under any grammar. Only these may use the header-complete fallback.
JSX_LEXER_LIMITS = ('newline in regex literal', 'unterminated regex literal')
JSX_EXTENSIONS = ('.tsx', '.jsx')

def extract_specifiers(src, filename=None):
    """-> sorted specifier strings. Raises Unparseable when completeness cannot be proven.

    Two paths:
      (a) the whole file tokenizes -> scan it, done.
      (b) the lexer stops on a construct that is VALID but unmodelled - in practice JSX:
          `<Disclaimer />` makes the `/` undecidable, and every email template in this RC is
          .tsx. The header-complete fallback then applies, but ONLY under all three of:
            1. the failure reason is a JSX lexer limit (a regex-literal ambiguity), AND
            2. the file has a JSX extension (.tsx/.jsx), AND
            3. the remaining raw text mentions neither `import` nor `require` anywhere -
               strings and comments included.
          A malformed source - unterminated string, comment or template, a non-literal
          dynamic import - is malformed under ANY grammar and FAILS CLOSED. It never reaches
          the fallback.
          The statement scanner already raises when an `import` keyword yields no specifier,
          so any import before the stop is either captured or fatal.
    """
    try:
        return _scan(tokenize(src, partial=True))
    except _Partial as part:
        reason = part.err.reason
        jsx_ok = (reason in JSX_LEXER_LIMITS
                  and filename is not None
                  and filename.lower().endswith(JSX_EXTENSIONS))
        if not jsx_ok:
            raise Unparseable('malformed or unmodelled source: %s' % reason, part.err.line)
        specs = _scan(part.toks)                      # may itself raise Unparseable - correct
        rest = src[part.offset:]
        if 'import' in rest or 'require' in rest:
            raise Unparseable(
                'JSX fallback refused: remaining text still mentions import/require (%s)'
                % reason, part.err.line)
        return specs

# ------------------------------------------------------------ resolution -----
def load_import_map(path):
    if not path:
        return {}
    with open(path, 'r', encoding='utf-8') as fh:
        doc = json.load(fh)
    return doc.get('imports', doc) or {}

def apply_import_map(spec, imap):
    if spec in imap:
        return imap[spec]
    best = None
    for k in imap:
        if k.endswith('/') and spec.startswith(k) and (best is None or len(k) > len(best)):
            best = k
    return imap[best] + spec[len(best):] if best is not None else None

def norm(root, p):
    return os.path.relpath(os.path.realpath(p), os.path.realpath(root)).replace(os.sep, '/')

def inside(root, p):
    r, q = os.path.realpath(root), os.path.realpath(p)
    return q == r or q.startswith(r + os.sep)

CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.mjs', '.jsx', '/index.ts', '/index.tsx', '/index.js']
REMOTE_PREFIXES = ('http://', 'https://', 'npm:', 'jsr:', 'node:', 'data:', 'deno:')

def resolve(root, importer_abs, spec, imap):
    if spec.startswith(REMOTE_PREFIXES):
        return None, 'EXTERNAL'
    mapped = apply_import_map(spec, imap)
    if mapped is not None:
        spec = mapped
        if spec.startswith(REMOTE_PREFIXES):
            return None, 'EXTERNAL'
    if spec.startswith('/'):
        base = os.path.join(root, spec.lstrip('/'))
    elif spec.startswith('.'):
        base = os.path.join(os.path.dirname(importer_abs), spec)
    else:
        return None, 'UNRESOLVED'
    for suf in CANDIDATE_SUFFIXES:
        cand = base + suf
        if os.path.isfile(cand):
            cand = os.path.realpath(cand)   # canonicalise: without this an import cycle never closes
            return (cand, 'RESOLVED') if inside(root, cand) else (cand, 'OUTSIDE_ROOT')
    return None, 'UNRESOLVED'

def closure(root, entry, imap):
    root_abs = os.path.realpath(root)
    entry_abs = os.path.realpath(entry if os.path.isabs(entry) else os.path.join(root, entry))
    if not os.path.isfile(entry_abs):
        return [], [('ENTRY_MISSING', entry, '')]
    seen, queue, problems = set(), [entry_abs], []
    while queue:
        cur = queue.pop(0)
        if cur in seen:
            continue
        seen.add(cur)
        try:
            src = open(cur, 'r', encoding='utf-8', errors='strict').read()
        except (OSError, UnicodeDecodeError) as e:
            problems.append(('READ_ERROR', norm(root_abs, cur), str(e)[:60])); continue
        try:
            specs = extract_specifiers(src, cur)
        except Unparseable as e:
            problems.append(('UNPARSEABLE', norm(root_abs, cur), str(e))); continue
        for spec in specs:
            tgt, status = resolve(root_abs, cur, spec, imap)
            if status == 'RESOLVED':
                if tgt not in seen:
                    queue.append(tgt)
            elif status in ('UNRESOLVED', 'OUTSIDE_ROOT'):
                problems.append((status, norm(root_abs, cur), spec))
    return sorted(norm(root_abs, p) for p in seen), problems

# -------------------------------------------------------------- manifest -----
def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def manifest(root, rels):
    return ['%s  %d  %s' % (sha256_file(os.path.join(root, r)), os.path.getsize(os.path.join(root, r)), r)
            for r in sorted(rels)]

HEADER_SUFFIX = '_shared/secureHeaders.ts'

def parse_manifest(path):
    d = {}
    for line in open(path, encoding='utf-8'):
        if line.strip():
            sha, size, rel = line.rstrip('\n').split('  ', 2)
            d[rel] = (sha, size)
    return d

def classify(rc, prod):
    if set(rc) != set(prod):
        return 'DRIFT', {'reason': 'path sets differ',
                         'only_in_rc': sorted(set(rc) - set(prod)),
                         'only_in_prod': sorted(set(prod) - set(rc))}
    diff = sorted(p for p in rc if rc[p][0] != prod[p][0])
    if not diff:
        return 'MATCH', {'differing': []}
    if all(p.endswith(HEADER_SUFFIX) for p in diff):
        return 'HEADER-ONLY', {'differing': diff}
    return 'DRIFT', {'reason': 'content differs outside secureHeaders', 'differing': diff}

# -------------------------------------------------------------------- cli ----
def main():
    # A consumer such as `| head -1` closes the pipe; without this the tool dies with a
    # BrokenPipeError traceback in ordinary pipeline use. Found by the revision-5 test run.
    try:
        import signal
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    except (ImportError, AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    e = sub.add_parser('extract');  e.add_argument('--file', required=True)
    c = sub.add_parser('closure');  c.add_argument('--root', required=True); c.add_argument('--entry', required=True); c.add_argument('--import-map')
    m = sub.add_parser('manifest'); m.add_argument('--root', required=True); m.add_argument('--files-from', required=True)
    k = sub.add_parser('classify'); k.add_argument('--rc', required=True); k.add_argument('--prod', required=True)
    a = ap.parse_args()

    if a.cmd == 'extract':
        try:
            for s in extract_specifiers(open(a.file, encoding='utf-8', errors='strict').read(), a.file):
                print(s)
            return 0
        except (Unparseable, UnicodeDecodeError) as ex:
            print('!! UNPARSEABLE  %s  %s' % (a.file, ex), file=sys.stderr)
            return 3

    if a.cmd == 'closure':
        paths, problems = closure(a.root, a.entry, load_import_map(a.import_map))
        for p in paths:
            print(p)
        for kind, where, spec in problems:
            print('!! %s  %s  %s' % (kind, where, spec), file=sys.stderr)
        return 3 if problems else 0

    if a.cmd == 'manifest':
        src = sys.stdin if a.files_from == '-' else open(a.files_from, encoding='utf-8')
        for line in manifest(a.root, [l.strip() for l in src if l.strip()]):
            print(line)
        return 0

    verdict, detail = classify(parse_manifest(a.rc), parse_manifest(a.prod))
    print(verdict); print(json.dumps(detail, indent=2))
    return 0

if __name__ == '__main__':
    sys.exit(main())
