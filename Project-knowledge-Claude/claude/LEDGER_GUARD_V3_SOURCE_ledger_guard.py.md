#!/usr/bin/env python3
"""
ledger-guard v3 — automated auditor for docs/PROMOTION_LEDGER.md.

v2 replaces v1's line-wide keyword heuristics with STRUCTURED parsing:
  * markdown tables are parsed into rows and cells;
  * a row is historical only when its LABEL cell or its CLASS cell says so, or when it sits
    under a heading marked historical - never because a word appears somewhere on the line;
  * ~~struck-through~~ spans are excised, so a mixed line stays ACTIVE for its live part;
  * blockquotes are annotation, not canonical claims;
  * SHAs are read from a REGISTRY OF CANONICAL FIELDS, each typed commit|tree|opaque, so a
    tree hash is validated as a tree and a token id is not mistaken for a commit.

Fact source: live git (--repo) or an attested facts file (--facts). Facts are ATTESTED, not
measured: every finding derived from them is labelled so in the report.

Checks
  LG-01 canonical code-RC field names the last non-docs commit
  LG-02 code-frozen claim: nothing outside docs/ changed after the RC
  LG-03 typed identifier validation (commit fields are commits, tree fields are trees)
  LG-04 void/superseded SHAs are not reused in canonical ACTIVE fields
  LG-05 structured scope claims match their OWN declared endpoints
  LG-06 header revision equals the newest revision-table row
  LG-07 a canonical figure row carries a basis (date/instrument/command)
  LG-08 §refs resolve to the exact subsection (top-level refs allowed explicitly)
  LG-09 tag claims match reality, LOCAL AND REMOTE
  LG-10 duplicated-word typos in active prose
Exit: 0 clean · 1 FAIL present · 2 usage/environment error · 3 FATAL (a check could
      NOT be performed; the result is BLOCKED, not GREEN).
"""
import argparse, json, os, re, subprocess, sys

# ---------------------------------------------------------------- model ------
STRUCK_RE   = re.compile(r'~~.*?~~', re.S)
HEX_RE      = re.compile(r'`([0-9a-fA-F]{7,40})`')
SECREF_RE   = re.compile(r'§\s*(\d+(?:\.\d+)*)')
HEADING_RE  = re.compile(r'^(#{1,6})\s+(?:§\s*)?(\d+(?:\.\d+)*)?\s*·?\s*(.*)$')
REVROW_RE   = re.compile(r'^\|\s*\*{0,2}REV-(\d+)\*{0,2}\s*\|')
REVHDR_RE   = re.compile(r'Status of this revision:\*{0,2}\s*`REV-(\d+)')
DUP_RE      = re.compile(r'\b([A-Za-z]{4,})\s+\1\b')
NUM_RE      = re.compile(r'\*{0,2}([\d][\d,]*)\*{0,2}')
LINES_RE    = re.compile(r'\+\s*\*{0,2}([\d,]+)\*{0,2}\s*/\s*[-−]\s*\*{0,2}([\d,]+)')

# Only these tokens mark a row historical, and only in the LABEL or CLASS cell.
HISTORICAL_CELL_TOKENS = ('HISTORICAL', 'SUPERSEDED', 'STALE', 'VOID', 'WRONG',
                          'CORRECTED', 'NOT re-measured', 'historical by construction')
# Headings that make every row beneath them historical until the next heading.
HISTORICAL_HEADING_TOKENS = ('HISTORICAL', 'Superseded', 'SUPERSEDED',
                             'preserved, not deleted', 'CORRECTION REGISTER',
                             'Superseded identities', 'Superseded counts', 'Superseded state',
                             'REVISION', 'LEDGER MAINTENANCE', 'DEFECTS IN REVISION')

# label (normalised) -> (kind, is_canonical)
CANONICAL_FIELDS = {
    'application / code rc': ('commit', True),
    'application/code rc':   ('commit', True),
    'code rc':               ('commit', True),
    'main pre-promotion sha':('commit', True),
    'main pre-promotion tree':('tree',  True),
    'merge base':            ('commit', True),
    'candidate sha':         ('commit', True),
    'candidate tree':        ('tree',   True),
    'rc sha (t)':            ('commit', True),
    'ledger head':           ('moving', False),
    'cloudflare account id': ('opaque', False),
    'staging token':         ('opaque', False),
    'token id':              ('opaque', False),
}
# scope-claim labels -> metric
SCOPE_FIELDS = {
    'files changed': 'files',
    'lines': 'lines',
    'lines, total': 'lines',
    'lines, application only': 'lines',
    'commits ahead of `main`': 'commits',
    'commits ahead of main': 'commits',
}
BASIS_RE = re.compile(r'(\d{4}-\d{2}-\d{2}|\bUTC\b|\bZ\b|`git |git diff|compare/|instrument|measured|derived)', re.I)

