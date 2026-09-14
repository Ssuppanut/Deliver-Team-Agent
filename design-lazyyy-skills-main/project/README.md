# project — your workspace

This folder starts empty, and it is **the only place you edit while working on
your project.** The rest of the repo is knowledge and tooling, not your work.

---

## Start here

```
/kickoff
```

That asks the opening questions and creates `project.yml` and `REGISTER.md` for
you. Do not create any files by hand before that.

---

## What lives here

| File / folder | What it is |
|---|---|
| `project.yml` | Shared memory across every role — each skill reads it before starting |
| `REGISTER.md` | The document register: codes, revisions, statuses |
| `1-product/` | PRD · REQ · EST · WBS · SCH · TRN |
| `2-analysis/` | SRS · ARC · DM · NAV · DAY · TST · CR |
| `3-design/` | DSN |
| `4-build/` | Code — this stage has no standing controlled document |
| `5-quality/` | RVW · QAR |
| `6-release/` | REL |
| `assets/` | Rendered diagram images, generated automatically — do not edit |

---

## Rules

**Create documents with `/doc-new <TYPE>` only.** Do not copy template files
yourself — the command substitutes the project code and writes the register entry
in the same edit.

**Edit the `.md` only.** The `.pdf` and `.docx` live in `docs/` and are
overwritten every time you run `bash tools/build-docs.sh`.

**When you do not know, write `TBD — ต้องการ [คน/ข้อมูล]`.** Do not guess, and do
not leave it blank. Every `TBD` needs a matching entry in `open_questions` in
`project.yml`.

**A number you estimated has to say so.** Record it under `assumptions` with where
it came from — so when a forecast built on it turns out wrong, you can see where
it went wrong.

---

## When you get stuck

```
/status     which stage, which documents are done, how many TBDs remain
/gate       what is missing before you can move on
/cr         raise a change request when documents contradict each other
```
