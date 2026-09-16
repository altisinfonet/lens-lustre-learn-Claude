artifact          : first ```yaml fenced block of 05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md

BYTE CONTRACT (stated at revision 5)
  bytes hashed    : content BETWEEN the fences, fence lines EXCLUDED,
                    terminated by exactly one LF on the final content line, UTF-8, LF endings.
  python rule     : re.search(r'```yaml\n(.*?)```', src, re.S).group(1).encode()
  shell rule      : ./extract_probe_yaml.sh   (awk; ships in this pack)
  cross-check     : BOTH METHODS AGREE

parser            : PyYAML 6.0.3 on Python 3.11.15
command           : yaml.safe_load(<block extracted by the rule above>)
timestamp (UTC)   : 2026-08-29T13:06:40Z
yaml block bytes  : 2542
yaml block sha256 : b4d0cd9461840bea05c2ef1423a263f29c9aad45ed477ca58c77bc47b614aff1
result            : PARSED OK
jobs              : ['staging-lane', 'production-lane']
  job staging-lane     environment=staging     env keys=['CONTROL', 'FOREIGN', 'OWN']
  job production-lane  environment=production  env keys=['CONTROL', 'FOREIGN', 'OWN']
trigger           : {'push': {'branches': ['probe/secret-isolation-**']}}
permissions       : {'contents': 'read'}

PROVENANCE        : STATIC-VALIDATED ONLY. Parsed, not executed. The workflow has NOT been
                    pushed, triggered or run. Parsing proves syntax and structure, nothing
                    more. Revision 1's probe also parsed perfectly and was untriggerable.