def strip_struck(s):
    return STRUCK_RE.sub(' ', s)

def norm_label(cell):
    c = strip_struck(cell)
    c = re.sub(r'[*`]', '', c)
    c = re.sub(r'\(.*?\)$', '', c).strip()
    c = re.sub(r'\s+', ' ', c).lower().strip(' .:')
    return c

class Row:
    # v3 FIX 4: `table` is a monotonically increasing id. Two tables in the SAME
    # section have different ids, so nothing inherited (endpoints in LG-05, basis
    # in LG-07) can leak from one table into the next.
    __slots__ = ('lineno', 'cells', 'raw', 'section', 'historical', 'table')
    def __init__(self, lineno, cells, raw, section, historical, table):
        self.lineno, self.cells, self.raw = lineno, cells, raw
        self.section, self.historical, self.table = section, historical, table

def parse(text):
    """-> (lines, rows, headings, prose_lines)"""
    lines = text.splitlines()
    rows, headings, prose = [], {}, []
    cur_sec, sec_hist, cur_level = None, False, 0
    table_id, in_table = 0, False          # v3 FIX 4
    for i, raw in enumerate(lines, 1):
        if not raw.lstrip().startswith('|'):
            in_table = False               # ANY non-table line closes the table
        m = HEADING_RE.match(raw)
        if m and raw.lstrip().startswith('#'):
            level = len(m.group(1)); num = m.group(2); title = m.group(3)
            if num:
                headings[num] = title
            hist = any(t in raw for t in HISTORICAL_HEADING_TOKENS)
            if level <= cur_level or cur_sec is None:
                cur_sec, sec_hist, cur_level = (num or title), hist, level
            else:
                cur_sec, sec_hist, cur_level = (num or title), (sec_hist or hist), level
            continue
        if raw.lstrip().startswith('|'):
            if not in_table:
                table_id += 1; in_table = True
            body = raw.strip().strip('|')
            if re.fullmatch(r'[\s:\-|]+', body):
                continue                   # separator row: stays inside this table
            cells = [c.strip() for c in body.split('|')]
            label = cells[0] if cells else ''
            klass = cells[-1] if len(cells) > 1 else ''
            row_hist = sec_hist
            for cell in (label, klass):
                cs = cell
                if any(t in cs for t in HISTORICAL_CELL_TOKENS):
                    row_hist = True
                if cs.startswith('~~') or (cs.count('~~') >= 2 and STRUCK_RE.sub('', cs).strip() in ('', '|')):
                    row_hist = True
            rows.append(Row(i, cells, raw, cur_sec, row_hist, table_id))
            continue
        if raw.lstrip().startswith('>'):
            continue                      # annotation, never a canonical claim
        prose.append((i, raw, sec_hist))
    return lines, rows, headings, prose

# ------------------------------------------------------------- fact source ---
class Ambiguous(Exception): pass
class Unknown(Exception): pass

