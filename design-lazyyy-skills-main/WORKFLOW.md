# Workflow

How the 24 skills form a single pipeline, what each gate checks, and what the
roles hand to each other.

---

## The flow

```mermaid
flowchart TB
    IDEA(["Idea / request"])

    subgraph I["0 · Intake"]
        I1["project-intake<br/>five questions → project.yml"]
    end

    subgraph P["1 · What and why"]
        P1["product-owner<br/>PRD · REQ · stories · AC"]
        P2["project-manager<br/>EST · WBS · SCH"]
        P1 --- P2
    end

    G1{"G1<br/>Definition of Ready"}

    subgraph A["2 · How it's buildable"]
        A1["system-analyst<br/>SRS · ARC · DM · NAV · TST"]
    end

    G2{"G2<br/>Design handback"}

    subgraph D["3 · What it looks like"]
        D1["full-stack-design, 15 skills<br/>DSN · tokens · components"]
    end

    G3{"G3<br/>Design system ready"}

    subgraph B["4 · Build"]
        B1["developer<br/>code · tests"]
    end

    G4{"G4<br/>Definition of Done"}

    subgraph R["5 · Check"]
        R1["code-reviewer<br/>RVW"]
        R2["quality-assurance<br/>QAR"]
    end

    G5{"G5<br/>Review clear"}
    G6{"G6<br/>QA not BLOCK"}

    subgraph S["6 · Release"]
        S1["devops-release<br/>REL"]
    end

    LIVE(["In production"])
    CR["/cr change request"]

    IDEA --> I --> P --> G1
    G1 -->|not yet| P
    G1 -->|pass| A --> G2
    G2 -->|not yet| A
    G2 -->|pass| D --> G3
    G3 -->|pass| B --> G4
    G4 -->|pass| R1 --> G5
    G5 -->|pass| R2 --> G6
    G6 -->|pass| S --> LIVE
    G6 -->|BLOCK| B

    A -.->|contradiction found| CR
    B -.->|spec is wrong| CR
    CR -.->|decision| P
    LIVE -.->|measure against the promised outcome| P
```

**The dotted lines are the parts most pipelines are missing** — the change-request
loop, and measuring the real outcome against the number the PRD promised. Without
them the pipeline only moves forward, and nobody ever learns whether it was right.

---

## Each role answers a different question

| Role | Answers | Delivers | Succeeds when |
|---|---|---|---|
| `project-intake` | **What do we already know** | project.yml | Nobody is asked the same thing twice |
| `product-owner` | **What, and why** | PRD REQ TRN | The team builds the right thing |
| `project-manager` | **How, and when** | EST WBS SCH | It ships on time with nobody surprised |
| `system-analyst` | **How is it buildable** | SRS ARC DM NAV TST | Developers start without guessing |
| `full-stack-design` | **What does it look like** | DSN, tokens, components | Every screen agrees, and everyone can use it |
| `developer` | **Is it done** | code, tests | It matches the spec and can be reviewed |
| `code-reviewer` | **Should this code land** | RVW | The next person can change it safely |
| `quality-assurance` | **Is it ready to ship** | QAR | What passes does not come back as a defect |
| `devops-release` | **May it go live now** | REL | If it must be rolled back, it can be |
| `document-control` | **Which revision am I reading** | the register | Nobody reads a stale document unknowingly |

**The short version** — subject matter is PO · time, people and risk is PM ·
structure and data is SA · appearance is design · code is dev · code quality is
reviewer · does it match the spec is QA · may it ship is release.

---

## The six gates

Run with `/gate`, which reads the actual files and records the result in
`project.yml`.

| Gate | From → to | Question | Criteria live in |
|---|---|---|---|
| G1 | PO → SA | Are the requirements ready to design against | `product-owner`, Definition of Ready |
| G2 | SA → design/dev | Does every design element trace to a requirement | `system-analyst/assets/design-handback-checklist.md` |
| G3 | design → dev | Is the design system ready to code against | `/gate`, section G3 |
| G4 | dev → review | Is it done, or did you just stop typing | `developer/assets/definition-of-done.md` |
| G5 | review → QA | Should this code land | `code-reviewer`, merge decision |
| G6 | QA → release | May it ship | `devops-release/assets/release-checklist.md` |

**G4 and G5 are the two gates most teams do not have**, despite being the cheapest
to run and the ones that catch the most. Almost everyone has a Definition of
Ready; almost nobody has a Definition of Done.

---

## How work is handed over

**Two channels** — `project.yml` is shared memory; documents are the formal
deliverables.

```
project.yml   Every role reads it before starting, writes back what it learns
              → nobody gets asked the same question twice
              → the TBDs an earlier role left behind are visible

Documents     Registered in REGISTER.md, with a code and a revision number
              → you always know which revision you are reading
              → requirement IDs stay traceable end to end
```

**The traceability chain** is what holds it together:

```
requirement → design → screen → test case → code
```

Every arrow must walk in both directions. A component with no requirement behind
it is scope that grew on its own. A requirement with no test is a hope. Code that
cannot say which requirement it implements is code nobody dares delete.

---

## When something goes wrong

| Situation | Do this | Never do this |
|---|---|---|
| Source documents contradict each other | `/cr`, then keep working on a declared assumption | Pick one silently · edit the source document yourself |
| The estimate changes after design | Tell the PM the moment you know | Save it for the next status report |
| A gate fails | Fix what is missing, run `/gate` again | Advance `stage` by hand |
| QA returns BLOCK | Send it back to development | Ship it and fix it later |
| A release breaks production | Restore service first, diagnose second | Debug in production while users are affected |
| The schedule slips | Measure the gap, find the cause, offer three options, rebaseline once | Rebaseline every week |

---

## Principles every skill shares

1. **Deliver the work, not a description of how you would do the work.**
2. **Never invent what you do not know** — write `TBD — ต้องการ [คน/ข้อมูล]`.
3. **Make assumptions visible**, and say which numbers are guesses.
4. **You may decide on the user's behalf, but you must say so** — one line at the
   end, so it can be overruled.
5. **Report the problem rather than quietly fixing it** — each stage earns its
   place by catching things early, not by being clever about repairs.
