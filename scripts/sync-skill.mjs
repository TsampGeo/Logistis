// Generates the Claude skill from the single source of truth in instructions/.
import { readFileSync, writeFileSync } from "node:fs";

const body = readFileSync(new URL("../instructions/logistis.el.md", import.meta.url), "utf8");
const frontmatter = `---
name: logistis
description: Greek accounting and tax assistant (Λογιστής). Use for any question about Greek accounting, ΕΛΠ, ΦΠΑ, ΚΦΕ, myDATA, e-invoicing, e-ΕΦΚΑ, ΕΡΓΑΝΗ, payroll, tax deadlines, or ERPs such as Epsilon Smart, Pylon, SoftOne, Entersoft. Answers must rest on current primary sources (ΑΑΔΕ, ΦΕΚ) with exact dates.
---

<!-- Generated from instructions/logistis.el.md by scripts/sync-skill.mjs. Edit that file, not this one. -->

`;
writeFileSync(new URL("../plugin/skills/logistis/SKILL.md", import.meta.url), frontmatter + body);
console.log("Synced plugin/skills/logistis/SKILL.md");