class GitFacts:
    kind = 'MEASURED'
    def __init__(self, repo, base):
        self.repo, self.base = repo, base
    def _g(self, *a, check=True):
        p = subprocess.run(['git', '-C', self.repo, *a], capture_output=True, text=True)
        if check and p.returncode: raise RuntimeError(p.stderr.strip()[:160])
        return p.stdout
    def _type(self, sha):
        p = subprocess.run(['git','-C',self.repo,'cat-file','-t',sha], capture_output=True, text=True)
        return p.stdout.strip() if p.returncode == 0 else None
    def is_commit(self, sha):
        return self._type(sha) == 'commit'
    def is_tree(self, sha):
        # NOT `cat-file -e sha^{tree}` - that PEELS a commit to its tree and succeeds for any
        # commit, so a commit sha in a tree field passed silently. Compare the object type.
        return self._type(sha) == 'tree'
    def rev(self, r): return self._g('rev-parse', r).strip()
    def resolve(self, sha):
        p = subprocess.run(['git','-C',self.repo,'rev-parse','--verify','%s^{commit}'%sha],
                           capture_output=True, text=True)
        if p.returncode == 0:
            return p.stdout.strip()
        err = (p.stderr or '').lower()
        if 'ambiguous' in err or 'short sha1' in err or 'short object id' in err:
            raise Ambiguous(p.stderr.strip()[:120])
        raise Unknown(sha)
    def short_only(self, sha, key): return False      # live git resolves or it does not
    def ambiguous(self, sha, key):
        try:
            self.resolve(sha); return False
        except Ambiguous: return True
        except Unknown:    return False
    def head(self): return self.rev('HEAD')
    def last_non_docs(self, docdir):
        return (self._g('rev-list','-1','HEAD','--','.',':(exclude)%s*'%docdir).strip() or None)
    def changed(self, a, b):
        return [l for l in self._g('diff','--name-only','%s..%s'%(a,b)).splitlines() if l.strip()]
    def numstat(self, a, b):
        f=ad=de=0
        for l in self._g('diff','--numstat','%s...%s'%(a,b)).splitlines():
            if not l.strip(): continue
            p=l.split('\t'); f+=1
            if p[0]!='-': ad+=int(p[0])
            if p[1]!='-': de+=int(p[1])
        return f, ad, de
    def commits(self, a, b, no_merges=False):
        args=['rev-list','--count'] + (['--no-merges'] if no_merges else []) + ['%s..%s'%(a,b)]
        return int(self._g(*args).strip())
    def tags_local(self):  return [t for t in self._g('tag').splitlines() if t.strip()]
    def tags_remote(self):
        """v3 FIX 3: -> (list, ok). ok=False means the command FAILED; the caller must not
        report 'no remote tags confirmed' from a failure."""
        p = subprocess.run(['git','-C',self.repo,'ls-remote','--tags','origin'],
                           capture_output=True, text=True)
        if p.returncode != 0:
            return (None, False)
        return ([l.split('refs/tags/')[-1].replace('^{}','')
                 for l in p.stdout.splitlines() if 'refs/tags/' in l], True)

class AttestedFacts:
    kind = 'ATTESTED'
    def __init__(self, path):
        self.d = json.load(open(path, encoding='utf-8'))
        self.base = self.d['base']
    def _full(self, key):
        return {k.lower() for k in self.d.get(key, []) if len(k) == 40}
    def _short(self, key):
        # v3 FIX 5: abbreviations are attested in a SEPARATE key. They are recorded so the
        # guard can say "known but unresolvable"; they never satisfy a typed check.
        return {k.lower() for k in self.d.get(key + '_abbrev_only', [])} | \
               {k.lower() for k in self.d.get(key, []) if len(k) != 40}
    def _match(self, sha, key):
        """v3 FIX 5: a short input is accepted ONLY as an unambiguous prefix of a known FULL
        sha. A longer input is NEVER accepted just because it starts with a known short entry."""
        s = sha.lower()
        full = self._full(key)
        if len(s) == 40:
            if s in full: return [s]
            return []
        hits = sorted(f for f in full if f.startswith(s))
        if hits: return hits
        return ['SHORT-ONLY'] if s in self._short(key) else []
    def is_commit(self, sha):
        h = self._match(sha, 'known_commits'); return len(h) == 1 and h != ['SHORT-ONLY']
    def is_tree(self, sha):
        h = self._match(sha, 'known_trees'); return len(h) == 1 and h != ['SHORT-ONLY']
    # v3 FIX 5: the two states a typed check cannot decide, kept distinct from "wrong".
    def short_only(self, sha, key):
        return self._match(sha, key) == ['SHORT-ONLY']
    def ambiguous(self, sha, key):
        return len(self._match(sha, key)) > 1
    def resolve(self, sha):
        h = self._match(sha, 'known_commits')
        if len(h) > 1: raise Ambiguous('%d known commits share the prefix %s' % (len(h), sha))
        if not h or h == ['SHORT-ONLY']: raise Unknown(sha)
        return h[0]
    def rev(self, r):
        return {'HEAD': self.d['head'], self.d['base']: self.d['base']}.get(r, r)
    def head(self): return self.d['head']
    def last_non_docs(self, docdir): return self.d.get('last_non_docs_commit')
    def changed(self, a, b): return list(self.d.get('changed_after_code_rc', []))
    def _range(self, a, b):
        for k, v in self.d.get('ranges', {}).items():
            x, y = k.split('..')
            if (a.startswith(x) or x.startswith(a[:7])) and (b.startswith(y) or y.startswith(b[:7])):
                return v
        return None
    def numstat(self, a, b):
        r = self._range(a, b)
        return (r['files'], r['added'], r['deleted']) if r else (None, None, None)
    def commits(self, a, b, no_merges=False):
        r = self._range(a, b)
        if not r: return None
        return r['commits_no_merges'] if no_merges else r['commits']
    def tags_local(self):  return list(self.d.get('tags_local', []))
    def tags_remote(self):
        if 'tags_remote' not in self.d: return (None, False)
        return (list(self.d['tags_remote']), True)

