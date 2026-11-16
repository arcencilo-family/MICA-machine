# PROOF-RUN: MICA machine

**Who ran it, on what.**
- **Who:** the project's build agent (Claude Opus 5.5), **under the reference operator's own account**, on the project's reference box. It ran with no root and no `sudo`.
- **What:** this repository before this file was added and the release date was set in CITATION.cff. The tested tree is `2248db8a3b6bb925d4d8b97dfd25694ee09971f2`. The published tree is that tree plus this file and the release date in CITATION.cff. A file cannot carry the id of the tree that holds it; read the published tree's id with `git rev-parse HEAD^{tree}`.
- **When:** 2026-11-15.
- **How:** each suite was run alone.
- **The install:** a fresh install was made by the operator from this tree's lockfile, with `npm ci --no-audit --no-fund`. A plain `npm ci` installed the same packages and then did not return from its audit request.

**The repeat.** The suites were run twice more on the published tree, each time with this file in an earlier wording, the second time also with the release date set in CITATION.cff. Every check gave the same result, by name.

**What this cannot show.**
- **An outsider's account:** the run used the operator's own account on the reference box. A second account was not available.
- **Other systems:** other operating systems and other versions were not tried.
- **Deployment:** deploy and install are not covered, and neither is a connected agent.

```
release      : machine tree 2248db8a3b6bb925d4d8b97dfd25694ee09971f2 (this repository, before this file and the release date)
run          : 2026-11-15, the reference operator's own account, no root, each suite alone
environment  : Linux, WSL2, kernel 6.6.87.2, Ubuntu 24.04.4 LTS · 3 cores · Node v22.22.0 · npm 10.9.4 · Python 3.12.3
               · TypeScript 5.9.3, ts-node 10.9.2, @types/node 20.19.43, from a fresh install of the lockfile
               · sibling ILAS present: yes, a copy whose tree is that of public commit f768236a20f00eb203f6ce1c292f388c7a7a2a7e
machine      : npm run typecheck        rc 2, 2 errors (tools/gate4/probe-leg-a.ts:33, :37)
               npm run typecheck:build  rc 0
               npm run test:mica        111 files named, 111 ran, 107 passed, 4 failed, 0 incomplete, 0 unreachable
               python3 -B scripts/declare-s120.test.py   9 of 9 passed
               python3 -B deploy/wm-apply.test.py        8 of 8 passed
reds         : every red is on the README's expected list; no red off the list.
               typecheck: 2 errors in tools/gate4/probe-leg-a.ts
               tools/suite-membership.test.ts            SM-A
               src/mica/registration.test.ts             EVERY discovered src/**/*.test.ts is registered in test:mica
               src/probe/evidence-log.test.ts            EV-FIX-H3
               tools/ticket-preflight/preflight.test.ts  PF-G2, PF-G3e (one-commit repository), PF-G15
not covered  : deploy, install on another box, a connected agent, a second account, other systems
```

**Outputs** (kept by the project, not shipped):

| file | bytes | sha256 |
|---|---|---|
| env.txt | 420 | 0f0ba400c01e3dc5980218cb9c5fb2ec5c3359e6f0b7bb19730875f7101f5fa1 |
| m-typecheck.txt | 485 | d14b32b31f8d15cdebaf86aa1d75dbe4aff3005600dd7f307d0c456b3be55576 |
| m-typecheck-build.txt | 59 | 67544f3b140e304af58f96c633c0c0d6552036afa9913313fb33fa4f66930f53 |
| m-test-mica.txt | 547909 | dff318e58c328569ed90563522316f2e40f3de6a6b95c97792c6abd5253f5a7f |
| m-py1.txt | 1053 | eb3671472c74e4ad76ae54e16e59320c140b53beacb50febe3b1050b38cf2d0f |
| m-py2.txt | 512 | 36fa7dc5bf5117bb87aa9896f55d3685186fae2d8a2060baea4d459f90ad50a1 |

**Commands, as run** (from this repository's root):

```
npm run typecheck
npm run typecheck:build
npm run test:mica
python3 -B scripts/declare-s120.test.py
python3 -B deploy/wm-apply.test.py
```

The sibling ILAS copy stood at `../ILAS/ilas-github-copy`.
