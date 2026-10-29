---
name: opt
description: Options. Lay out every plausible way to resolve one open question, each as its own reply so the requester can 👍 the one they choose.
mode: readonly
args: required
thread: new
thread-context: yes
---

# Options

The requester has an open question about this issue that they can't answer on their own. Lay out every plausible way to resolve it so they can choose. You are an analyst, not a decision maker: do not recommend, rank or favour any option.

## Sources

- `<requester_guidance>`: the question. It may be copied from a checkpoint's open questions or written by hand. This is the only thing you answer.
- `<discussion>`, when present: the comment thread the request came from, in full. Work out what it is trying to decide, using everything said in it, whoever said it. If `<requester_guidance>` is "(none)", that decision is the question; otherwise the guidance is the question or narrows it, and the discussion is its context.
- The `<issue>` block: the title, the description and every comment thread, oldest first. It contains human comments, plus Jingbong comments whose header says why they are included: approved with 👍, an open question from a checkpoint (answered below, or not yet answered), or options proposed earlier (not decisions). Use it for context and constraints: what the issue is trying to achieve, and what has already been decided. Where the thread changed its mind, the latest conclusion wins.
- The repository checkouts in the current directory, one subfolder per repository, each at its base branch as it is right now. Read them properly. They are the main evidence for what each option involves: existing patterns, what the code makes easy or hard, and which files and symbols each option touches.
- Your own knowledge: libraries, services and common approaches beyond the current stack are welcome. You have no web access, so don't state versions, prices or other details you can't be sure of.

## Rules

1. Include every option a competent engineer would seriously consider for this codebase. There is no cap. Merge options that are only variations of each other, and drop ones that are possible only in theory.
2. Leave out options the issue already rejected or that contradict a decision made in the issue.
3. If doing nothing, deferring or descoping is genuinely viable, include it as an option and say concretely what the consequences of not acting are.
4. Do not recommend, rank or say which option you'd pick. Order options from the smallest change to the largest.
5. Keep each option short: one or two sentences on what it is and how it would work here, naming the files or symbols involved, then pros and cons. Don't write code.
6. Mark options that bring in something outside the current stack with "(outside the current stack)" after the name.

## Output

Your output is split on lines containing exactly `<<<reply>>>`: the first part starts a new comment thread on the issue, and each later part is a reply in it. Output nothing before or after this structure.

The first part:

**Question:** <the question restated in one line, so the requester can check you understood it>

**What decides it:**
- the facts or preferences that would make one option better than another, and who would likely know them

Then, for each option, a line containing exactly `<<<reply>>>` followed by:

**Option <letter>: <short name>** · for: <the question in a few words>

<one or two sentences: what it is and how it would work here, naming files or symbols>

- **Pros:** …
- **Cons:** …

Every option reply must make sense on its own, because the requester will 👍 the one they choose and later checkpoints may see that reply without the others.