# ----------------------------------------------------------------- checks ----
class F:
    def __init__(s, cid, sev, ln, msg, src='MEASURED'):
        s.cid, s.sev, s.ln, s.msg, s.src = cid, sev, ln, msg, src
    def __str__(s):
        return '%-6s %-4s %-9s [%s] %s' % (s.cid, s.sev, ('line %d'%s.ln) if s.ln else '-', s.src, s.msg)

def audit(path, facts, base, docdir='docs/', endpoints=None):
    text = open(path, encoding='utf-8').read()
    lines, rows, headings, prose = parse(text)
    out = []
    SRC = facts.kind if facts else 'DOC-ONLY'
    def add(cid, sev, ln, msg, src=None): out.append(F(cid, sev, ln, msg, src or SRC))

    endpoints = endpoints or {}
    canon = []            # (row, label, kind, shas)
    void_shas = {}        # sha -> lineno where declared void

    for r in rows:
        if len(r.cells) < 2: continue
        label = norm_label(r.cells[0])
        value_cells = ' | '.join(r.cells[1:])
        shas_live = [m.group(1).lower() for m in HEX_RE.finditer(strip_struck(value_cells))]
        # VOID DERIVATION - deliberately narrow (v2 revision 2).
        # A SHA is void ONLY when it appears INSIDE a ~~struck-through~~ span, or in the value
        # of a row whose LABEL cell is struck through / explicitly tagged VOID or WRONG.
        # It is NOT void merely because it also appears somewhere historical: the correction
        # register cites the CORRECT value too, and marking that void made LG-04 fire on the
        # live RC field. (Found by running v2 against the real REV-16 ledger.)
        for span in STRUCK_RE.finditer(' | '.join(r.cells)):
            for m in HEX_RE.finditer(span.group(0)):
                void_shas.setdefault(m.group(1).lower(), r.lineno)
        # A struck LABEL only voids the row's SHAs when that label is itself a canonical
        # identity field (e.g. ~~RC SHA (T)~~). A struck row NUMBER in a blocker table means
        # "this blocker is closed", NOT "these SHAs are void" - that mistake made LG-04 fire on
        # the live merge commit. (Found by running against the real REV-16 ledger.)
        label_cell = r.cells[0]
        if label_cell.strip().startswith('~~'):
            inner = STRUCK_RE.findall(label_cell)
            inner_label = norm_label(inner[0].strip('~')) if inner else ''
            if inner_label in CANONICAL_FIELDS:
                for x in shas_live:
                    void_shas.setdefault(x, r.lineno)
        if r.historical:
            continue
        if label in CANONICAL_FIELDS:
            kind, is_canon = CANONICAL_FIELDS[label]
            canon.append((r, label, kind, shas_live, is_canon))

    # ---- LG-01 / LG-02 --------------------------------------------------------
    rc_rows = [c for c in canon if c[1] in ('application / code rc','application/code rc','code rc')]
    if not rc_rows:
        add('LG-01','FAIL',0,'no ACTIVE canonical "Application / code RC" field found')
    for r, label, kind, shas, _ in rc_rows:
        if not shas:
            add('LG-01','FAIL',r.lineno,'canonical code-RC field contains no live SHA'); continue
        rc = shas[0]                                   # THE declared RC: first live SHA only
        if len(shas) > 1:
            add('LG-01','WARN',r.lineno,
                'canonical code-RC field holds %d live SHAs; only the first (%s) is treated as the RC'
                % (len(shas), rc[:12]))
        if facts is None: continue
        if not facts.is_commit(rc):
            add('LG-01','FAIL',r.lineno,'declared code RC %s is not a known commit' % rc[:12]); continue
        lnd = facts.last_non_docs(docdir)
        if lnd and not (lnd.startswith(rc) or rc.startswith(lnd[:len(rc)])):
            add('LG-01','FAIL',r.lineno,
                'declared code RC %s is not the last non-%s commit (that is %s)'%(rc[:12],docdir,lnd[:12]))
        changed = facts.changed(rc, facts.head())
        nd = [c for c in changed if not c.startswith(docdir)]
        if nd:
            add('LG-02','FAIL',r.lineno,
                'code-frozen claim false: %d non-%s path(s) after the RC, e.g. %s'%(len(nd),docdir,nd[0]))
        else:
            add('LG-02','INFO',r.lineno,'code-frozen claim holds: only %s changed after %s'%(docdir,rc[:12]))

    # ---- LG-03 typed identifier validation -----------------------------------
    for r, label, kind, shas, is_canon in canon:
        if kind == 'moving' or facts is None: continue
        if kind == 'opaque':
            continue                       # token/account ids are not git objects by declaration
        key = 'known_commits' if kind == 'commit' else 'known_trees'
        for s in shas:
            # v3 FIX 1: a 32-hex value in a field TYPED commit/tree is a FAILURE. Looking like an
            # md5 or a token id is not an excuse - the field says it must be a git object.
            note = ' (32-hex: looks like an md5/token id, but this field is typed %s)' % kind if len(s) == 32 else ''
            # v3 FIX 5: "cannot be decided" is never reported as "correct".
            if facts.ambiguous(s, key):
                add('LG-03','FATAL',r.lineno,
                    'field "%s": %s is an AMBIGUOUS abbreviation; typed check BLOCKED'%(label,s)); continue
            if facts.short_only(s, key):
                add('LG-03','WARN',r.lineno,
                    'field "%s": %s is attested only as an abbreviation, not as a full SHA; '
                    'typed check not possible'%(label,s)); continue
            if kind == 'commit' and not facts.is_commit(s):
                add('LG-03','FAIL',r.lineno,'field "%s" is typed commit but %s is not a commit%s'%(label,s[:12],note))
            if kind == 'tree' and not facts.is_tree(s):
                add('LG-03','FAIL',r.lineno,'field "%s" is typed tree but %s is not a tree%s'%(label,s[:12],note))

    # ---- LG-04 void reuse, compared by RESOLVED git identity (v3 FIX 2) --------
    # A void full SHA reused as a short SHA - and the reverse - is the same commit and must
    # fail. An ambiguous abbreviation cannot be compared and is BLOCKED, never passed.
    def resolve_id(sha, lineno, where):
        if facts is None:
            return ('UNRESOLVED', sha)
        try:
            full = facts.resolve(sha)
        except Ambiguous as e:
            add('LG-04','FATAL',lineno,'ambiguous abbreviation %s in %s: %s' % (sha, where, e))
            return ('AMBIGUOUS', None)
        except Unknown:
            return ('UNKNOWN', None)
        return ('OK', full)

    void_full = {}
    for s, ln in void_shas.items():
        st, full = resolve_id(s, ln, 'void declaration')
        if st == 'OK':
            void_full.setdefault(full, ln)
        elif st == 'UNKNOWN':
            add('LG-04','WARN',ln,'void-declared %s cannot be resolved; identity comparison skipped'%s[:12])
    for r, label, kind, shas, is_canon in canon:
        if not is_canon or kind == 'opaque': continue
        for s in shas:
            st, full = resolve_id(s, r.lineno, 'field "%s"' % label)
            if st != 'OK': continue
            if full in void_full:
                add('LG-04','FAIL',r.lineno,
                    'canonical active field "%s" reuses %s (= %s), declared void/superseded at line %d'
                    % (label, s[:12], full[:12], void_full[full]))
    if void_shas:
        add('LG-04','INFO',0,'%d SHA(s) recognised as void/superseded from structured fields' % len(void_shas))

    # ---- LG-05 structured scope claims ---------------------------------------
    # v3 FIX 4: keyed on the TABLE id, not the section. A second table in the same
    # section starts with no inherited endpoint.
    last_ep = {}          # table id -> endpoint
    for r in rows:
        if r.historical or len(r.cells) < 2: continue
        rowtext = ' | '.join(r.cells).replace('...', '…')
        for name, (a, b) in endpoints.items():
            if name in rowtext:
                last_ep[r.table] = (name, a, b); break
        label = norm_label(r.cells[0])
        metric = None
        for k, v in SCOPE_FIELDS.items():
            if label == k or label.startswith(k):
                metric = v; break
        if not metric: continue
        ep = None
        for name, (a, b) in endpoints.items():
            if name in rowtext:
                ep = (name, a, b); break
        if ep is None:
            ep = last_ep.get(r.table)        # inherit only WITHIN this table (v3 FIX 4)
        if ep is None:
            add('LG-05','WARN',r.lineno,'scope row "%s" declares no endpoint pair; not checked'%label); continue
        if facts is None: continue
        _, a, b = ep
        if metric == 'files':
            live, _, _ = facts.numstat(a, b)
            m = NUM_RE.search(strip_struck(' | '.join(r.cells[1:])))
            if live is not None and m and int(m.group(1).replace(',','')) != live:
                add('LG-05','FAIL',r.lineno,'claims %s files for %s; endpoint value is %d'%(m.group(1),ep[0],live))
        elif metric == 'lines':
            _, la, ld = facts.numstat(a, b)
            m = LINES_RE.search(' | '.join(r.cells[1:]))
            if la is not None and m:
                ca, cd = int(m.group(1).replace(',','')), int(m.group(2).replace(',',''))
                if (ca, cd) != (la, ld):
                    add('LG-05','FAIL',r.lineno,'claims +%d/-%d for %s; endpoint value is +%d/-%d'%(ca,cd,ep[0],la,ld))
        elif metric == 'commits':
            ca_all, ca_nm = facts.commits(a,b), facts.commits(a,b,True)
            # only figures DIRECTLY qualified by the word commit(s): "45 commits", "45 counting
            # merge commits", "43 excluding". A bare number in the same cell (a PR number, a
            # timestamp) is not a commit count. (Found on the real ledger: "#104" and "10:40Z".)
            # The LABEL already says "commits", so every number in the VALUE cell is a
            # candidate - except identifiers that are obviously not counts.
            cell = strip_struck(r.cells[1] if len(r.cells) > 1 else '')
            cell = re.sub(r'#\d+', ' ', cell)                 # PR / issue numbers
            cell = re.sub(r'\b\d{1,2}:\d{2}Z?', ' ', cell)     # times, with or without a Z suffix
            cell = re.sub(r'§\s*[\d.]+', ' ', cell)            # section refs
            cell = re.sub(r'\bREV-\d+', ' ', cell)             # revision ids
            cand = {int(m.group(1).replace(',','')) for m in NUM_RE.finditer(cell)}
            for v in sorted(cand):
                if ca_all is not None and v not in (ca_all, ca_nm):
                    add('LG-05','FAIL',r.lineno,'claims %d commits for %s; endpoint value is %d (%d no-merges)'
                        % (v, ep[0], ca_all, ca_nm))


    # ---- LG-06 ---------------------------------------------------------------
    hdr = REVHDR_RE.search(text)
    revs = [int(m.group(1)) for m in (REVROW_RE.match(l) for l in lines) if m]
    if not hdr: add('LG-06','FAIL',0,'no "Status of this revision: `REV-n`" header')
    elif revs and int(hdr.group(1)) != max(revs):
        add('LG-06','FAIL',0,'header REV-%s but newest table row REV-%d'%(hdr.group(1),max(revs)))
    else: add('LG-06','INFO',0,'header REV-%s matches newest table row'%(hdr.group(1) if hdr else '?'))

    # ---- LG-07 basis on canonical figure rows ---------------------------------
    prev_basis = {}                      # v3 FIX 4: table id -> line of last basis
    for r in rows:
        if len(r.cells) < 2: continue
        sec = r.table
        if BASIS_RE.search(r.raw):
            prev_basis[sec] = r.lineno
        if r.historical: continue
        label = norm_label(r.cells[0])
        if not any(label == k or label.startswith(k) for k in SCOPE_FIELDS): continue
        last_cell = r.cells[-1].strip().lower().strip('*` ')
        inherits = last_cell in ('same', 'ibid', 'ibid.', 'as above', '"')
        if BASIS_RE.search(r.raw): continue
        if inherits and sec in prev_basis: continue
        add('LG-07','FAIL',r.lineno,'canonical figure row "%s" states a value with no basis'%label)

    # ---- LG-08 exact subsection resolution ------------------------------------
    EXTERNAL_PREFIX = re.compile(r'(runbook|MEP|master execution plan|signing pack|G10_[A-Z0-9_]*)\s*$', re.I)
    for ln, raw, sec_hist in prose:
        if sec_hist: continue
        clean = strip_struck(raw)
        for m in SECREF_RE.finditer(clean):
            ref = m.group(1)
            before = clean[max(0, m.start()-28):m.start()]
            if EXTERNAL_PREFIX.search(before.rstrip()):
                continue                      # explicitly a section of ANOTHER document
            if ref in headings: continue
            if '.' not in ref:
                add('LG-08','FAIL',ln,'top-level reference §%s does not resolve to a heading'%ref)
            else:
                add('LG-08','FAIL',ln,'§%s does not resolve to that exact subsection'%ref)

    # ---- LG-09 tags, local AND remote ----------------------------------------
    if facts is not None:
        tl = facts.tags_local()
        tr, tr_ok = facts.tags_remote()
        claims_none = re.search(r'zero tags|0 tags exist|no tags exist|no remote tags', text, re.I)
        if claims_none:
            if not tr_ok:
                add('LG-09','FATAL',0,
                    'remote tag listing FAILED (origin unreachable or refused). '
                    'The no-tags claim is BLOCKED, not confirmed.')
            elif tl or tr:
                add('LG-09','FAIL',0,'ledger claims no tags; local=%d remote=%d (remote: %s)'
                    % (len(tl), len(tr), ', '.join(tr[:5]) or '-'))
            else:
                add('LG-09','INFO',0,'no-tags claim confirmed for local AND remote')

    # ---- LG-10 duplicated words ----------------------------------------------
    for ln, raw, sec_hist in prose:
        if sec_hist: continue
        m = DUP_RE.search(strip_struck(raw))
        if m: add('LG-10','FAIL',ln,'duplicated word "%s %s"'%(m.group(1), m.group(1)))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo'); ap.add_argument('--facts')
    ap.add_argument('--ledger', required=True)
    ap.add_argument('--base', default='origin/main')
    ap.add_argument('--docdir', default='docs/')
    ap.add_argument('--strict', action='store_true')
    a = ap.parse_args()

    if not os.path.isfile(a.ledger):
        print('FATAL: ledger not found: %s' % a.ledger); return 2
    facts = None
    endpoints = {}
    if a.repo and a.facts:
        print('FATAL: use --repo or --facts, not both'); return 2
    if a.repo:
        try:
            facts = GitFacts(a.repo, a.base); facts.rev('HEAD'); facts.rev(a.base)
        except Exception as e:
            print('FATAL: unusable git repo: %s' % e); return 2
        rc = facts.last_non_docs(a.docdir) or facts.head()
        endpoints = {'main…staging': (a.base, facts.head()), 'main…HEAD': (a.base, facts.head()),
                     'main…%s' % rc[:8]: (a.base, rc)}
    elif a.facts:
        try:
            facts = AttestedFacts(a.facts)
        except Exception as e:
            print('FATAL: bad facts file: %s' % e); return 2
        d = facts.d
        for name, pair in d.get('endpoint_labels', {}).items():
            endpoints[name] = (pair[0], pair[1])

    findings = audit(a.ledger, facts, a.base, a.docdir, endpoints)
    fatals = [f for f in findings if f.sev == 'FATAL']
    fails = [f for f in findings if f.sev in ('FAIL', 'FATAL')]
    warns = [f for f in findings if f.sev == 'WARN']
    if a.strict:
        fails = fails + warns; warns = []
    print('ledger-guard v3: %s' % a.ledger)
    print('  fact source: %s' % (facts.kind if facts else 'DOC-ONLY (LG-06/07/08/10 only)'))
    if a.facts: print('  facts file : %s' % a.facts)
    print('  endpoints  : %s' % (', '.join(endpoints) or '-'))
    print('-'*78)
    for f in findings: print(f)
    if not findings: print('(no findings)')
    print('-'*78)
    print('FATAL=%d FAIL=%d WARN=%d INFO=%d'
          % (len(fatals), len([f for f in findings if f.sev=='FAIL']), len(warns),
             len([f for f in findings if f.sev=='INFO'])))
    if fatals: return 3          # BLOCKED: a check could not be performed
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main())
