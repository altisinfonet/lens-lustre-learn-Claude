"""Statement-scoped, case-insensitive, dollar-quote-aware SQL scanner.
Written for the Phase-1 acceptance audit. Deliberately NOT a line grep:
a line grep is the instrument that produced C-A8 and C-A10."""
import re, subprocess
DOLLAR = re.compile(r"\$[A-Za-z_0-9]*\$")

def blob(ref, path):
    """Read a PUSHED blob. subprocess keeps the trailing newline; $(git show)
    in a shell silently strips it — that is C-A12's cause."""
    r = subprocess.run(["git","show",f"{ref}:{path}"], capture_output=True, cwd="/home/claude/repo")
    if r.returncode: raise FileNotFoundError(f"{ref}:{path}")
    return r.stdout

def text(ref, path): return blob(ref, path).decode("utf-8")

def ls(ref, prefix):
    r = subprocess.run(["git","ls-tree","-r","--name-only",ref,"--",prefix],
                       capture_output=True, cwd="/home/claude/repo")
    return [p for p in r.stdout.decode().split() if p]

def strip_comments(sql, recurse=True):
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql[i:i+2] == "--":
            j = sql.find("\n", i); i = n if j < 0 else j
        elif sql[i:i+2] == "/*":
            j = sql.find("*/", i+2); i = n if j < 0 else j+2
        elif c == "'":
            j = i+1
            while j < n:
                if sql[j] == "'":
                    if sql[j:j+2] == "''": j += 2; continue
                    j += 1; break
                j += 1
            out.append(sql[i:j]); i = j
        elif c == '"':
            # DOUBLE-QUOTED IDENTIFIER. Not a string literal, but an apostrophe
            # inside one desynchronises any scanner that ignores it. That is the
            # defect this audit found in its own instrument:
            #   CREATE POLICY "Ad comments follow the ad's visibility" ...
            j = i+1
            while j < n:
                if sql[j] == '"':
                    if sql[j:j+2] == '""': j += 2; continue
                    j += 1; break
                j += 1
            out.append(sql[i:j]); i = j
        elif c == "$" and DOLLAR.match(sql, i):
            tag = DOLLAR.match(sql, i).group(0)
            j = sql.find(tag, i+len(tag)); j = n if j < 0 else j+len(tag)
            body = sql[i+len(tag): j-len(tag)] if j > i+len(tag) else ""
            out.append(tag + (strip_comments(body) if recurse else body) + tag); i = j
        else:
            out.append(c); i += 1
    return "".join(out)

def statements(sql, into_dollar=False):
    """Top-level statements. into_dollar=True also yields statements found
    INSIDE dollar-quoted bodies (needed to catch a hidden SET/EXECUTE)."""
    st, buf, i, n = [], [], 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'":
            j = i+1
            while j < n:
                if sql[j] == "'":
                    if sql[j:j+2] == "''": j += 2; continue
                    j += 1; break
                j += 1
            buf.append(sql[i:j]); i = j
        elif c == '"':
            j = i+1
            while j < n:
                if sql[j] == '"':
                    if sql[j:j+2] == '""': j += 2; continue
                    j += 1; break
                j += 1
            buf.append(sql[i:j]); i = j
        elif c == "$" and DOLLAR.match(sql, i):
            tag = DOLLAR.match(sql, i).group(0)
            j = sql.find(tag, i+len(tag)); j = n if j < 0 else j+len(tag)
            body = sql[i+len(tag): j-len(tag)] if j > i+len(tag) else ""
            if into_dollar: st.extend(statements(body, True))
            buf.append(tag+body+tag); i = j
        elif c == ";":
            st.append("".join(buf)); buf = []; i += 1
        else:
            buf.append(c); i += 1
    if "".join(buf).strip(): st.append("".join(buf))
    return [s for s in st if s.strip()]

def norm(s): return " ".join(s.split())

PUBLIC_GRANTEE = re.compile(r"(^|[\s,(])PUBLIC([\s,)]|$)", re.I)
def grants_to_public(sql):
    hits=[]
    for s in statements(strip_comments(sql), into_dollar=True):
        t = norm(s)
        if not re.match(r"(?i)^\s*GRANT\b", t): continue
        m = re.search(r"(?i)\bTO\b([^;]*)$", t)
        if m and PUBLIC_GRANTEE.search(m.group(1)): hits.append(t)
    return hits

KEYWORDS = r"(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|DO|SET|BEGIN|COMMIT|ROLLBACK|TRUNCATE|WITH|CALL|ANALYZE|VACUUM|REFRESH|SECURITY|RESET|LOCK|COPY|EXECUTE|PREPARE|NOTIFY|LISTEN|VALUES|EXPLAIN|IMPORT|REASSIGN)"
def counts(sql):
    """Two counting rules, reported side by side — a single figure without its
    rule is how this project got 'eight functions'."""
    st = statements(strip_comments(sql))
    non_empty = [s for s in st if s.strip()]
    kw = [s for s in non_empty if re.match(r"(?i)^\s*"+KEYWORDS+r"\b", norm(s))]
    return len(non_empty), len(kw), non_empty, kw
